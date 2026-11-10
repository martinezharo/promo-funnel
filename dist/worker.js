/** A promo event is six short fields; anything bigger is not one. */
export const MAX_PROMO_EVENT_BYTES = 256;
/** The body, or null once it is longer than `limit` bytes, read no further. */
async function readBounded(request, limit) {
    if (Number(request.headers.get('Content-Length') ?? 0) > limit)
        return null;
    if (!request.body)
        return '';
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
/**
 * The step a request reports, or why it is refused: not a POST, from another
 * origin, not JSON, too big, or not a step of this funnel. A Worker with its
 * own error format or rate limits uses this and `writePromoEvent`; the rest
 * use `handlePromoEvent`.
 */
export async function readPromoEvent(request, funnel) {
    if (request.method !== 'POST')
        return { ok: false, status: 405, message: 'Method not allowed' };
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
        return { ok: false, status: 403, message: 'Cross-origin promo events are not accepted' };
    }
    const type = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (type !== 'application/json')
        return { ok: false, status: 415, message: 'Expected application/json' };
    const text = await readBounded(request, MAX_PROMO_EVENT_BYTES);
    if (text === null)
        return { ok: false, status: 413, message: `At most ${MAX_PROMO_EVENT_BYTES} bytes` };
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { ok: false, status: 400, message: 'Invalid JSON' };
    }
    const event = funnel.parseEvent(value);
    if (!event)
        return { ok: false, status: 400, message: 'Invalid promo event' };
    return { ok: true, event };
}
/** Count a step, in the schema every site shares: event, source, promo, placement, language, wording. */
export function writePromoEvent(dataset, event) {
    dataset.writeDataPoint({
        blobs: [event.event, event.source, event.promo, event.placement, event.locale, event.variant],
        doubles: [1],
        indexes: [event.promo],
    });
}
/** `POST /api/promo-event`, whole: 204 once counted, a plain-text error otherwise. */
export async function handlePromoEvent(request, dataset, funnel) {
    const result = await readPromoEvent(request, funnel);
    if (!result.ok) {
        return new Response(result.message, {
            status: result.status,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store',
                ...(result.status === 405 ? { Allow: 'POST' } : {}),
            },
        });
    }
    writePromoEvent(dataset, result.event);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
