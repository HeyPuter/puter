import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control the shared request helper so these run without a server or UI.
const mockReq = vi.fn();
vi.mock('./lib/req.js', () => ({ req: (...args) => mockReq(...args) }));

const {
    requestAppRootDir,
    requestReadAppRootDir,
    requestWriteAppRootDir,
} = await import('./appRootDir.js');
const { PuterJSError } = await import('../../lib/PuterJSError.js');

const makeModule = (requestPermission) => ({
    puter: {
        APIOrigin: 'https://api.test',
        ui: { requestPermission: vi.fn(requestPermission) },
    },
    requestAppRootDir,
});

describe('perms appRootDir', () => {
    beforeEach(() => mockReq.mockReset());

    it('requests write access with access:"write" in the body', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' }); // succeeds first try
        const mod = makeModule();

        const result = await requestAppRootDir.call(mod, 'app-123', 'write');

        expect(result).toEqual({ path: '/root' });
        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-123', access: 'write' },
        );
        // Already had access, so no permission prompt.
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('defaults to read access', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule();

        await requestAppRootDir.call(mod, 'app-xyz');

        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-xyz', access: 'read' },
        );
    });

    it('prompts for the write permission string and retries after a grant', async () => {
        // First call is denied by the backend, second (post-grant) succeeds.
        mockReq
            .mockResolvedValueOnce({ error: true })
            .mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule(() => true);

        const result = await requestAppRootDir.call(mod, 'app-123', 'write');

        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permission: 'app-root-dir:app-123:write',
        });
        expect(result).toEqual({ path: '/root' });
        expect(mockReq).toHaveBeenCalledTimes(2);
    });

    it('accepts an app object with a uid', async () => {
        mockReq.mockResolvedValueOnce({ path: '/root' });
        const mod = makeModule();

        await requestAppRootDir.call(mod, { uid: 'app-obj' });

        expect(mockReq).toHaveBeenCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-obj', access: 'read' },
        );
    });

    it('returns undefined when the permission is denied', async () => {
        mockReq.mockResolvedValue({ error: true });
        const mod = makeModule(() => false);

        const result = await requestAppRootDir.call(mod, 'app-123', 'write');

        expect(result).toBeUndefined();
    });

    it('rejects a non-string, non-object app uid with a coded error', async () => {
        const mod = makeModule();
        await expect(requestAppRootDir.call(mod, 42)).rejects.toBeInstanceOf(PuterJSError);
        await expect(requestAppRootDir.call(mod, 42)).rejects.toMatchObject({
            code: 'invalid_argument',
        });
    });

    it('rejects an access level that is neither read nor write', async () => {
        const mod = makeModule();
        await expect(
            requestAppRootDir.call(mod, 'app-123', 'delete'),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('keeps the deprecated read/write aliases delegating', async () => {
        mockReq.mockResolvedValue({ path: '/root' });
        const mod = makeModule();

        await requestReadAppRootDir.call(mod, 'app-1');
        expect(mockReq).toHaveBeenLastCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-1', access: 'read' },
        );

        await requestWriteAppRootDir.call(mod, 'app-1');
        expect(mockReq).toHaveBeenLastCalledWith(
            mod.puter,
            '/auth/request-app-root-dir',
            { app_uid: 'app-1', access: 'write' },
        );
    });
});
