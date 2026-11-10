# promo-funnel

What a visitor who followed a promo on one of the author's sites (RANKMAKER,
Backrooms) went on to do on the site it promoted: the shared contract, the
page tracker and the Worker handler, so every promoted site counts the same
way. The private promo-stats dashboard reads the numbers.

Used by SendSelf, Blitz, Icarus and Vidshelf.

## Install

Not on npm: sites install a tagged commit from GitHub.

```sh
pnpm add github:martinezharo/promo-funnel#v1.0.0
```

`dist/` is committed, so nothing is built on install. Change `src/`, run
`pnpm build`, commit both, and tag a new version.

## Use

```ts
// The site's funnel: its name in the dataset and its own steps, after
// arrive, stay-10s, stay-1m and stay-3m.
import { definePromoFunnel } from '@martinezharo/promo-funnel';
export const funnel = definePromoFunnel('blitz', ['open-app', 'sign-in']);
```

```ts
// The page, on every load.
import { createPromoTracker } from '@martinezharo/promo-funnel/page';
const promo = createPromoTracker(funnel, {
  // Optional: links that are steps when followed.
  linkStep: (link) => (link.pathname.startsWith('/download/') ? 'download' : null),
});
promo.start();
promo.track('sign-in'); // anywhere, any number of times
```

```ts
// The Worker.
import { handlePromoEvent } from '@martinezharo/promo-funnel/worker';
if (url.pathname === '/api/promo-event') return handlePromoEvent(request, env.PROMO_ANALYTICS, funnel);
```

A Worker with its own error format or rate limits uses `readPromoEvent` and
`writePromoEvent` instead.

## The contract

- A promo link carries `utm_medium=promo`, `utm_source` (`rankmaker` or
  `backrooms`), `utm_content` (where it was shown), `utm_term` (its wording,
  while one is on test) and `promo_lang` (the reader's two-letter language).
- On arrival the page keeps those in `localStorage` (`promo-attribution`) for
  seven days, reports `arrive` and takes the tags off the URL. The same link
  again within 30 seconds is the same arrival.
- Each step is reported at most once per arrival. The stays count visible
  time in the tab the visitor arrived in, at most 10 seconds per 5-second
  tick, so a sleeping laptop adds nothing.
- Automated browsers (`navigator.webdriver`) report nothing, unless the
  tracker is created with `countAutomation: true`.
- The Worker accepts only same-origin JSON of at most 256 bytes naming a step
  of its own funnel, and writes it to Analytics Engine as
  `blobs: [event, source, promo, placement, locale, variant]`, `doubles: [1]`,
  `indexes: [promo]`. Nothing about the visitor is stored.

To add a source site, add it to `PROMO_SOURCES` and release a new version.
