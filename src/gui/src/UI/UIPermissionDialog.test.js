import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dialog module has no imports — it reads globals — so they are defined
// before it loads. `i18n` echoes the key and params so a test can assert which
// wording was chosen rather than the English text itself.
globalThis.window = globalThis.window ?? {};
window.api_origin = 'https://api.test';
window.auth_token = 'tok';
globalThis.i18n = (key, params = {}) =>
    `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`;

const { get_app_data_description, get_kv_share_description } =
    await import('./UIPermissionDialog.js');

const CONTACTS = 'app-contacts';
const CALENDAR = 'app-calendar';
const OWNER = '2a1b0c9d-0000-4000-8000-000000000001';

/** Stub the app lookup the describer performs. */
const stubApp = (app) => {
    globalThis.fetch = vi.fn(async () => ({
        ok: app !== null,
        json: async () => ({ success: true, result: app }),
    }));
};

const describeScope = (permission, options = { app_uid: CALENDAR }) =>
    get_app_data_description(permission.split(':'), options);

describe('UIPermissionDialog app-data descriptions', () => {
    beforeEach(() => {
        stubApp({ uid: CONTACTS, name: 'contacts', title: 'Contacts' });
    });

    it('names the target app and the read verb', async () => {
        const d = await describeScope(`app-data:${CONTACTS}:kv:get`);
        expect(d.html).toContain('perm_app_data_read');
        expect(d.html).toContain('Contacts');
    });

    it('says "change" for a write and "delete" for a deletion', async () => {
        expect((await describeScope(`app-data:${CONTACTS}:kv:set`)).html)
            .toContain('perm_app_data_change');
        // Deletion must be named, not folded into "change".
        expect((await describeScope(`app-data:${CONTACTS}:kv:del`)).html)
            .toContain('perm_app_data_delete');
        expect((await describeScope(`app-data:${CONTACTS}:kv:delete`)).html)
            .toContain('perm_app_data_delete');
    });

    it('distinguishes files from saved data', async () => {
        expect((await describeScope(`app-data:${CONTACTS}:fs:read`)).html)
            .toContain('perm_app_data_subject_files');
        expect((await describeScope(`app-data:${CONTACTS}:kv:read`)).html)
            .toContain('perm_app_data_subject_data');
    });

    it('names deletion for a store-wide scope, which implies it', async () => {
        const d = await describeScope(`app-data:${CONTACTS}:kv`);
        expect(d.html).toContain('perm_app_data_store_all');
    });

    it('names deletion for an app-wide scope too', async () => {
        const d = await describeScope(`app-data:${CONTACTS}`);
        expect(d.html).toContain('perm_app_data_all');
        expect(d.html).toContain('Contacts');
    });

    // -- the cases that must never prompt ---------------------------------

    it('refuses to describe a request for the requester’s own data', async () => {
        // Already implicit, so a prompt would ask the user to approve nothing.
        expect(
            await describeScope(`app-data:${CALENDAR}:kv:get`, {
                app_uid: CALENDAR,
            }),
        ).toBeNull();
    });

    it('refuses when the target app does not exist', async () => {
        stubApp(null);
        expect(await describeScope(`app-data:${CONTACTS}:kv:get`)).toBeNull();
    });

    it('refuses when the target app opted out of sharing', async () => {
        stubApp({
            uid: CONTACTS,
            title: 'Contacts',
            metadata: { share_app_data: false },
        });
        expect(await describeScope(`app-data:${CONTACTS}:kv:get`)).toBeNull();
    });

    it('refuses a missing target, unknown store, or unknown op', async () => {
        expect(await describeScope('app-data')).toBeNull();
        expect(await describeScope('app-data:')).toBeNull();
        expect(await describeScope(`app-data:${CONTACTS}:sql:read`)).toBeNull();
        expect(await describeScope(`app-data:${CONTACTS}:kv:flush`)).toBeNull();
        expect(await describeScope(`app-data:${CONTACTS}:kv:bogus`)).toBeNull();
    });

    it('treats a failed lookup as undescribable rather than throwing', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        });
        expect(await describeScope(`app-data:${CONTACTS}:kv:get`)).toBeNull();
    });
});

describe('UIPermissionDialog key-value delegation descriptions', () => {
    beforeEach(() => {
        stubApp({ uid: CALENDAR, name: 'calendar', title: 'Calendar' });
        globalThis.puter = { auth: { whoami: async () => ({ uuid: OWNER }) } };
    });

    const describeShare = (permission, options = { app_uid: CALENDAR }) =>
        get_kv_share_description(permission.split(':'), options);

    it('names the app and the region, never the namespace', async () => {
        const d = await describeShare(
            `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
        );
        expect(d.html).toContain('perm_kv_share_manage');
        expect(d.html).toContain('Calendar');
        expect(d.html).toContain('region=workspace:abc:');
    });

    it('refuses a delegation naming no region', async () => {
        // The whole of the app's data: a different decision, and not one this
        // line can put to the user.
        expect(
            await describeShare(`manage:kv-share:${OWNER}:${CALENDAR}`),
        ).toBeNull();
        expect(await describeShare(`manage:kv-share:${OWNER}`)).toBeNull();
        expect(await describeShare('manage:kv-share')).toBeNull();
    });

    it('refuses a namespace that is not the requester’s own', async () => {
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CONTACTS}:workspace:abc`,
            ),
        ).toBeNull();
        // No requesting app at all — the popup flow — cannot be bounded either.
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
                { origin: 'https://site.example' },
            ),
        ).toBeNull();
    });

    it('refuses another user’s data', async () => {
        expect(
            await describeShare(
                `manage:kv-share:someone-else:${CALENDAR}:workspace:abc`,
            ),
        ).toBeNull();
    });
});
