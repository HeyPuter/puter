import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
    globalThis.window = globalThis;
    globalThis.html_encode = value => String(value);
});

describe('embed translations', () => {
    it('starts in English and loads only the requested language', async () => {
        const { loadLocale } = await import('./embedI18n.js');
        window.locale = 'de';
        expect(i18n('close')).toBe('Close');
        await loadLocale('de');
        expect(i18n('close')).toBe('Schließen');
        expect(i18n('toolbar_apps')).toBe('Your apps');
    });

    it('keeps English for unknown or unsafe language values', async () => {
        const { loadLocale } = await import('./embedI18n.js');
        for ( const locale of ['xx', '../translations', 'en', null] ) {
            window.locale = locale;
            await loadLocale(locale);
            expect(i18n('close')).toBe('Close');
        }
    });
});
