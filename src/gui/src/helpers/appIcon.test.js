import { describe, expect, it, beforeAll } from 'vitest';
import {
    appIconAttrs,
    appIconFallbackAttr,
    appIconSrc,
    applyAppIconFallback,
} from './appIcon.js';

beforeAll(() => {
    globalThis.html_encode = (str) =>
        String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
});

const CDN = 'https://puter-app-icons.puter.site/app-1-256.png';
const ENDPOINT = 'https://api.puter.com/app-icon/app-1';

describe('appIconSrc', () => {
    it('loads the subdomain URL first and keeps the endpoint as a retry', () => {
        expect(appIconSrc({ iconCdnUrl: CDN, icon: ENDPOINT })).toEqual({
            src: CDN,
            fallback: ENDPOINT,
        });
        expect(appIconSrc({ iconCdnUrl: CDN, iconUrl: ENDPOINT })).toEqual({
            src: CDN,
            fallback: ENDPOINT,
        });
    });

    it('has nothing to retry when the backend sent one URL', () => {
        expect(appIconSrc({ icon: ENDPOINT })).toEqual({
            src: ENDPOINT,
            fallback: '',
        });
        expect(appIconSrc({ iconCdnUrl: CDN })).toEqual({
            src: CDN,
            fallback: '',
        });
        expect(appIconSrc({ iconCdnUrl: CDN, icon: CDN })).toEqual({
            src: CDN,
            fallback: '',
        });
    });

    it('uses the bundled default for an app with no icon', () => {
        expect(appIconSrc({}, 'default.svg').src).toBe('default.svg');
        expect(appIconSrc(null, 'default.svg').src).toBe('default.svg');
        expect(appIconSrc({ icon: null, iconCdnUrl: null }).src).toBe('');
    });
});

describe('appIconFallbackAttr / appIconAttrs', () => {
    it('emits the retry attribute only when there is a retry URL', () => {
        expect(appIconFallbackAttr(ENDPOINT)).toBe(
            ` data-icon-fallback="${ENDPOINT}"`,
        );
        expect(appIconFallbackAttr('')).toBe('');
    });

    it('encodes both URLs into img attributes', () => {
        expect(appIconAttrs({ iconCdnUrl: CDN, icon: ENDPOINT })).toBe(
            `src="${CDN}" data-icon-fallback="${ENDPOINT}"`,
        );
        expect(appIconAttrs({ icon: 'a"b' })).toBe('src="a&quot;b"');
    });
});

describe('applyAppIconFallback', () => {
    it('swaps in the retry URL once', () => {
        const img = { dataset: { iconFallback: ENDPOINT }, src: CDN };
        expect(applyAppIconFallback(img)).toBe(true);
        expect(img.src).toBe(ENDPOINT);

        // A failing retry must not loop back onto itself.
        expect(applyAppIconFallback(img)).toBe(false);
        expect(img.src).toBe(ENDPOINT);
    });

    it('leaves images without a retry URL alone', () => {
        const img = { dataset: {}, src: CDN };
        expect(applyAppIconFallback(img)).toBe(false);
        expect(img.src).toBe(CDN);
        expect(applyAppIconFallback(undefined)).toBe(false);
    });
});
