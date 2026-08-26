import { beforeAll, describe, expect, it } from 'vitest';
import { decode, encode } from 'html-entities';

// Runs the real `i18n` and the real encoder, like UIPermissionDialog.rendering.test.js:
// a stubbed i18n echoes keys and cannot tell single- from double-encoding.
globalThis.window = globalThis.window ?? {};
globalThis.html_encode = (str) => encode(str);

let MODES, mode_label, options_for;

beforeAll(async () => {
    await import('../i18n/i18n.js'); // installs window.i18n
    globalThis.i18n = window.i18n;
    ({ MODES, mode_label, options_for } = await import('./shareModes.js'));
});

// What the browser renders for a fragment of HTML-safe markup.
const as_text = (html) => decode(html);

describe('mode_label', () => {
    it('encodes exactly once, so "&" survives as "&"', () => {
        const label = mode_label('manage');
        expect(label).toBe('Can edit &amp; share');
        expect(as_text(label)).toBe('Can edit & share');
        // The bug this guards: encoding an already-encoded label again.
        expect(label).not.toContain('&amp;amp;');
    });

    it('labels the modes the dialogs offer', () => {
        expect(as_text(mode_label('read'))).toBe('Can view');
        expect(as_text(mode_label('write'))).toBe('Can edit');
    });

    it('shows an out-of-band mode as-is', () => {
        expect(mode_label('see')).toBe('see');
        expect(mode_label('list')).toBe('list');
    });

    it('encodes an unrecognized mode rather than trusting it', () => {
        expect(mode_label('<img src=x onerror=alert(1)>')).not.toContain('<img');
    });
});

describe('options_for', () => {
    const values = (html) => [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);

    it('offers the three modes with the current one selected', () => {
        const html = options_for('read');
        expect(values(html)).toEqual(MODES);
        expect(html).toContain('<option value="read" selected>');
    });

    it('selects a non-default mode without reordering', () => {
        const html = options_for('manage');
        expect(values(html)).toEqual(MODES);
        expect(html).toContain('<option value="manage" selected>');
        expect(html).not.toContain('<option value="read" selected>');
    });

    it('withholds `manage` from someone who cannot grant it', () => {
        // Offering it to a delegate is a dead end the server refuses.
        const html = options_for('read', { allow_manage: false });
        expect(values(html)).toEqual(['read', 'write']);
        expect(html).not.toContain('value="manage"');
    });

    it('still shows a row already set to `manage`, so opening the dialog does not downgrade it', () => {
        const html = options_for('manage', { allow_manage: false });
        expect(values(html)).toEqual(MODES);
        expect(html).toContain('<option value="manage" selected>');
    });

    it('keeps an out-of-band mode instead of rounding it to read', () => {
        const html = options_for('see');
        expect(values(html)).toEqual(['see', ...MODES]);
        expect(html).toContain('<option value="see" selected>');
    });

    it('renders each label encoded exactly once', () => {
        expect(options_for('read')).toContain('>Can edit &amp; share</option>');
        expect(options_for('read')).not.toContain('&amp;amp;');
    });

    it('rests on an unselectable placeholder when the grants disagree', () => {
        // A batch of mixed modes must not read as any one of them.
        const html = options_for(null);
        expect(values(html)).toEqual(['', ...MODES]);
        expect(html).toContain('<option value="" selected disabled>Mixed</option>');
        expect(html).not.toContain('<option value="read" selected>');
    });

    it('treats a missing mode the same as a mixed one', () => {
        expect(options_for(undefined)).toBe(options_for(null));
    });
});
