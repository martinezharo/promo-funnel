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
export const PROMO_SOURCES = ['rankmaker', 'backrooms'] as const;
export type PromoSource = (typeof PROMO_SOURCES)[number];

/** The steps every site counts: arriving, and staying 10 s, 1 min and 3 min. */
export const VISIT_STEPS = ['arrive', 'stay-10s', 'stay-1m', 'stay-3m'] as const;
export type VisitStep = (typeof VISIT_STEPS)[number];

/** A placement or wording id: short, lowercase, URL-safe. */
export const PROMO_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A two-letter base language. */
export const PROMO_LOCALE = /^[a-z]{2}$/;

/** How long an arrival keeps counting the steps that follow it. */
export const PROMO_ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The URL parameters a promo link carries, all removed on arrival. */
export const PROMO_PARAMS = ['utm_source', 'utm_medium', 'utm_content', 'utm_term', 'promo_lang'] as const;

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
export interface PromoAttribution<Promo extends string = string, Step extends string = string>
  extends Omit<PromoEvent<Promo, Step>, 'event'> {
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

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function isPromoSource(value: unknown): value is PromoSource {
  return isOneOf(PROMO_SOURCES, value);
}

const isPlacement = (value: unknown): value is string => typeof value === 'string' && PROMO_ID.test(value);
const isLocale = (value: unknown): value is string => typeof value === 'string' && PROMO_LOCALE.test(value);
const isVariant = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || PROMO_ID.test(value));

/** The two-letter base language of a BCP 47 tag, if it has one. */
export function baseLanguage(tag: string): string | undefined {
  const base = tag.split('-', 1)[0]?.toLowerCase() ?? '';
  return PROMO_LOCALE.test(base) ? base : undefined;
}

/** The URL without the promo parameters, as a path for `history.replaceState`. */
export function stripPromoParams(url: URL): string {
  const clean = new URL(url);
  for (const name of PROMO_PARAMS) clean.searchParams.delete(name);
  return `${clean.pathname}${clean.search}${clean.hash}`;
}

/**
 * Define a site's funnel: its name in the `promo_events` dataset and the steps
 * of its own that follow the visit steps, e.g.
 * `definePromoFunnel('blitz', ['open-app', 'sign-in'])`.
 */
export function definePromoFunnel<const Promo extends string, const Own extends readonly string[]>(
  promo: Promo,
  own: Own,
): PromoFunnel<Promo, VisitStep | Own[number]> {
  type Step = VisitStep | Own[number];
  if (!PROMO_ID.test(promo)) throw new Error(`Invalid promo name: ${promo}`);
  const steps: readonly Step[] = [...VISIT_STEPS, ...own];
  for (const step of steps) {
    if (!PROMO_ID.test(step)) throw new Error(`Invalid promo step: ${step}`);
  }
  const isStep = (value: unknown): value is Step => isOneOf(steps, value);

  return {
    promo,
    steps,
    isStep,

    parseEvent(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
      const { event, promo: named, source, placement, locale, variant } = value as Record<string, unknown>;
      if (!isStep(event) || named !== promo || !isPromoSource(source)) return null;
      if (!isPlacement(placement) || !isLocale(locale) || !isVariant(variant)) return null;
      return { event, promo, source, placement, locale, variant };
    },

    parseArrival(url, pageLang, now) {
      const params = url.searchParams;
      if (params.get('utm_medium') !== 'promo') return null;
      const source = params.get('utm_source');
      const placement = params.get('utm_content') ?? '';
      if (!isPromoSource(source) || !isPlacement(placement)) return null;
      const promoLang = params.get('promo_lang') ?? '';
      const term = params.get('utm_term') ?? '';
      return {
        promo,
        source,
        placement,
        locale: isLocale(promoLang) ? promoLang : (baseLanguage(pageLang) ?? 'en'),
        variant: PROMO_ID.test(term) ? term : '',
        at: now,
        sent: [],
      };
    },

    parseStoredAttribution(raw, now) {
      if (!raw) return null;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
      if (value === null || typeof value !== 'object') return null;
      const { promo: named, source, placement, locale, variant, at, sent } = value as Record<string, unknown>;
      if (named !== promo || !isPromoSource(source)) return null;
      if (!isPlacement(placement) || !isLocale(locale) || !isVariant(variant)) return null;
      if (typeof at !== 'number' || !Number.isFinite(at) || now - at > PROMO_ATTRIBUTION_TTL_MS) return null;
      if (!Array.isArray(sent) || !sent.every(isStep)) return null;
      return { promo, source, placement, locale, variant, at, sent };
    },
  };
}
