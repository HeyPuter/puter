import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dialog module reads `i18n` and other GUI plumbing as globals rather than
// importing them, so they are defined before it loads. `i18n` echoes the key
// and params so a test can assert which wording was chosen rather than the
// English text itself.
globalThis.window = globalThis.window ?? {};
window.api_origin = 'https://api.test';
window.auth_token = 'tok';
globalThis.i18n = (key, params = {}) =>
    `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`;

const {
    describe_permissions,
    get_app_data_description,
    get_kv_share_description,
    get_permission_description,
    guard_input,
} = await import('./UIPermissionDialog.js');

const CONTACTS = 'app-contacts';
const CALENDAR = 'app-calendar';
const OWNER = '2a1b0c9d-0000-4000-8000-000000000001';
const SITE = 'https://calendar.example';

/** Stub the app lookup the describer performs. */
const stubApp = (app) => {
    globalThis.fetch = vi.fn(async () => ({
        ok: app !== null,
        json: async () => ({ success: true, result: app }),
    }));
};

/** Stub the origin → app-uid lookup the popup flow's describers perform. */
const stubOriginApp = (uid) => {
    window.getAppUIDFromOrigin = vi.fn(async () => uid);
};

const describeScope = (permission, options = { app_uid: CALENDAR }) =>
    get_app_data_description(permission.split(':'), options);

describe('UIPermissionDialog app-data descriptions', () => {
    beforeEach(() => {
        stubApp({ uid: CONTACTS, name: 'contacts', title: 'Contacts' });
        delete window.getAppUIDFromOrigin;
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
    });

    it('names reading and changing for the delete class, which implies both', async () => {
        expect((await describeScope(`app-data:${CONTACTS}:kv:delete`)).html)
            .toContain('perm_app_data_store_all');
        expect((await describeScope(`app-data:${CONTACTS}:fs:delete`)).html)
            .toContain('perm_app_data_store_all');
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

    it.each([
        `app-data:${CONTACTS}:`,
        `app-data:${CONTACTS}:kv:`,
        `app-data:${CONTACTS}::get`,
        'app-data:contacts:kv:get',
    ])('refuses %s, which the grant route refuses, without a lookup', async (permission) => {
        expect(await describeScope(permission)).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses a target that only resolves through a merged app’s old uid', async () => {
        // The grant route reads the target by its own uid only.
        stubApp({ uid: 'app-merged-into', name: 'contacts', title: 'Contacts' });
        expect(await describeScope(`app-data:${CONTACTS}:kv:get`)).toBeNull();
    });

    it('treats a failed lookup as undescribable rather than throwing', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        });
        expect(await describeScope(`app-data:${CONTACTS}:kv:get`)).toBeNull();
    });

    it('refuses a site’s request for its own data', async () => {
        // The popup flow reaches the same self-request check the in-GUI flow does.
        stubOriginApp(CONTACTS);
        expect(
            await describeScope(`app-data:${CONTACTS}:kv:get`, { origin: SITE }),
        ).toBeNull();
    });

    it('still describes a cross-app request when the requester will not resolve', async () => {
        // An unresolvable requester only costs the self-request check here; it
        // must not deny a valid cross-app request.
        stubOriginApp(null);
        const d = await describeScope(`app-data:${CONTACTS}:kv:get`, { origin: SITE });
        expect(d.html).toContain('perm_app_data_read');
    });
});

describe('UIPermissionDialog key-value delegation descriptions', () => {
    beforeEach(() => {
        stubApp({ uid: CALENDAR, name: 'calendar', title: 'Calendar' });
        globalThis.puter = { auth: { whoami: async () => ({ uuid: OWNER }) } };
        delete window.getAppUIDFromOrigin;
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

    it.each([
        ['kv-share', 'perm_kv_share_manage('],
        ['kv-share-read', 'perm_kv_share_manage_read('],
        ['kv-share-write', 'perm_kv_share_manage_write('],
    ])('names the level a %s delegation lets the app share', async (root, line) => {
        const permission = `manage:${root}:${OWNER}:${CALENDAR}:workspace:abc`;
        const d = await describeShare(permission);
        expect(d.html.startsWith(line)).toBe(true);
        expect(d.html).toContain('region=workspace:abc:');
        expect((await get_permission_description(permission, { app_uid: CALENDAR })).html)
            .toBe(d.html);
    });

    it('refuses a delegation at a level that does not exist', async () => {
        const permission = `manage:kv-share-delete:${OWNER}:${CALENDAR}:workspace:abc`;
        expect(await describeShare(permission)).toBeNull();
        expect(await get_permission_description(permission, { app_uid: CALENDAR })).toBeNull();
    });

    it('refuses a delegation naming no region', async () => {
        // The whole of the app's data: a different decision, and not one this
        // line can put to the user.
        expect(
            await describeShare(`manage:kv-share:${OWNER}:${CALENDAR}`),
        ).toBeNull();
        expect(await describeShare(`manage:kv-share:${OWNER}`)).toBeNull();
        expect(await describeShare('manage:kv-share')).toBeNull();
        expect(
            await describeShare(`manage:kv-share-read:${OWNER}:${CALENDAR}`),
        ).toBeNull();
        expect(
            await describeShare(`manage:kv-share-write:${OWNER}:${CALENDAR}`),
        ).toBeNull();
    });

    it('refuses a namespace that is not the requester’s own', async () => {
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CONTACTS}:workspace:abc`,
            ),
        ).toBeNull();
    });

    it.each(['Workspace:abc', 'workspace:café', 'work space:abc', 'workspace::abc'])(
        'refuses a region the grant route would refuse: %s',
        async (region) => {
            expect(
                await describeShare(`manage:kv-share:${OWNER}:${CALENDAR}:${region}`),
            ).toBeNull();
        },
    );

    it.each(['kv-share', 'kv-share-read', 'kv-share-write'])(
        'refuses a %s delegation the grant route could not store',
        async (root) => {
            const head = `manage:${root}:${OWNER}:${CALENDAR}:`;
            const fits = `${head}${'a'.repeat(255 - head.length)}`;
            expect(await describeShare(fits)).not.toBeNull();
            expect(await describeShare(`${fits}a`)).toBeNull();
            // Every prefix over the `read`/`write` share limit is over it too.
            expect(await describeShare(`${head}${'a'.repeat(256)}`)).toBeNull();
        },
    );

    it('refuses a namespace that is not an app uid, without a lookup', async () => {
        expect(
            await describeShare(`manage:kv-share:${OWNER}:calendar:rooms`, { app_uid: 'calendar' }),
        ).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses a namespace that only resolves through a merged app’s old uid', async () => {
        stubApp({ uid: 'app-merged-into', name: 'calendar', title: 'Calendar' });
        expect(
            await describeShare(`manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`),
        ).toBeNull();
    });

    it('describes a region of lowercase letters, digits, `_`, `.` and `-`', async () => {
        const d = await describeShare(
            `manage:kv-share:${OWNER}:${CALENDAR}:room_1.a-b:x9`,
        );
        expect(d.html).toContain('region=room_1.a-b:x9:');
    });

    it('describes a delegation from a site that resolves to the namespace’s app', async () => {
        // The popup flow: the requester arrives as an origin, not a uid.
        stubOriginApp(CALENDAR);
        const d = await describeShare(
            `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
            { origin: SITE },
        );
        expect(d.html).toContain('perm_kv_share_manage');
        expect(d.html).toContain('Calendar');
        expect(d.html).toContain('region=workspace:abc:');
        expect(window.getAppUIDFromOrigin).toHaveBeenCalledWith(SITE);
    });

    it('refuses a site that resolves to a different app', async () => {
        stubOriginApp(CONTACTS);
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
                { origin: SITE },
            ),
        ).toBeNull();
    });

    it('refuses a site whose app uid does not resolve', async () => {
        stubOriginApp(null);
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
                { origin: SITE },
            ),
        ).toBeNull();
        // The lookup reports failure by value, both shapes.
        window.getAppUIDFromOrigin = vi.fn(async () => undefined);
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
                { origin: SITE },
            ),
        ).toBeNull();
    });

    it('refuses when the lookup itself throws', async () => {
        // A failed lookup must deny, never prompt.
        window.getAppUIDFromOrigin = vi.fn(async () => {
            throw new Error('network down');
        });
        expect(
            await describeShare(
                `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
                { origin: SITE },
            ),
        ).toBeNull();
    });

    it('keeps naming the requester by uid when the GUI supplies one', async () => {
        // A stub that would deny if it were consulted.
        stubOriginApp(CONTACTS);
        const d = await describeShare(
            `manage:kv-share:${OWNER}:${CALENDAR}:workspace:abc`,
        );
        expect(d.html).toContain('perm_kv_share_manage');
        expect(window.getAppUIDFromOrigin).not.toHaveBeenCalled();
    });

    it('refuses another user’s data', async () => {
        expect(
            await describeShare(
                `manage:kv-share:someone-else:${CALENDAR}:workspace:abc`,
            ),
        ).toBeNull();
    });
});

describe('UIPermissionDialog permission descriptions', () => {
    const FILE_UID = 'b3c1d2e4-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
    const DOCS_UID = 'c4d2e3f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
    const entries = {
        '/alice/notes.txt': { name: 'notes.txt', dirpath: '/alice', is_dir: false },
        '/alice/Projects': { name: 'Projects', dirpath: '/alice', is_dir: true },
        [FILE_UID]: { name: 'photo.png', dirpath: '/alice/Pictures', is_dir: false },
    };

    beforeEach(() => {
        stubApp({ uid: CALENDAR, name: 'calendar', title: 'Calendar' });
        delete window.getAppUIDFromOrigin;
        globalThis.puter = {
            auth: {
                whoami: async () => ({
                    uuid: OWNER,
                    username: 'alice',
                    directories: { '/alice/Documents': DOCS_UID },
                }),
            },
            fs: {
                stat: vi.fn(async ({ path, uid }) => {
                    const entry = entries[path ?? uid];
                    // The code `puter.fs.stat` rejects with for a missing entry.
                    if ( ! entry ) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
                    return entry;
                }),
            },
        };
    });

    const describe_ = (permission, options = { app_uid: CALENDAR }) =>
        get_permission_description(permission, options);

    it.each([
        'driver:puter-image-generation:generate',
        'service:ai-chat:ii:puter-chat-completion',
        'thread:abc:post',
        'manage:fs:/alice/notes.txt:write',
        'kv-share:someone:app-x:rooms',
        'flag:app-is-authenticated',
        'events',
        'events:background:extra',
        'random-string',
    ])('refuses %s without a lookup', async (permission) => {
        expect(await describe_(permission)).toBeNull();
        expect(puter.fs.stat).not.toHaveBeenCalled();
    });

    it('names an existing file or folder and what the access allows', async () => {
        expect((await describe_('fs:/alice/notes.txt:read')).html)
            .toBe('perm_fs_file_read(name=notes.txt,path=/alice)');
        expect((await describe_('fs:/alice/notes.txt:write')).html)
            .toBe('perm_fs_file_write(name=notes.txt,path=/alice)');
        expect((await describe_('fs:/alice/Projects:write')).html)
            .toBe('perm_fs_dir_write(name=Projects,path=/alice)');
        expect((await describe_('fs:/alice/Projects:list')).html)
            .toBe('perm_fs_dir_list(name=Projects,path=/alice)');
        // Listing a file shows no more than that it exists.
        expect((await describe_('fs:/alice/notes.txt:list')).html)
            .toBe('perm_fs_see(name=notes.txt,path=/alice)');
        expect((await describe_('fs:/alice/notes.txt:see')).html)
            .toBe('perm_fs_see(name=notes.txt,path=/alice)');
        // On a folder, `see` reaches every subfolder, so it has a line of its own.
        expect((await describe_('fs:/alice/Projects:see')).html)
            .toBe('perm_fs_dir_see(name=Projects,path=/alice)');
        expect((await describe_(`fs:${FILE_UID}:read`)).html)
            .toBe('perm_fs_file_read(name=photo.png,path=/alice/Pictures)');
    });

    it('names a special folder by path or uid', async () => {
        expect((await describe_('fs:/alice/Documents:write')).html)
            .toBe('perm_folder_write(folder=perm_folder_documents())');
        expect((await describe_(`fs:${DOCS_UID}:read`)).html)
            .toBe('perm_folder_read(folder=perm_folder_documents())');
    });

    it('describes a missing path only when it will be created', async () => {
        expect((await describe_('fs:/alice/.mail:write', { app_uid: CALENDAR, create: true })).html)
            .toBe('perm_fs_create_dir_write(name=.mail,path=/alice)');
        expect((await describe_('fs:/alice/draft.md:read', { app_uid: CALENDAR, create: 'file' })).html)
            .toBe('perm_fs_create_file_read(name=draft.md,path=/alice)');
        // Nothing to name and nothing to create: the grant would fail anyway.
        expect(await describe_('fs:/alice/missing:read', { app_uid: CALENDAR, create: false })).toBeNull();
        expect(await describe_(`fs:${CONTACTS}:read`, { app_uid: CALENDAR, create: true })).toBeNull();
        // The server only creates inside the user's own home.
        expect(await describe_('fs:/bob/new-folder:write', { app_uid: CALENDAR, create: true })).toBeNull();
    });

    it('refuses an fs permission with no mode, an unknown mode, or extra parts', async () => {
        expect(await describe_('fs:/alice/notes.txt')).toBeNull();
        expect(await describe_('fs:/alice/notes.txt:delete')).toBeNull();
        expect(await describe_('fs:/alice/notes.txt:read:extra')).toBeNull();
    });

    it('offers to create a path only when the lookup says it does not exist', async () => {
        const create = { app_uid: CALENDAR, create: true };
        // A 404 alone also means missing.
        puter.fs.stat.mockRejectedValueOnce({ status: 404, message: 'Not found' });
        expect((await describe_('fs:/alice/new-folder:write', create)).html)
            .toBe('perm_fs_create_dir_write(name=new-folder,path=/alice)');
        for ( const failure of [
            { code: 'forbidden', status: 403 },
            { status: 500, message: 'Internal Server Error' },
            new Error('network down'),
        ] ) {
            puter.fs.stat.mockRejectedValueOnce(failure);
            expect(await describe_('fs:/alice/new-folder:write', create)).toBeNull();
        }
    });

    it.each([
        '/alice/new/',
        '/alice//new',
        '/alice/./new',
        '/alice/../bob/new',
        '/alice/AppData/new',
        '/alice/appdata/other-app/new',
        '/alice/Trash/new',
        `/alice/${Array.from({ length: 17 }, (_, i) => `d${i}`).join('/')}`,
    ])('refuses to offer creating %s, which the grant route refuses', async (path) => {
        expect(await describe_(`fs:${path}:write`, { app_uid: CALENDAR, create: true })).toBeNull();
    });

    it('refuses an existing entry of the other kind than a forced `create`', async () => {
        expect(await describe_('fs:/alice/notes.txt:read', { app_uid: CALENDAR, create: 'dir' })).toBeNull();
        expect(await describe_('fs:/alice/Projects:read', { app_uid: CALENDAR, create: 'file' })).toBeNull();
        expect((await describe_('fs:/alice/Projects:read', { app_uid: CALENDAR, create: 'dir' })).html)
            .toBe('perm_fs_dir_read(name=Projects,path=/alice)');
        expect(await describe_('fs:/alice/Documents:read', { app_uid: CALENDAR, create: 'file' })).toBeNull();
        // `true` guesses, and a guess never conflicts. Nor does a uid, which
        // is never created.
        expect((await describe_('fs:/alice/notes.txt:read', { app_uid: CALENDAR, create: true })).html)
            .toBe('perm_fs_file_read(name=notes.txt,path=/alice)');
        expect((await describe_(`fs:${FILE_UID}:read`, { app_uid: CALENDAR, create: 'dir' })).html)
            .toBe('perm_fs_file_read(name=photo.png,path=/alice/Pictures)');
    });

    it('offers to create a path as deep as the grant route allows', async () => {
        const path = `/alice/${Array.from({ length: 16 }, (_, i) => `d${i}`).join('/')}`;
        expect((await describe_(`fs:${path}:write`, { app_uid: CALENDAR, create: true })).html)
            .toBe(`perm_fs_create_dir_write(name=d15,path=${path.slice(0, path.lastIndexOf('/'))})`);
    });

    it('refuses a set that would create more entries than one grant may', async () => {
        const request = (count) => describe_permissions({
            app_uid: CALENDAR,
            create: true,
            permissions: Array.from({ length: count }, (_, i) => `fs:/alice/new-${i}:write`),
        });
        expect(await request(4)).toHaveLength(4);
        expect(await request(5)).toBeNull();
        // Entries that exist create nothing, so they don't count.
        expect(await describe_permissions({
            app_uid: CALENDAR,
            create: true,
            permissions: [
                ...Array.from({ length: 4 }, (_, i) => `fs:/alice/new-${i}:write`),
                'fs:/alice/notes.txt:read',
            ],
        })).toHaveLength(5);
    });

    it('refuses a uid the grant route would not read as one, without a lookup', async () => {
        for ( const uid of [
            'not-a-uuid',
            // Version 0 and a variant outside RFC 4122.
            'b3c1d2e4-5f6a-0b7c-8d9e-0f1a2b3c4d5e',
            'b3c1d2e4-5f6a-4b7c-0d9e-0f1a2b3c4d5e',
        ] ) {
            expect(await describe_(`fs:${uid}:read`)).toBeNull();
        }
        expect(puter.fs.stat).not.toHaveBeenCalled();
    });

    it('refuses a permission not spelled canonically, without a lookup', async () => {
        for ( const permission of [
            'f\\s:/alice/notes.txt:read',
            'fs:/alice/notes\\.txt:read',
            `app-root-di\\r:${CALENDAR}:read`,
            `manag\\e:kv-share:${OWNER}:${CALENDAR}:rooms`,
        ] ) {
            expect(await describe_(permission)).toBeNull();
        }
        expect(puter.fs.stat).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        // An escaped `:` is canonical.
        puter.fs.stat.mockResolvedValueOnce({ name: 'a:b.txt', dirpath: '/alice', is_dir: false });
        expect((await describe_('fs:/alice/a\\Cb.txt:read')).html)
            .toBe('perm_fs_file_read(name=a:b.txt,path=/alice)');
        expect(puter.fs.stat).toHaveBeenCalledWith({ path: '/alice/a:b.txt', consistency: 'eventual' });
    });

    it('describes the user’s own email, apps, and subdomains only', async () => {
        expect((await describe_(`user:${OWNER}:email:read`)).html).toBe('perm_email_read()');
        expect((await describe_(`apps-of-user:${OWNER}:write`)).html).toBe('perm_apps_write()');
        expect((await describe_(`subdomains-of-user:${OWNER}:read`)).html).toBe('perm_subdomains_read()');
        expect(await describe_('user:someone-else:email:read')).toBeNull();
        expect(await describe_('apps-of-user:someone-else:read')).toBeNull();
        expect(await describe_(`user:${OWNER}:email`)).toBeNull();
        expect(await describe_(`apps-of-user:${OWNER}:manage`)).toBeNull();
        expect(await describe_(`apps-of-user:${OWNER}`)).toBeNull();
        expect(await describe_(`constructor:${OWNER}:read`)).toBeNull();
    });

    it('names the app whose root directory is asked for', async () => {
        expect((await describe_(`app-root-dir:${CALENDAR}:write`)).html)
            .toBe('perm_app_root_dir_write(app=Calendar)');
        fetch.mockClear();
        expect(await describe_(`app-root-dir:${CALENDAR}:delete`)).toBeNull();
        expect(await describe_(`app-root-dir:${CALENDAR}:read:extra`)).toBeNull();
        expect(await describe_('app-root-dir:calendar:read')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
        // Only through a merged app's old uid, which the grant route won't follow.
        stubApp({ uid: 'app-merged-into', name: 'calendar', title: 'Calendar' });
        expect(await describe_(`app-root-dir:${CALENDAR}:read`)).toBeNull();
        stubApp(null);
        expect(await describe_(`app-root-dir:${CALENDAR}:read`)).toBeNull();
    });

    it('describes background events by their exact string', async () => {
        expect((await describe_('events:background')).html).toBe('perm_events_background()');
    });

    it('refuses app-data shapes the grant route refuses', async () => {
        stubApp({ uid: CONTACTS, name: 'contacts', title: 'Contacts' });
        expect(await describe_(`app-data:${CONTACTS}:fs:get`)).toBeNull();
        expect(await describe_(`app-data:${CONTACTS}:kv:get:extra`)).toBeNull();
        expect(await describe_(`app-data:${CONTACTS}:kv:constructor`)).toBeNull();
    });
});

describe('UIPermissionDialog input guard', () => {
    const MS = 350;
    let win;
    let doc;
    let guard;
    let changes;

    /** A page the user is looking at, or not, as plain event targets. */
    const page = ({ visible = true, focused = true } = {}) => {
        win = new EventTarget();
        doc = new EventTarget();
        doc.visibilityState = visible ? 'visible' : 'hidden';
        doc.hasFocus = () => focused;
        return { win, doc };
    };

    const start = (state) => {
        page(state);
        changes = [];
        guard = guard_input({
            win,
            doc,
            ms: MS,
            on_change: (ready) => changes.push(ready),
        });
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        guard?.stop();
        vi.useRealTimers();
    });

    it('becomes ready after the delay on a visible, focused page', () => {
        start();
        expect(guard.ready).toBe(false);
        vi.advanceTimersByTime(MS - 1);
        expect(guard.ready).toBe(false);
        vi.advanceTimersByTime(1);
        expect(guard.ready).toBe(true);
        expect(changes).toEqual([true]);
    });

    it('does not count down while the page is unfocused', () => {
        // Opened behind a popup: the delay must not run out unseen.
        start({ focused: false });
        vi.advanceTimersByTime(MS * 10);
        expect(guard.ready).toBe(false);

        doc.hasFocus = () => true;
        win.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(MS - 1);
        expect(guard.ready).toBe(false);
        vi.advanceTimersByTime(1);
        expect(guard.ready).toBe(true);
    });

    it('does not count down while the page is hidden', () => {
        start({ visible: false });
        vi.advanceTimersByTime(MS * 10);
        expect(guard.ready).toBe(false);

        doc.visibilityState = 'visible';
        doc.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(MS);
        expect(guard.ready).toBe(true);
    });

    it('re-disables on blur and waits again after focus returns', () => {
        start();
        vi.advanceTimersByTime(MS);
        expect(guard.ready).toBe(true);

        doc.hasFocus = () => false;
        win.dispatchEvent(new Event('blur'));
        expect(guard.ready).toBe(false);

        doc.hasFocus = () => true;
        win.dispatchEvent(new Event('focus'));
        expect(guard.ready).toBe(false);
        vi.advanceTimersByTime(MS);
        expect(guard.ready).toBe(true);
        expect(changes).toEqual([true, false, true]);
    });

    it('keeps the wait when focus only moves between the page and an iframe', () => {
        // The page keeps focus throughout, so the user's first click on the
        // dialog must not be swallowed by a restart.
        start();
        vi.advanceTimersByTime(MS - 100);
        win.dispatchEvent(new Event('blur'));
        win.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(100);
        expect(guard.ready).toBe(true);
        win.dispatchEvent(new Event('focus'));
        expect(guard.ready).toBe(true);
        expect(changes).toEqual([true]);
    });

    it('restarts the wait when something leaves fullscreen', () => {
        start();
        vi.advanceTimersByTime(MS);
        doc.dispatchEvent(new Event('fullscreenchange'));
        expect(guard.ready).toBe(false);
        vi.advanceTimersByTime(MS);
        expect(guard.ready).toBe(true);
    });

    it('stops listening once stopped', () => {
        start({ focused: false });
        guard.stop();
        doc.hasFocus = () => true;
        win.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(MS * 10);
        expect(guard.ready).toBe(false);
        expect(changes).toEqual([]);
    });
});
