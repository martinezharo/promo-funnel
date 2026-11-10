import { describe, expect, it } from 'vitest';
import { definePromoFunnel, PROMO_ATTRIBUTION_TTL_MS, stripPromoParams } from '../src/index';

const funnel = definePromoFunnel('icarus', ['download', 'open-app']);
const ARRIVAL = 'https://icarus.4oli.com/?utm_source=backrooms&utm_medium=promo&utm_content=pause&utm_term=private-diary&promo_lang=zh#faq';

describe('definePromoFunnel', () => {
  it('puts the visit steps first', () => {
    expect(funnel.steps).toEqual(['arrive', 'stay-10s', 'stay-1m', 'stay-3m', 'download', 'open-app']);
  });

  it('refuses names that could not be counted', () => {
    expect(() => definePromoFunnel('Bad Name', [])).toThrow();
    expect(() => definePromoFunnel('ok', ['Not OK'])).toThrow();
  });
});

describe('parseArrival', () => {
  it('reads where the promo was shown, in which wording and language', () => {
    expect(funnel.parseArrival(new URL(ARRIVAL), 'en', 5)).toEqual({
      promo: 'icarus', source: 'backrooms', placement: 'pause', locale: 'zh', variant: 'private-diary', at: 5, sent: [],
    });
  });

  it('falls back to the page language and no wording', () => {
    const url = new URL('https://x.dev/?utm_source=rankmaker&utm_medium=promo&utm_content=home&utm_term=Bad%20Term');
    expect(funnel.parseArrival(url, 'pt-BR', 0)).toMatchObject({ locale: 'pt', variant: '' });
    expect(funnel.parseArrival(url, '', 0)).toMatchObject({ locale: 'en' });
  });

  it('ignores links that are not a promo from a known site', () => {
    expect(funnel.parseArrival(new URL('https://x.dev/?utm_medium=email'), 'en', 0)).toBeNull();
    expect(funnel.parseArrival(new URL('https://x.dev/?utm_source=x&utm_medium=promo&utm_content=a'), 'en', 0)).toBeNull();
    expect(funnel.parseArrival(new URL('https://x.dev/?utm_source=backrooms&utm_medium=promo'), 'en', 0)).toBeNull();
  });
});

describe('stripPromoParams', () => {
  it('keeps everything but the promo tags', () => {
    expect(stripPromoParams(new URL(ARRIVAL.replace('#faq', '&keep=1#faq')))).toBe('/?keep=1#faq');
  });
});

describe('parseStoredAttribution', () => {
  const stored = funnel.parseArrival(new URL(ARRIVAL), 'en', 1000)!;

  it('keeps one within its seven days', () => {
    expect(funnel.parseStoredAttribution(JSON.stringify(stored), 1000 + PROMO_ATTRIBUTION_TTL_MS)).toEqual(stored);
  });

  it('drops an expired, foreign or malformed one', () => {
    expect(funnel.parseStoredAttribution(JSON.stringify(stored), 1001 + PROMO_ATTRIBUTION_TTL_MS)).toBeNull();
    expect(funnel.parseStoredAttribution('{', 0)).toBeNull();
    expect(funnel.parseStoredAttribution(null, 0)).toBeNull();
    expect(funnel.parseStoredAttribution(JSON.stringify({ ...stored, promo: 'blitz' }), 1000)).toBeNull();
    expect(funnel.parseStoredAttribution(JSON.stringify({ ...stored, sent: ['sign-in'] }), 1000)).toBeNull();
  });
});

describe('parseEvent', () => {
  const event = { event: 'download', promo: 'icarus', source: 'backrooms', placement: 'pause', locale: 'en', variant: '' };

  it('accepts a step of this funnel and drops extra fields', () => {
    expect(funnel.parseEvent({ ...event, extra: 1 })).toEqual(event);
    expect(funnel.parseEvent({ ...event, event: 'stay-3m', variant: 'private-diary' })).not.toBeNull();
  });

  it('rejects anything else', () => {
    for (const bad of [
      { ...event, event: 'sign-in' },
      { ...event, promo: 'sendself' },
      { ...event, source: 'sendself' },
      { ...event, placement: '' },
      { ...event, locale: 'eng' },
      { ...event, variant: 'Bad Variant' },
      { ...event, variant: undefined },
    ]) expect(funnel.parseEvent(bad)).toBeNull();
    expect(funnel.parseEvent(null)).toBeNull();
    expect(funnel.parseEvent([event])).toBeNull();
  });
});
