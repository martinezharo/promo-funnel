/**
 * The promo funnel: what a visitor who followed a promo on one of the author's
 * sites (RANKMAKER, Backrooms) went on to do on the site it promoted.
 *
 * Every site of the funnel speaks the same contract, defined here once:
 *
 *  - The promo link carries `utm_medium=promo`, `utm_source` (the site that
 *    showed it), `utm_content` (where), `utm_term` (its wording, while one is
 *    on test) and `promo_lang` (the reader's language).
 *  - The promoted site reports steps (`arrive`, the stays, then its own) to
 *    its `POST /api/promo-event`, which writes each into the shared
 *    `promo_events` Analytics Engine dataset with the schema in `./worker`.
 *
 * Nothing identifies the visitor: an event names the step, where the promo was
 * shown, its wording and its language, never who followed it.
 *
 * This module has no side effects and touches no browser or Worker globals,
 * so the page (`./page`) and the Worker (`./worker`) can both import it.
 */
/** The sites whose promos link to the others. */
export declare const PROMO_SOURCES: readonly ["rankmaker", "backrooms"];
export type PromoSource = (typeof PROMO_SOURCES)[number];
/** The steps every site counts: arriving, and staying 10 s, 1 min and 3 min. */
export declare const VISIT_STEPS: readonly ["arrive", "stay-10s", "stay-1m", "stay-3m"];
export type VisitStep = (typeof VISIT_STEPS)[number];
/** A placement or wording id: short, lowercase, URL-safe. */
export declare const PROMO_ID: RegExp;
/** A two-letter base language. */
export declare const PROMO_LOCALE: RegExp;
/** How long an arrival keeps counting the steps that follow it. */
export declare const PROMO_ATTRIBUTION_TTL_MS: number;
/** The URL parameters a promo link carries, all removed on arrival. */
export declare const PROMO_PARAMS: readonly ["utm_source", "utm_medium", "utm_content", "utm_term", "promo_lang"];
/** The body of `POST /api/promo-event`. */
export interface PromoEvent<Promo extends string = string, Step extends string = string> {
    event: Step;
    promo: Promo;
    source: PromoSource;
    placement: string;
    locale: string;
    /** The wording the promo was shown with, or '' when the link named none. */
    variant: string;
}
/** An arrival from a promo, as the page keeps it. */
export interface PromoAttribution<Promo extends string = string, Step extends string = string> extends Omit<PromoEvent<Promo, Step>, 'event'> {
    /** When the visitor arrived (ms since the epoch). */
    at: number;
    /** The steps already reported for this arrival. */
    sent: Step[];
}
/** One site's funnel: its name in the dataset and every step it counts. */
export interface PromoFunnel<Promo extends string = string, Step extends string = string> {
    readonly promo: Promo;
    /** The visit steps, then the site's own, in the order a visit reaches them. */
    readonly steps: readonly Step[];
    isStep(value: unknown): value is Step;
    /** A request body, strictly validated with only its known fields, or null. */
    parseEvent(value: unknown): PromoEvent<Promo, Step> | null;
    /** The arrival a promo link carries, or null when the URL is not one. */
    parseArrival(url: URL, pageLang: string, now: number): PromoAttribution<Promo, Step> | null;
    /** A stored arrival, if it is well-formed and within its seven days. */
    parseStoredAttribution(raw: string | null, now: number): PromoAttribution<Promo, Step> | null;
}
export declare function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T;
export declare function isPromoSource(value: unknown): value is PromoSource;
/** The two-letter base language of a BCP 47 tag, if it has one. */
export declare function baseLanguage(tag: string): string | undefined;
/** The URL without the promo parameters, as a path for `history.replaceState`. */
export declare function stripPromoParams(url: URL): string;
/**
 * Define a site's funnel: its name in the `promo_events` dataset and the steps
 * of its own that follow the visit steps, e.g.
 * `definePromoFunnel('blitz', ['open-app', 'sign-in'])`.
 */
export declare function definePromoFunnel<const Promo extends string, const Own extends readonly string[]>(promo: Promo, own: Own): PromoFunnel<Promo, VisitStep | Own[number]>;
