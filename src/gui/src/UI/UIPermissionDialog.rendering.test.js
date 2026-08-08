import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decode, encode } from 'html-entities';

// What the user actually sees: these run the *real* `i18n` and the real encoder,
// unlike UIPermissionDialog.test.js which stubs `i18n` to echo keys. That stub is
// right for asserting which wording was chosen, but it cannot catch an encoding
// mistake — `i18n()` HTML-encodes the whole interpolated string, so composing two
// calls double-encodes and the stub renders both identically.
globalThis.window = globalThis.window ?? {};
window.api_origin = 'https://api.test';
window.auth_token = 'tok';
globalThis.html_encode = (str) => encode(str);

let get_app_data_description;

beforeAll(async () => {
    await import('../i18n/i18n.js'); // installs window.i18n
    globalThis.i18n = window.i18n;
    ({ get_app_data_description } = await import('./UIPermissionDialog.js'));
});

const CONTACTS = 'app-contacts';

const stubApp = (app) => {
    globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, result: app }),
    }));
};

const render = async (permission) => {
    const d = await get_app_data_description(permission.split(':'), {
        app_uid: 'app-calendar',
    });
    return d.html;
};

describe('UIPermissionDialog app-data rendering', () => {
    beforeAll(() => stubApp({ uid: CONTACTS, title: 'Contacts' }));

    it('encodes the apostrophe exactly once', async () => {
        const html = await render(`app-data:${CONTACTS}:kv:get`);
        // Decoding once must yield readable text. If both `i18n` levels encoded,
        // the user would see a literal `&#39;` in the prompt instead.
        expect(decode(html)).toContain("Contacts's saved data");
        expect(html).not.toContain('&amp;');
    });

    it('reads correctly for every scope shape', async () => {
        for (const permission of [
            `app-data:${CONTACTS}:kv:get`,
            `app-data:${CONTACTS}:kv:set`,
            `app-data:${CONTACTS}:kv:del`,
            `app-data:${CONTACTS}:kv`,
            `app-data:${CONTACTS}:fs:read`,
            `app-data:${CONTACTS}`,
        ]) {
            const html = await render(permission);
            expect(html).not.toContain('&amp;');
            expect(decode(html)).toContain('Contacts');
        }
    });

    it('names deletion for scopes that imply it', async () => {
        expect(decode(await render(`app-data:${CONTACTS}:kv:del`))).toContain(
            'delete',
        );
        // Store- and app-wide scopes cover deletion by prefix implication, so
        // the wording has to say so.
        expect(decode(await render(`app-data:${CONTACTS}:kv`))).toContain(
            'delete',
        );
        expect(decode(await render(`app-data:${CONTACTS}`))).toContain('delete');
    });

    it('names reading for a write scope, which confers it', async () => {
        // `write` satisfies `get`/`list` through the exploder, so a prompt that
        // said only "change" would understate what the user is approving.
        expect(decode(await render(`app-data:${CONTACTS}:kv:set`))).toContain(
            'read',
        );
    });

    it('escapes a hostile app title exactly once', async () => {
        stubApp({ uid: CONTACTS, title: '<img src=x onerror=alert(1)>' });
        const html = await render(`app-data:${CONTACTS}:kv:get`);
        expect(html).not.toContain('<img');
        expect(decode(html)).toContain('<img');
        stubApp({ uid: CONTACTS, title: 'Contacts' });
    });
});
