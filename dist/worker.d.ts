/**
 * The promo funnel, seen from the Worker: `POST /api/promo-event` checks a
 * step the page reports (`./page`) and writes it into the `promo_events`
 * Analytics Engine dataset every site of the funnel shares, which the private
 * promo-stats dashboard reads.
 *
 * Open to anyone, but only from the site's own pages, and nothing about the
 * visitor is kept, not even the country.
 */
import type { PromoEvent, PromoFunnel } from './index.js';
/** The slice of an Analytics Engine binding the funnel uses. */
export interface PromoDataset {
    writeDataPoint(point: {
        blobs?: string[];
        doubles?: number[];
        indexes?: string[];
    }): void;
}
/** A promo event is six short fields; anything bigger is not one. */
export declare const MAX_PROMO_EVENT_BYTES = 256;
export type PromoEventResult<Promo extends string, Step extends string> = {
    ok: true;
    event: PromoEvent<Promo, Step>;
} | {
    ok: false;
    status: 400 | 403 | 405 | 413 | 415;
    message: string;
};
/**
 * The step a request reports, or why it is refused: not a POST, from another
 * origin, not JSON, too big, or not a step of this funnel. A Worker with its
 * own error format or rate limits uses this and `writePromoEvent`; the rest
 * use `handlePromoEvent`.
 */
export declare function readPromoEvent<Promo extends string, Step extends string>(request: Request, funnel: PromoFunnel<Promo, Step>): Promise<PromoEventResult<Promo, Step>>;
/** Count a step, in the schema every site shares: event, source, promo, placement, language, wording. */
export declare function writePromoEvent(dataset: PromoDataset, event: PromoEvent): void;
/** `POST /api/promo-event`, whole: 204 once counted, a plain-text error otherwise. */
export declare function handlePromoEvent<Promo extends string, Step extends string>(request: Request, dataset: PromoDataset, funnel: PromoFunnel<Promo, Step>): Promise<Response>;
