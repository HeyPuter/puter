/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `definitions.js` reads the class registry the bundle installs at boot.
globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));

// A full launch pulls in UIWindow and the desktop; the gate under test runs
// before any of it, so stand the launcher in for a spy.
const launchSpy = vi.fn(async () => ({ launchResult: { launched: true } }));
vi.mock('../helpers/launchApp.js', () => ({ default: (...a) => launchSpy(...a) }));
vi.mock('../helpers/expandHomePath.js', () => ({ expand_home_path: (p) => p }));

let ExecService;

beforeAll(async () => {
    ({ ExecService } = await import('./ExecService.js'));
});

// Registry of apps by name, read by the mocked `window.get_apps`.
let apps;

const makeService = async () => {
    const svc = new ExecService();
    svc.param_providers = svc.param_providers ?? [];
    const ipc = {
        register_ipc_handler: () => {},
        add_connection: () => ({ forward: { uuid: 'fwd' }, backward: { uuid: 'bwd' } }),
    };
    await svc.init({ services: { get: (name) => (name === 'ipc' ? ipc : {}) } });
    return svc;
};

const callerProcess = (name) => ({
    name,
    uuid: `proc-${name}`,
    references: { iframe: null },
});

beforeEach(() => {
    launchSpy.mockClear();
    apps = new Map();
    globalThis.window = globalThis.window ?? {};
    let n = 0;
    window.uuidv4 = () => `uuid-${++n}`;
    window.get_apps = async (name) => apps.get(name) ?? [];
    globalThis.puter = { logger: { fields: () => ({ warn () {} }) } };
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ExecService.launchApp godmode gate', () => {
    it('refuses an ordinary app launching a godmode target', async () => {
        const svc = await makeService();
        apps.set('node-beta', { name: 'node-beta', godmode: true });
        apps.set('evil', { name: 'evil', godmode: false });

        await expect(
            svc.launchApp(
                { app_name: 'node-beta', args: { code: 'steal()' } },
                { ipc_context: { caller: { app: {}, process: callerProcess('evil') } } },
            ),
        ).rejects.toThrow(/not allowed/);
        expect(launchSpy).not.toHaveBeenCalled();
    });

    // 0/1 is the older serialized shape; it must gate the same as a boolean.
    it('gates a godmode target expressed as 1 the same way', async () => {
        const svc = await makeService();
        apps.set('node-beta', { name: 'node-beta', godmode: 1 });
        apps.set('evil', { name: 'evil', godmode: 0 });

        await expect(
            svc.launchApp(
                { app_name: 'node-beta' },
                { ipc_context: { caller: { app: {}, process: callerProcess('evil') } } },
            ),
        ).rejects.toThrow(/not allowed/);
    });

    it('lets a godmode caller launch a godmode target', async () => {
        const svc = await makeService();
        apps.set('node-beta', { name: 'node-beta', godmode: true });
        apps.set('dev-center', { name: 'dev-center', godmode: true });

        await svc.launchApp(
            { app_name: 'node-beta' },
            { ipc_context: { caller: { app: {}, process: callerProcess('dev-center') } } },
        );
        expect(launchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not gate an ordinary target', async () => {
        const svc = await makeService();
        apps.set('editor', { name: 'editor', godmode: false });
        apps.set('evil', { name: 'evil', godmode: false });

        await svc.launchApp(
            { app_name: 'editor' },
            { ipc_context: { caller: { app: {}, process: callerProcess('evil') } } },
        );
        expect(launchSpy).toHaveBeenCalledTimes(1);
    });
});
