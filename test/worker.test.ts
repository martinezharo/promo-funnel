import { describe, expect, it, vi } from 'vitest';
import { definePromoFunnel } from '../src/index';
import { handlePromoEvent, readPromoEvent } from '../src/worker';

const funnel = definePromoFunnel('vidshelf', ['add-video']);
const URL_ = 'https://vidshelf.4oli.com/api/promo-event';
const BODY = { event: 'add-video', promo: 'vidshelf', source: 'backrooms', placement: 'death', locale: 'es', variant: 'watch-later' };

const post = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  new Request(URL_, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

describe('handlePromoEvent', () => {
  it('writes a step in the shared schema', async () => {
    const dataset = { writeDataPoint: vi.fn() };
    const response = await handlePromoEvent(post(BODY, { Origin: 'https://vidshelf.4oli.com' }), dataset, funnel);
    expect(response.status).toBe(204);
    expect(dataset.writeDataPoint).toHaveBeenCalledWith({
      blobs: ['add-video', 'backrooms', 'vidshelf', 'death', 'es', 'watch-later'],
      doubles: [1],
      indexes: ['vidshelf'],
    });
  });

  it('refuses the rest, and counts none of it', async () => {
    const dataset = { writeDataPoint: vi.fn() };
    const status = async (request: Request) => (await handlePromoEvent(request, dataset, funnel)).status;
    expect(await status(post(BODY, {}, 'GET'))).toBe(405);
    expect(await status(post(BODY, { Origin: 'https://evil.example' }))).toBe(403);
    expect(await status(post(BODY, { 'Content-Type': 'text/plain' }))).toBe(415);
    expect(await status(post('x'.repeat(300)))).toBe(413);
    expect(await status(post('{'))).toBe(400);
    expect(await status(post({ ...BODY, event: 'sign-in' }))).toBe(400);
    expect(dataset.writeDataPoint).not.toHaveBeenCalled();
  });

  it('stops reading a body that grows past the limit without a length', async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(100)));
      },
    });
    const request = new Request(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await readPromoEvent(request, funnel)).toMatchObject({ ok: false, status: 413 });
  });
});
