/**
 * The promo funnel, seen from the page: a visitor arrives from a promo, and
 * each step they go on to take here is reported once to the site's
 * `POST /api/promo-event` (see `./worker`).
 *
 *  - The promo link's parameters become an arrival in localStorage, replacing
 *    any older one, and are taken out of the URL so a bookmark or a shared link
 *    does not count again.
 *  - An arrival lives seven days, and reports each step at most once.
 *  - Time on the site is only counted in the tab the visitor arrived in, and
 *    only while it is visible.
 *  - Browsers driven by automation (`navigator.webdriver`) report nothing, so
 *    end-to-end tests never reach the numbers.
 *
 * Nothing here may break or slow the page: every storage access tolerates a
 * browser that refuses it, and a failed report is simply lost.
 */
import { stripPromoParams, type PromoAttribution, type PromoEvent, type PromoFunnel } from './index.js';

export interface PromoTrackerOptions<Step extends string> {
  /** Where steps are reported. Default: `/api/promo-event` on this origin. */
  endpoint?: string;
  /**
   * The step a followed link is, if any (a download, the app). Checked on
   * every click and middle click, before the page navigates.
   */
  linkStep?: (link: HTMLAnchorElement) => Step | null;
  /** Count automated browsers too (for a site's own funnel tests). Default: false. */
  countAutomation?: boolean;
}

export interface PromoTracker<Step extends string> {
  /** Run on every page load, before anything rewrites the URL. */
  start(): void;
  /**
   * Report a step, once per arrival. A no-op for a visitor who did not come
   * from a promo, or came more than seven days ago. Safe to call from
   * anywhere, any number of times, before or after `start`.
   */
  track(step: Step): void;
}

const ATTRIBUTION_KEY = 'promo-attribution';
/** Marks the tab the visitor arrived in: only its time on the site counts. */
const VISIT_KEY = 'promo-visit';
/** Visible time accumulated across the page loads of the arrival tab. */
const VISIBLE_KEY = 'promo-visible-ms';

/** Time-on-site steps, by the visible time that earns them. */
const STAY_STEPS = [
  [10_000, 'stay-10s'],
  [60_000, 'stay-1m'],
  [180_000, 'stay-3m'],
] as const;

/** How often visible time is saved while the tab is in view. */
const TICK_MS = 5_000;
/** The most one tick may add, so a laptop asleep with the tab open adds nothing. */
const MAX_TICK_MS = 10_000;
/**
 * The same promo link again this soon is the same arrival: an app that sends
 * a link on to another page with its tags, or a reload before the URL was
 * cleaned.
 */
const SAME_ARRIVAL_MS = 30_000;

// Storage: each access may throw (private modes, blocked site data).

const local = (): Storage => localStorage;
const session = (): Storage => sessionStorage;

function storageGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Nowhere to keep it: the funnel loses this visitor, the page does not care.
  }
}

function storageRemove(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    // As above.
  }
}

function automated(): boolean {
  try {
    return navigator.webdriver === true;
  } catch {
    return true;
  }
}

export function isSameArrival(stored: PromoAttribution | null, fresh: PromoAttribution): boolean {
  return (
    stored !== null &&
    fresh.at - stored.at >= 0 &&
    fresh.at - stored.at < SAME_ARRIVAL_MS &&
    stored.source === fresh.source &&
    stored.placement === fresh.placement &&
    stored.locale === fresh.locale &&
    stored.variant === fresh.variant
  );
}

export function createPromoTracker<Promo extends string, Step extends string>(
  funnel: PromoFunnel<Promo, Step>,
  options: PromoTrackerOptions<Step> = {},
): PromoTracker<Step> {
  const endpoint = options.endpoint ?? '/api/promo-event';
  const off = (): boolean => !options.countAutomation && automated();
  // The visit steps are part of every funnel (definePromoFunnel).
  const visit = (step: string) => step as Step;

  /** The live arrival, dropping one that expired or cannot be read. */
  const load = (): PromoAttribution<Promo, Step> | null => {
    const raw = storageGet(local, ATTRIBUTION_KEY);
    const attribution = funnel.parseStoredAttribution(raw, Date.now());
    if (!attribution && raw !== null) storageRemove(local, ATTRIBUTION_KEY);
    return attribution;
  };

  const post = (event: Step, { promo, source, placement, locale, variant }: PromoAttribution<Promo, Step>): void => {
    const body: PromoEvent<Promo, Step> = { event, promo, source, placement, locale, variant };
    try {
      void fetch(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch {
      // A missing or refusing fetch costs the event, nothing else.
    }
  };

  const track = (step: Step): void => {
    try {
      if (off()) return;
      const attribution = load();
      if (!attribution || attribution.sent.includes(step)) return;
      // Recorded before sending: a step is better lost than counted twice.
      attribution.sent.push(step);
      storageSet(local, ATTRIBUTION_KEY, JSON.stringify(attribution));
      post(step, attribution);
    } catch {
      // Never let the funnel get in the page's way.
    }
  };

  /** Turn a promo link's parameters into an arrival, then clean the URL. */
  const recordArrival = (): void => {
    const url = new URL(location.href);
    const fresh = funnel.parseArrival(url, document.documentElement.lang, Date.now());
    if (!fresh) return;
    history.replaceState(history.state, '', stripPromoParams(url));
    if (isSameArrival(load(), fresh)) return;
    storageSet(local, ATTRIBUTION_KEY, JSON.stringify(fresh));
    track(visit('arrive'));
    storageSet(session, VISIT_KEY, '1');
    // A new arrival starts its own clock, even in a tab that came before.
    storageSet(session, VISIBLE_KEY, '0');
  };

  /**
   * Count the visible time of the arrival tab, reporting each stay step as it
   * is crossed. Saved on every tick, when the tab is hidden and when it
   * unloads, so the next page load of the same tab picks up where this left.
   */
  const trackVisibleTime = (): void => {
    if (storageGet(session, VISIT_KEY) !== '1') return;
    const pending = (attribution: PromoAttribution<Promo, Step> | null) =>
      attribution ? STAY_STEPS.filter(([, step]) => !attribution.sent.includes(visit(step))) : [];
    if (pending(load()).length === 0) return;

    let total = Number(storageGet(session, VISIBLE_KEY)) || 0;
    let since: number | null = document.visibilityState === 'visible' ? performance.now() : null;

    const save = (): void => {
      const now = performance.now();
      if (since !== null) {
        total += Math.min(Math.max(now - since, 0), MAX_TICK_MS);
        since = document.visibilityState === 'visible' ? now : null;
      }
      storageSet(session, VISIBLE_KEY, String(Math.round(total)));
      const left = pending(load());
      for (const [threshold, step] of left) {
        if (total >= threshold) track(visit(step));
      }
      if (left.every(([threshold]) => total >= threshold)) stop();
    };
    const onVisibility = (): void => {
      save();
      if (document.visibilityState === 'visible') since ??= performance.now();
    };
    const stop = (): void => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pagehide', save);
    };

    const timer = setInterval(() => {
      if (since !== null) save();
    }, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('pagehide', save);
  };

  /** Report the links that are steps when they are followed, middle clicks included. */
  const trackLinks = (linkStep: (link: HTMLAnchorElement) => Step | null): void => {
    const onClick = (event: MouseEvent): void => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const step = linkStep(link);
      if (step) track(step);
    };
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('auxclick', onClick, { capture: true });
  };

  return {
    track,
    start() {
      try {
        if (off()) return;
        recordArrival();
        trackVisibleTime();
        if (options.linkStep) trackLinks(options.linkStep);
      } catch {
        // As everywhere here: the funnel is never worth an error on the page.
      }
    },
  };
}
