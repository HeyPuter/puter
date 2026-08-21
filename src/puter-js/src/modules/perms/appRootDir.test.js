import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control the shared request helper so these run without a server or UI.
const mockReq = vi.fn();
vi.mock('./lib/req.js', () => ({ req: (...args) => mockReq(...args) }));

const {
    appUidOf,
    checkAppRootDir,
    pollAppRootDir,
    requestReadAppRootDir,
    requestWriteAppRootDir,
} = await import('./appRootDir.js');
const { PuterJSError } = await import('../../lib/PuterJSError.js');

const ROUTE = '/auth/request-app-root-dir';

const makeModule = (requestPermission) => ({
    puter: {
        APIOrigin: 'https://api.test',
        ui: { requestPermission: vi.fn(requestPermission) },
    },
});

describe('perms appRootDir', () => {
    beforeEach(() => mockReq.mockReset());

    it('asks at the alias\'s access level, and does not prompt when allowed', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' }); // succeeds first try
        const mod = makeModule();

        expect(await requestWriteAppRootDir.call(mod, 'app-123')).toEqual({
            path: '/root',
        });
        expect(mockReq).toHaveBeenCalledWith(mod.puter, ROUTE, {
            app_uid: 'app-123',
            access: 'write',
        });
        // Already had access, so no permission prompt.
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('reads by default, and accepts an app object with a uid', async () => {
        mockReq.mockResolvedValue({ path: '/root' });
        const mod = makeModule();

        await requestReadAppRootDir.call(mod, 'app-xyz');
        expect(mockReq).toHaveBeenLastCalledWith(mod.puter, ROUTE, {
            app_uid: 'app-xyz',
            access: 'read',
        });

        await requestReadAppRootDir.call(mod, { uid: 'app-obj' });
        expect(mockReq).toHaveBeenLastCalledWith(mod.puter, ROUTE, {
            app_uid: 'app-obj',
            access: 'read',
        });
    });

    it('prompts for the write permission string and retries after a grant', async () => {
        // First call is refused by the backend, second (post-grant) succeeds.
        mockReq
            .mockResolvedValueOnce({ error: true })
            .mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule(() => true);

        const result = await requestWriteAppRootDir.call(mod, 'app-123');

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'app-root-dir:app-123:write',
        });
        expect(result).toEqual({ path: '/root' });
        expect(mockReq).toHaveBeenCalledTimes(2);
    });

    it('returns undefined when the permission is denied, without re-asking', async () => {
        mockReq.mockResolvedValue({ error: true });
        const mod = makeModule(() => false);

        expect(await requestWriteAppRootDir.call(mod, 'app-123')).toBeUndefined();
        expect(mockReq).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-string, non-object app uid with a coded error', async () => {
        expect(() => appUidOf(42)).toThrow(PuterJSError);
        expect(() => appUidOf(42)).toThrow(/app_uid must be a string/);
        expect(() => appUidOf({})).toThrow(PuterJSError);
        expect(appUidOf({ uid: 'app-1' })).toBe('app-1');
        expect(appUidOf('app-1')).toBe('app-1');
    });

    // A grant can lag the permission cache, so one refusal after it isn't final.
    it('keeps re-asking after a grant until the server allows it', async () => {
        mockReq
            .mockResolvedValueOnce({ error: true })
            .mockResolvedValueOnce({ error: true })
            .mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule();

        expect(await pollAppRootDir(mod.puter, 'app-1', 'read')).toEqual({
            path: '/root',
        });
        expect(mockReq).toHaveBeenCalledTimes(3);
    });

    it('gives up polling and resolves undefined', async () => {
        vi.useFakeTimers();
        try {
            mockReq.mockResolvedValue({ error: true });
            const mod = makeModule();

            const pending = pollAppRootDir(mod.puter, 'app-1', 'read');
            await vi.runAllTimersAsync();
            expect(await pending).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    // The check must not provision the directory as a side effect of asking.
    it('checks access read-only, and reads a refusal as "not held"', async () => {
        mockReq.mockResolvedValueOnce({ allowed: true });
        const mod = makeModule();

        expect(await checkAppRootDir(mod.puter, 'app-1', 'read')).toBe(true);
        expect(mockReq).toHaveBeenCalledWith(mod.puter, ROUTE, {
            app_uid: 'app-1',
            access: 'read',
            check: true,
        });

        mockReq.mockResolvedValueOnce({ error: true, code: 'forbidden' });
        expect(await checkAppRootDir(mod.puter, 'app-1', 'write')).toBe(false);
    });

    // A check that couldn't be made is not a refusal: folding it into `false`
    // would prompt someone who had already granted it.
    it('surfaces a failed check rather than reporting "not held"', async () => {
        mockReq.mockResolvedValueOnce({
            error: true,
            message: 'nope',
            code: 'unauthorized',
        });
        await expect(
            checkAppRootDir(makeModule().puter, 'app-1', 'read'),
        ).rejects.toMatchObject({ message: 'nope', code: 'unauthorized' });
    });
});
