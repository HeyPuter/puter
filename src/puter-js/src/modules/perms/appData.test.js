import { describe, expect, it, vi } from 'vitest';

import { appDataPermissions, requestAppData } from './appData.js';
import { PuterJSError } from '../../lib/PuterJSError.js';

const CONTACTS = 'app-11111111-2222-3333-4444-555555555555';

const makeModule = ({ granted = true, appID = 'app-99999999-8888-7777-6666-555555555555', get } = {}) => ({
    puter: {
        appID,
        apps: { get: vi.fn(get ?? (async () => ({ uid: CONTACTS }))) },
        ui: { requestPermission: vi.fn(async () => granted) },
    },
});

describe('perms appDataPermissions', () => {
    it('names one permission per requested op', () => {
        expect(appDataPermissions(CONTACTS, { kv: ['get'] })).toEqual([
            `app-data:${CONTACTS}:kv:get`,
        ]);
    });

    it('accepts a class name directly', () => {
        expect(appDataPermissions(CONTACTS, { kv: 'read', fs: 'write' })).toEqual([
            `app-data:${CONTACTS}:fs:write`,
            `app-data:${CONTACTS}:kv:read`,
        ]);
    });

    it('collapses a complete class into the class name', () => {
        // get + list is exactly the read class, so this loses nothing.
        expect(appDataPermissions(CONTACTS, { kv: ['get', 'list'] })).toEqual([
            `app-data:${CONTACTS}:kv:read`,
        ]);
    });

    it('does not collapse a partial class', () => {
        // Collapsing ['set'] to `write` would also grant add/incr/decr/update —
        // more than the app asked for, so it stays spelled out.
        expect(appDataPermissions(CONTACTS, { kv: ['set'] })).toEqual([
            `app-data:${CONTACTS}:kv:set`,
        ]);
    });

    it('collapses every class of a store into the store name', () => {
        expect(
            appDataPermissions(CONTACTS, { kv: ['read', 'write', 'delete'] }),
        ).toEqual([`app-data:${CONTACTS}:kv`]);
    });

    it('collapses both stores into the app-level name', () => {
        expect(
            appDataPermissions(CONTACTS, {
                kv: ['read', 'write', 'delete'],
                fs: ['read', 'write', 'delete'],
            }),
        ).toEqual([`app-data:${CONTACTS}`]);
    });

    it('keeps a mixed request per store', () => {
        expect(
            appDataPermissions(CONTACTS, { kv: ['get', 'set'], fs: 'read' }),
        ).toEqual([
            `app-data:${CONTACTS}:fs:read`,
            `app-data:${CONTACTS}:kv:get`,
            `app-data:${CONTACTS}:kv:set`,
        ]);
    });

    it('dedupes and sorts so the same request is always identical', () => {
        const a = appDataPermissions(CONTACTS, { kv: ['set', 'get', 'set'] });
        const b = appDataPermissions(CONTACTS, { kv: ['get', 'set'] });
        expect(a).toEqual(b);
    });

    it('refuses flush, which no scope may reach', () => {
        expect(() => appDataPermissions(CONTACTS, { kv: ['flush'] })).toThrow(
            PuterJSError,
        );
    });

    it('refuses an unknown scope rather than sending it', () => {
        expect(() => appDataPermissions(CONTACTS, { kv: ['nope'] })).toThrow(
            /unknown kv scope/,
        );
        expect(() => appDataPermissions(CONTACTS, { fs: ['append'] })).toThrow(
            /unknown fs scope/,
        );
    });

    it('requires at least one scope', () => {
        expect(() => appDataPermissions(CONTACTS, {})).toThrow(/at least one/);
    });
});

describe('perms requestAppData', () => {
    it('resolves a name to a uid and prompts with the permission list', async () => {
        const mod = makeModule();

        const result = await requestAppData.call(mod, 'contacts', {
            kv: ['get'],
        });

        expect(result).toBe(true);
        expect(mod.puter.apps.get).toHaveBeenCalledWith('contacts');
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: [`app-data:${CONTACTS}:kv:get`],
        });
    });

    it('passes an app- prefixed identifier through without a lookup', async () => {
        const mod = makeModule();
        await requestAppData.call(mod, CONTACTS, 'read');
        expect(mod.puter.apps.get).not.toHaveBeenCalled();
    });

    it('accepts an object identifier', async () => {
        const mod = makeModule();
        await requestAppData.call(mod, { uid: CONTACTS }, 'read');
        expect(mod.puter.ui.requestPermission).toHaveBeenCalled();
    });

    it('expands a shorthand string to both stores', async () => {
        const mod = makeModule();
        await requestAppData.call(mod, CONTACTS, 'read');
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: [
                `app-data:${CONTACTS}:fs:read`,
                `app-data:${CONTACTS}:kv:read`,
            ],
        });
    });

    it('accepts explicit store:name pairs', async () => {
        const mod = makeModule();
        await requestAppData.call(mod, CONTACTS, ['kv:get', 'fs:write']);
        expect(mod.puter.ui.requestPermission).toHaveBeenCalledWith({
            permissions: [
                `app-data:${CONTACTS}:fs:write`,
                `app-data:${CONTACTS}:kv:get`,
            ],
        });
    });

    it('short-circuits a request for its own data without prompting', async () => {
        // An app already reaches its own namespace, so a prompt here would ask
        // the user to approve something already true.
        const mod = makeModule({ appID: CONTACTS });
        expect(await requestAppData.call(mod, CONTACTS, 'read')).toBe(true);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });

    it('returns false when the user denies', async () => {
        const mod = makeModule({ granted: false });
        expect(await requestAppData.call(mod, CONTACTS, 'read')).toBe(false);
    });

    it('throws when the named app does not exist', async () => {
        const mod = makeModule({ get: async () => null });
        await expect(
            requestAppData.call(mod, 'no-such-app', 'read'),
        ).rejects.toThrow(/app not found/);
    });

    it('treats an app *named* like a uid prefix as a name, not a uid', async () => {
        // `puter.apps.get` looks up by name only, so a bare `app-` prefix test
        // would send `app-store` to a uid lookup that can never match.
        const mod = makeModule();
        await requestAppData.call(mod, 'app-store', 'read');
        expect(mod.puter.apps.get).toHaveBeenCalledWith('app-store');
    });

    it('rejects a prototype key as an unknown store', async () => {
        const mod = makeModule();
        // `out['toString']` is truthy, so a truthiness guard would fall through
        // and throw a TypeError instead of a clean error.
        await expect(
            requestAppData.call(mod, CONTACTS, ['toString:read']),
        ).rejects.toThrow(/unknown store/);
        await expect(
            requestAppData.call(mod, CONTACTS, ['constructor:read']),
        ).rejects.toThrow(/unknown store/);
    });

    it('rejects a bad identifier and a bad scope before any IPC', async () => {
        const mod = makeModule();
        await expect(requestAppData.call(mod, '', 'read')).rejects.toThrow(
            PuterJSError,
        );
        await expect(
            requestAppData.call(mod, CONTACTS, { kv: ['flush'] }),
        ).rejects.toThrow(PuterJSError);
        expect(mod.puter.ui.requestPermission).not.toHaveBeenCalled();
    });
});
