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
import { type PromoAttribution, type PromoFunnel } from './index.js';
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
export declare function isSameArrival(stored: PromoAttribution | null, fresh: PromoAttribution): boolean;
export declare function createPromoTracker<Promo extends string, Step extends string>(funnel: PromoFunnel<Promo, Step>, options?: PromoTrackerOptions<Step>): PromoTracker<Step>;
