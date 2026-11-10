// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePromoFunnel } from '../src/index';
import { createPromoTracker } from '../src/page';

const funnel = definePromoFunnel('icarus', ['download', 'open-app']);
const ARRIVE = '/?utm_source=backrooms&utm_medium=promo&utm_content=pause&utm_term=private-diary&promo_lang=es#top';

let sent: Array<Record<string, string>>;

beforeEach(() => {
  sent = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  }));
  history.replaceState(null, '', ARRIVE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('createPromoTracker', () => {
  it('counts the arrival once and cleans the URL', () => {
    createPromoTracker(funnel).start();
    expect(location.pathname + location.search + location.hash).toBe('/#top');
    expect(sent).toEqual([{ event: 'arrive', promo: 'icarus', source: 'backrooms', placement: 'pause', locale: 'es', variant: 'private-diary' }]);
  });

  it('treats the same link again within seconds as the same arrival', () => {
    createPromoTracker(funnel).start();
    history.replaceState(null, '', ARRIVE);
    createPromoTracker(funnel).start();
    expect(sent.map((e) => e.event)).toEqual(['arrive']);
  });

  it('reports each step once, and nothing without an arrival', () => {
    const tracker = createPromoTracker(funnel);
    tracker.track('download');
    expect(sent).toEqual([]);
    tracker.start();
    tracker.track('download');
    tracker.track('download');
    expect(sent.map((e) => e.event)).toEqual(['arrive', 'download']);
  });

  it('counts the stays by visible time', () => {
    createPromoTracker(funnel).start();
    vi.advanceTimersByTime(10_000);
    expect(sent.map((e) => e.event)).toEqual(['arrive', 'stay-10s']);
    vi.advanceTimersByTime(50_000);
    expect(sent.map((e) => e.event)).toContain('stay-1m');
  });

  it('reports the links that are steps', () => {
    document.body.innerHTML = '<a href="/download/windows"><span>Get it</span></a><a href="/about">About</a>';
    const tracker = createPromoTracker(funnel, {
      linkStep: (link) => (link.pathname.startsWith('/download/') ? 'download' : null),
    });
    tracker.start();
    const [download, about] = document.querySelectorAll('a');
    for (const link of [download, about]) link!.addEventListener('click', (e) => e.preventDefault());
    about!.click();
    document.querySelector('span')!.click();
    expect(sent.map((e) => e.event)).toEqual(['arrive', 'download']);
  });

  it('stays quiet in an automated browser', () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: true });
    const tracker = createPromoTracker(funnel);
    tracker.start();
    tracker.track('download');
    expect(sent).toEqual([]);
    createPromoTracker(funnel, { countAutomation: true }).start();
    expect(sent.map((e) => e.event)).toEqual(['arrive']);
  });

  it('survives storage that refuses every access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => createPromoTracker(funnel).start()).not.toThrow();
    vi.restoreAllMocks();
  });
});
