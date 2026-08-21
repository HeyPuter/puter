import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both routes these reach go through the shared helper, so mocking it needs no server.
const mockReq = vi.fn();
vi.mock('./lib/req.js', () => ({ req: (...args) => mockReq(...args) }));

const { check, request } = await import('./request.js');

const CHECK_ROUTE = '/auth/check-permissions';
const ROOT_DIR_ROUTE = '/auth/request-app-root-dir';

const WHOAMI = { username: 'alice', uuid: 'u-1' };
const SELF_UID = 'app-00000000-0000-4000-8000-000000000001';

const denied = async () => { throw new Error('no access'); };

/**
 * Answer the mocked helper by route, so a test says what is held and what the
 * app-root-dir route replies without depending on the order they are asked in.
 * An app-root-dir reply queue runs out into a refusal, which is that route's
 * answer for anything but the app itself.
 */
const routes = ({ held = {}, rootDir = [] } = {}) => {
    const pending = [...rootDir];
    mockReq.mockImplementation(async (_puter, route) => {
        if ( route === CHECK_ROUTE ) return { permissions: held };
        if ( route === ROOT_DIR_ROUTE ) {
            return pending.length
                ? pending.shift()
                : { error: true, code: 'forbidden' };
        }
        throw new Error(`unexpected route: ${route}`);
    });
};

/** The real `request`/`check`, with the environment they reach through stubbed. */
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
});

/** The calls the mocked helper made to one route. */
const callsTo = (route) =>
    mockReq.mock.calls.filter((call) => call[1] === route);

beforeEach(() => {
    mockReq.mockReset();
    routes();
});

describe('perms request(resource, details)', () => {
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
        // Statting answered it, so the permission read was never needed.
        expect(callsTo(CHECK_ROUTE)).toHaveLength(0);
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

    // A request is going to claim the directory either way, so the claim is
    // the check: one round trip, the same as the shipped method makes.
    it('claims the app root dir in one call at the requested access', async () => {
        routes({ rootDir: [{ path: '/root' }] });
        const mod = makeModule();

        const result = await request.call(mod, 'appRootDir', {
            app: 'app-1',
            access: 'write',
        });

        expect(result).toEqual({ path: '/root' });
        expect(callsTo(ROOT_DIR_ROUTE).map((call) => call[2])).toEqual([
            { app_uid: 'app-1', access: 'write' },
        ]);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
        // `app-root-dir:…` never resolves in a permission scan, so nothing pools it.
        expect(callsTo(CHECK_ROUTE)).toHaveLength(0);
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

    // A resource is looked up on an own property, so a permission string that
    // shares a name with an `Object.prototype` member is still that string.
    it('reads a permission string that collides with an Object member', async () => {
        const mod = makeModule({ requestPermission: () => true });

        for ( const name of ['constructor', 'toString', 'hasOwnProperty'] ) {
            expect(await request.call(mod, name)).toBe(true);
            expect(mod.puter.ui.requestPermission).toHaveBeenLastCalledWith({
                permission: name,
            });
        }
    });

    // -- Prompting only for what is missing --

    it('skips the prompt when the access is already held', async () => {
        routes({
            held: {
                'fs:/alice/Documents:write': true,
                'apps-of-user:u-1:write': true,
                'x:read': true,
            },
        });
        const mod = makeModule();

        expect(
            await request.call(mod, 'folder', {
                name: 'Documents',
                access: 'write',
            }),
        ).toBe('/alice/Documents');
        expect(await request.call(mod, 'apps', { access: 'write' })).toBe(true);
        expect(await request.call(mod, 'x:read')).toBe(true);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    // A read that failed says nothing about what is held, and a request has
    // somewhere to fall back to: the prompt it would have raised anyway.
    it('falls through to the prompt when the permission read fails', async () => {
        mockReq.mockResolvedValue({
            error: true,
            message: 'nope',
            code: 'internal_error',
        });
        const mod = makeModule({ requestPermission: () => true });

        expect(await request.call(mod, 'apps')).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'apps-of-user:u-1:read',
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
        await expect(
            request.call(mod, 'appRootDir', { app: 42 }),
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
    // The point of a batch: one dialog for the set, not one per entry.
    it('pools every missing permission into a single prompt', async () => {
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

    // One read for the whole set, and one `whoami` behind all of it.
    it('reads what is held once for the whole batch', async () => {
        const mod = makeModule({ requestPermission: () => true });

        await request.call(mod, [
            { resource: 'folder', name: 'Documents', access: 'write' },
            { resource: 'apps' },
            { resource: 'subdomains' },
            { resource: 'email' },
        ]);

        expect(callsTo(CHECK_ROUTE)).toHaveLength(1);
        expect(callsTo(CHECK_ROUTE)[0][2]).toEqual({
            permissions: [
                'fs:/alice/Documents:write',
                'apps-of-user:u-1:read',
                'subdomains-of-user:u-1:read',
                'user:u-1:email:read',
            ],
        });
        // Once before the prompt, once after — the grant is what puts the
        // email on `whoami`, so the copy read before it is stale.
        expect(mod.puter.auth.whoami).toHaveBeenCalledTimes(2);
    });

    it('never prompts when the whole batch is already held', async () => {
        routes({
            held: {
                'fs:/alice/Desktop:read': true,
                'subdomains-of-user:u-1:write': true,
            },
        });
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
        routes({ held: { 'apps-of-user:u-1:read': true } });
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

    // A grant can lag the permission cache, so the first refusal after one
    // isn't final — in a batch exactly as in a single request.
    it('keeps asking for the app root dir after the pooled grant', async () => {
        routes({
            rootDir: [
                { error: true, code: 'forbidden' }, // refused before the grant
                { error: true }, // first ask after it: cache still stale
                { path: '/root' },
            ],
        });
        const mod = makeModule({ requestPermission: () => true });

        expect(
            await request.call(mod, [{ resource: 'appRootDir', app: 'app-1' }]),
        ).toEqual([{ path: '/root' }]);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'app-root-dir:app-1:read',
        });
        expect(callsTo(ROOT_DIR_ROUTE)).toHaveLength(3);
    });

    it('validates every entry before prompting for any of them', async () => {
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

    // An inherited `Object` member is not a resource here either.
    it('rejects a batch entry naming an Object member as its resource', async () => {
        await expect(
            request.call(makeModule(), [{ resource: 'toString' }]),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
    });

    it('answers a batch check per entry, in order', async () => {
        routes({
            held: {
                'fs:/alice/Desktop:read': true,
                'apps-of-user:u-1:write': false,
            },
        });
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
    it('answers from the permission check without prompting', async () => {
        routes({ held: { 'fs:/alice/Documents:write': true } });
        const mod = makeModule();

        expect(
            await check.call(mod, 'folder', {
                name: 'Documents',
                access: 'write',
            }),
        ).toBe(true);
        expect(mockReq).toHaveBeenCalledWith(mod.puter, CHECK_ROUTE, {
            permissions: ['fs:/alice/Documents:write'],
        });
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('checks the same permission strings the request asks for', async () => {
        const mod = makeModule();

        await check.call(mod, 'apps', { access: 'write' });
        expect(mockReq).toHaveBeenLastCalledWith(mod.puter, CHECK_ROUTE, {
            permissions: ['apps-of-user:u-1:write'],
        });

        await check.call(mod, 'subdomains');
        expect(mockReq).toHaveBeenLastCalledWith(mod.puter, CHECK_ROUTE, {
            permissions: ['subdomains-of-user:u-1:read'],
        });

        await check.call(mod, 'fs:/alice:read');
        expect(mockReq).toHaveBeenLastCalledWith(mod.puter, CHECK_ROUTE, {
            permissions: ['fs:/alice:read'],
        });
    });

    // Read access can come from an ACL grant no `fs:` string names, so the same
    // stat that settles a request settles the check too.
    it('accepts a folder it can stat as readable', async () => {
        const mod = makeModule({ stat: async () => ({ id: 1 }) });

        expect(await check.call(mod, 'folder', { name: 'Desktop' })).toBe(true);
        expect(callsTo(CHECK_ROUTE)).toHaveLength(0);
    });

    it('reports false when the permission is not held', async () => {
        routes({ held: { 'apps-of-user:u-1:read': false } });
        expect(await check.call(makeModule(), 'apps')).toBe(false);
    });

    // A half-granted set still needs the prompt, so it cannot read as held.
    it('reports false when only some of a set is held', async () => {
        routes({
            held: {
                'app-data:app-target:kv:read': true,
                'app-data:app-target:fs:read': false,
            },
        });
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
        routes({ held: { 'user:u-1:email:read': false } });
        expect(await check.call(makeModule(), 'email')).toBe(false);
    });

    // The read-only mode of the route: asking must not provision the directory.
    it('probes the server for app root dir access without provisioning it', async () => {
        routes({ rootDir: [{ allowed: true }] });
        const mod = makeModule();

        expect(
            await check.call(mod, 'appRootDir', { app: { uid: 'app-1' } }),
        ).toBe(true);
        expect(mockReq).toHaveBeenCalledWith(mod.puter, ROOT_DIR_ROUTE, {
            app_uid: 'app-1',
            access: 'read',
            check: true,
        });
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();

        // The queue is empty now, so the route refuses: not held.
        expect(await check.call(mod, 'appRootDir', { app: 'app-1' })).toBe(false);
    });

    // A failed check is not a denial — reporting one would prompt needlessly.
    it('surfaces a failed check rather than reporting false', async () => {
        mockReq.mockResolvedValue({
            error: true,
            message: 'nope',
            code: 'unauthorized',
        });
        await expect(check.call(makeModule(), 'apps')).rejects.toMatchObject({
            message: 'nope',
            code: 'unauthorized',
        });
        await expect(
            check.call(makeModule(), 'appRootDir', { app: 'app-1' }),
        ).rejects.toMatchObject({ message: 'nope', code: 'unauthorized' });
    });
});

// A check that couldn't be made is not a refusal, and a request has the prompt
// to fall back on — the one it would have raised before there was a check.
describe('perms request(...) when the server cannot answer', () => {
    beforeEach(() => {
        mockReq.mockResolvedValue({
            error: true,
            message: 'nope',
            code: 'internal_error',
        });
    });

    it('falls through to the prompt, alone and in a batch', async () => {
        const mod = makeModule({ requestPermission: () => true });

        expect(await request.call(mod, 'apps')).toBe(true);
        expect(mod.puter.ui.requestPermission).toHaveBeenLastCalledWith({
            permission: 'apps-of-user:u-1:read',
        });
        expect(
            await request.call(mod, [
                { resource: 'apps' },
                { resource: 'subdomains' },
            ]),
        ).toEqual([true, true]);
    });

    it('falls through for an app root dir the server would not confirm', async () => {
        vi.useFakeTimers();
        try {
            const mod = makeModule({ requestPermission: () => true });

            const pending = request.call(mod, 'appRootDir', { app: 'app-1' });
            await vi.runAllTimersAsync();

            expect(await pending).toBeUndefined();
            expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
                permission: 'app-root-dir:app-1:read',
            });
        } finally {
            vi.useRealTimers();
        }
    });
});

// The behaviour change to the two methods that shipped and go through
// `request`: they now settle from what is held instead of always prompting.
describe('perms request(permission) on an already-held permission', () => {
    it('resolves true without prompting, alone and through requestPermission', async () => {
        routes({ held: { 'fs:/alice/x:read': true } });
        const mod = {
            ...makeModule(),
            requestPermission: (...args) => request.call(mod, ...args),
        };

        expect(await request.call(mod, 'fs:/alice/x:read')).toBe(true);
        expect(await mod.requestPermission('fs:/alice/x:read')).toBe(true);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('still prompts for one that is not held', async () => {
        const mod = {
            ...makeModule({ requestPermission: () => false }),
            requestPermission: (...args) => request.call(mod, ...args),
        };

        expect(await mod.requestPermission('fs:/alice/x:read')).toBe(false);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'fs:/alice/x:read',
        });
    });
});
