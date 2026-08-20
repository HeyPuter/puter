import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both routes these hit go through the shared helper, so mocking it needs no server.
const mockReq = vi.fn();
vi.mock('./lib/req.js', () => ({ req: (...args) => mockReq(...args) }));

const { check, request } = await import('./request.js');
const { requestApps, requestEmail, requestSubdomains } = await import(
    './permissions.js'
);
const { requestFolder } = await import('./folders.js');
const { requestAppRootDir } = await import('./appRootDir.js');
const { requestAppData } = await import('./appData.js');

const WHOAMI = { username: 'alice', uuid: 'u-1' };
const SELF_UID = 'app-00000000-0000-4000-8000-000000000001';

const denied = async () => { throw new Error('no access'); };

// The real resource methods, with the environment they reach through stubbed.
const makeModule = ({
    whoami = WHOAMI,
    requestPermission = () => false,
    stat = denied,
    appsGet = async () => ({ uid: 'app-target' }),
} = {}) => ({
    puter: {
        APIOrigin: 'https://api.test',
        appID: SELF_UID,
        auth: { whoami: vi.fn(async () => ({ ...whoami })) },
        ui: { requestPermission: vi.fn(requestPermission) },
        fs: { stat: vi.fn(stat) },
        apps: { get: vi.fn(appsGet) },
    },
    request,
    check,
    requestEmail,
    requestFolder,
    requestApps,
    requestSubdomains,
    requestAppRootDir,
    requestAppData,
});

/** The permission map `/auth/check-permissions` answers with. */
const heldReply = (held) => ({ permissions: held });

describe('perms request(resource, details)', () => {
    beforeEach(() => mockReq.mockReset());

    // -- Folders --

    it('asks for the folder permission and resolves to its path', async () => {
        const mod = makeModule({ requestPermission: () => true });

        const path = await request.call(mod, 'folder', {
            name: 'Documents',
            access: 'write',
        });

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'fs:/alice/Documents:write',
        });
        expect(path).toBe('/alice/Documents');
    });

    it('defaults folder access to read, and skips the prompt when readable', async () => {
        const mod = makeModule({ stat: async () => ({ id: 1 }) });

        const path = await request.call(mod, 'folder', { name: 'Documents' });

        expect(path).toBe('/alice/Documents');
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('resolves undefined when a folder request is denied', async () => {
        const mod = makeModule({ requestPermission: () => false });
        expect(
            await request.call(mod, 'folder', { name: 'Videos', access: 'write' }),
        ).toBeUndefined();
    });

    // -- Apps, subdomains, email --

    it('asks for apps and subdomains at the requested access level', async () => {
        const mod = makeModule({ requestPermission: () => true });

        expect(await request.call(mod, 'apps')).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenLastCalledWith({
            permission: 'apps-of-user:u-1:read',
        });

        await request.call(mod, 'apps', { access: 'write' });
        expect(mod.puter.ui.requestPermission).toHaveBeenLastCalledWith({
            permission: 'apps-of-user:u-1:write',
        });

        await request.call(mod, 'subdomains', { access: 'write' });
        expect(mod.puter.ui.requestPermission).toHaveBeenLastCalledWith({
            permission: 'subdomains-of-user:u-1:write',
        });
    });

    it('returns the email already on file without prompting', async () => {
        const mod = makeModule({
            whoami: { ...WHOAMI, email: 'alice@example.com' },
        });

        expect(await request.call(mod, 'email')).toBe('alice@example.com');
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('prompts for the email permission when it is not held', async () => {
        const mod = makeModule({ requestPermission: () => false });

        expect(await request.call(mod, 'email')).toBeUndefined();
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'user:u-1:email:read',
        });
    });

    // -- Another app's data --

    it('asks for the target app-data permissions', async () => {
        const mod = makeModule({ requestPermission: () => true });

        expect(
            await request.call(mod, 'appData', {
                app: 'contacts',
                scopes: 'read',
            }),
        ).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: ['app-data:app-target:fs:read', 'app-data:app-target:kv:read'],
        });
    });

    // -- An app's root directory --

    it('asks the server for the app root dir at the requested access', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule();

        const result = await request.call(mod, 'appRootDir', {
            app: 'app-1',
            access: 'write',
        });

        expect(result).toEqual({ path: '/root' });
        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-1', access: 'write' },
        );
    });

    // -- Raw permission strings --

    it('asks for one raw permission under the scalar prompt shape', async () => {
        const mod = makeModule({ requestPermission: () => true });

        expect(
            await request.call(mod, 'permission', {
                permission: 'fs:/alice/x:read',
            }),
        ).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'fs:/alice/x:read',
        });
    });

    it('puts several raw permissions under one prompt, deduped', async () => {
        const mod = makeModule({ requestPermission: () => true });

        await request.call(mod, 'permission', {
            permissions: ['a:read', 'b:read', 'a:read'],
        });

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: ['a:read', 'b:read'],
        });
    });

    // A lone string names no resource, so it is a permission string.
    it('still accepts a bare permission string', async () => {
        const mod = makeModule({ requestPermission: () => true });

        expect(await request.call(mod, 'fs:/alice:write')).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'fs:/alice:write',
        });
    });

    // -- Rejected input --

    it('rejects details passed with an unknown resource', async () => {
        const mod = makeModule();
        await expect(
            request.call(mod, 'flders', { name: 'Documents' }),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('rejects a missing folder name, an unknown access level, and non-object details', async () => {
        const mod = makeModule();
        await expect(request.call(mod, 'folder', {})).rejects.toMatchObject({
            code: 'invalid_argument',
        });
        await expect(
            request.call(mod, 'apps', { access: 'delete' }),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        await expect(
            request.call(mod, 'apps', 'read'),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('rejects `permission` and `permissions` together', async () => {
        const mod = makeModule();
        await expect(
            request.call(mod, 'permission', {
                permission: 'a:read',
                permissions: ['b:read'],
            }),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
    });
});

describe('perms request([...]) batching', () => {
    beforeEach(() => mockReq.mockReset());

    // The point of a batch: one dialog for the set, not one per entry.
    it('pools every missing permission into a single prompt', async () => {
        mockReq.mockResolvedValue(heldReply({}));
        const mod = makeModule({ requestPermission: () => true });

        const results = await request.call(mod, [
            { resource: 'folder', name: 'Documents', access: 'write' },
            { resource: 'apps' },
            { resource: 'permission', permission: 'x:read' },
        ]);

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledTimes(1);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: [
                'fs:/alice/Documents:write',
                'apps-of-user:u-1:read',
                'x:read',
            ],
        });
        // Each entry resolves to what its single-resource form returns.
        expect(results).toEqual(['/alice/Documents', true, true]);
    });

    it('never prompts when the whole batch is already held', async () => {
        mockReq.mockResolvedValue(
            heldReply({
                'fs:/alice/Desktop:read': true,
                'subdomains-of-user:u-1:write': true,
            }),
        );
        const mod = makeModule();

        const results = await request.call(mod, [
            { resource: 'folder', name: 'Desktop' },
            { resource: 'subdomains', access: 'write' },
        ]);

        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
        expect(results).toEqual(['/alice/Desktop', true]);
    });

    // Only the missing half is asked about.
    it('asks only for what is missing, and keeps held entries on a denial', async () => {
        mockReq.mockResolvedValue(heldReply({ 'apps-of-user:u-1:read': true }));
        const mod = makeModule({ requestPermission: () => false });

        const results = await request.call(mod, [
            { resource: 'apps' },
            { resource: 'folder', name: 'Videos', access: 'write' },
        ]);

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'fs:/alice/Videos:write',
        });
        expect(results).toEqual([true, undefined]);
    });

    it('validates every entry before prompting for any of them', async () => {
        mockReq.mockResolvedValue(heldReply({}));
        const mod = makeModule({ requestPermission: () => true });

        await expect(
            request.call(mod, [
                { resource: 'apps' },
                { resource: 'folder', name: 'Trash' },
            ]),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('rejects an entry with no resource, an unknown one, or a stray second argument', async () => {
        const mod = makeModule();
        await expect(request.call(mod, [{ name: 'Desktop' }])).rejects.toMatchObject({
            code: 'invalid_argument',
        });
        await expect(
            request.call(mod, [{ resource: 'folders', name: 'Desktop' }]),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        await expect(
            request.call(mod, [{ resource: 'apps' }], { access: 'read' }),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
    });

    it('answers a batch check per entry, in order', async () => {
        mockReq.mockResolvedValue(
            heldReply({
                'fs:/alice/Desktop:read': true,
                'apps-of-user:u-1:write': false,
            }),
        );
        const mod = makeModule();

        expect(
            await check.call(mod, [
                { resource: 'folder', name: 'Desktop' },
                { resource: 'apps', access: 'write' },
            ]),
        ).toEqual([true, false]);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('resolves an empty batch to an empty list without asking anything', async () => {
        const mod = makeModule();
        expect(await request.call(mod, [])).toEqual([]);
        expect(await check.call(mod, [])).toEqual([]);
        expect(mockReq).not.toHaveBeenCalled();
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });
});

describe('perms check(resource, details)', () => {
    beforeEach(() => mockReq.mockReset());

    it('answers from the permission check without prompting', async () => {
        mockReq.mockResolvedValueOnce(
            heldReply({ 'fs:/alice/Documents:write': true }),
        );
        const mod = makeModule();

        expect(
            await check.call(mod, 'folder', {
                name: 'Documents',
                access: 'write',
            }),
        ).toBe(true);
        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/check-permissions',
            { permissions: ['fs:/alice/Documents:write'] },
        );
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('checks the same permission strings the request asks for', async () => {
        mockReq.mockResolvedValue(heldReply({}));
        const mod = makeModule();

        await check.call(mod, 'apps', { access: 'write' });
        expect(mockReq).toHaveBeenLastCalledWith(
            mod.puter,
            '/auth/check-permissions',
            { permissions: ['apps-of-user:u-1:write'] },
        );

        await check.call(mod, 'subdomains');
        expect(mockReq).toHaveBeenLastCalledWith(
            mod.puter,
            '/auth/check-permissions',
            { permissions: ['subdomains-of-user:u-1:read'] },
        );

        await check.call(mod, 'fs:/alice:read');
        expect(mockReq).toHaveBeenLastCalledWith(
            mod.puter,
            '/auth/check-permissions',
            { permissions: ['fs:/alice:read'] },
        );
    });

    it('reports false when the permission is not held', async () => {
        mockReq.mockResolvedValueOnce(
            heldReply({ 'apps-of-user:u-1:read': false }),
        );
        expect(await check.call(makeModule(), 'apps')).toBe(false);
    });

    // A half-granted set still needs the prompt, so it cannot read as held.
    it('reports false when only some of a set is held', async () => {
        mockReq.mockResolvedValueOnce(
            heldReply({
                'app-data:app-target:kv:read': true,
                'app-data:app-target:fs:read': false,
            }),
        );
        expect(
            await check.call(makeModule(), 'appData', {
                app: 'contacts',
                scopes: 'read',
            }),
        ).toBe(false);
    });

    it('treats an app asking about its own data as already allowed', async () => {
        expect(
            await check.call(makeModule(), 'appData', {
                app: SELF_UID,
                scopes: 'read',
            }),
        ).toBe(true);
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('reads email access off whoami when the address is present', async () => {
        const mod = makeModule({
            whoami: { ...WHOAMI, email: 'alice@example.com' },
        });
        expect(await check.call(mod, 'email')).toBe(true);
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('falls back to the permission check when no email is on whoami', async () => {
        mockReq.mockResolvedValueOnce(heldReply({ 'user:u-1:email:read': false }));
        expect(await check.call(makeModule(), 'email')).toBe(false);
    });

    // A permission check on `app-root-dir:…` always answers false; ask the server.
    it('probes the server for app root dir access', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule();

        expect(
            await check.call(mod, 'appRootDir', { app: { uid: 'app-1' } }),
        ).toBe(true);
        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-1', access: 'read' },
        );
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();

        mockReq.mockResolvedValueOnce({ error: true });
        expect(
            await check.call(mod, 'appRootDir', { app: 'app-1' }),
        ).toBe(false);
    });

    // A failed check is not a denial — reporting one would prompt needlessly.
    it('surfaces a failed check rather than reporting false', async () => {
        mockReq.mockResolvedValueOnce({
            error: true,
            message: 'nope',
            code: 'unauthorized',
        });
        await expect(check.call(makeModule(), 'apps')).rejects.toMatchObject({
            message: 'nope',
            code: 'unauthorized',
        });
    });
});
