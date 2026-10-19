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

import { describe, it, expect } from 'vitest';
import { createItemWatchers } from './watchItems.js';

const FILE = 'file-uid-1';
const SEE = `fs:${FILE}:see`;

// Grants are held per app; flip them between calls to model a revoke.
const makeWorld = () => {
    const grants = new Map();
    const checks = [];
    const posted = new Map();
    const windows = new Map();

    const appHoldsPermissions = async (permissions, appUid) => {
        checks.push({ permissions, appUid });
        if ( ! appUid ) return false;
        return permissions.every((p) => grants.get(appUid)?.has(p));
    };
    const findWatcher = (appInstanceID) => windows.get(appInstanceID) ?? null;

    const grant = (appUid, perm) => {
        if ( ! grants.has(appUid) ) grants.set(appUid, new Set());
        grants.get(appUid).add(perm);
    };
    const revoke = (appUid, perm) => grants.get(appUid)?.delete(perm);
    const open = (appInstanceID, appUid) => {
        posted.set(appInstanceID, []);
        windows.set(appInstanceID, {
            appUid,
            contentWindow: { postMessage: (msg) => posted.get(appInstanceID).push(msg) },
        });
    };
    const close = (appInstanceID) => windows.delete(appInstanceID);

    const watchers = createItemWatchers({ appHoldsPermissions, findWatcher });
    return { watchers, grant, revoke, open, close, posted, checks };
};

describe('item watchers', () => {
    it('refuses a watch for a file the app cannot see, and sends it nothing', async () => {
        const w = makeWorld();
        w.open('inst-1', 'app-1');

        await expect(w.watchers.add(FILE, 'inst-1', 'app-1')).resolves.toBe(false);
        expect(w.checks).toEqual([{ permissions: [SEE], appUid: 'app-1' }]);

        await w.watchers.notify(FILE, { uid: FILE, name: 'secret.txt' });
        expect(w.posted.get('inst-1')).toEqual([]);
    });

    it('delivers changes to an app that can see the file', async () => {
        const w = makeWorld();
        w.open('inst-1', 'app-1');
        w.grant('app-1', SEE);

        await expect(w.watchers.add(FILE, 'inst-1', 'app-1')).resolves.toBe(true);
        await w.watchers.notify(FILE, { uid: FILE, name: 'renamed.txt' });

        expect(w.posted.get('inst-1')).toEqual([
            { msg: 'itemChanged', data: { uid: FILE, name: 'renamed.txt' } },
        ]);
    });

    it('stops delivering once the grant is revoked, and drops the watcher', async () => {
        const w = makeWorld();
        w.open('inst-1', 'app-1');
        w.grant('app-1', SEE);
        await w.watchers.add(FILE, 'inst-1', 'app-1');

        w.revoke('app-1', SEE);
        await w.watchers.notify(FILE, { uid: FILE, size: 10 });
        expect(w.posted.get('inst-1')).toEqual([]);

        // Dropped, not just skipped: a later re-grant doesn't revive it.
        w.grant('app-1', SEE);
        await w.watchers.notify(FILE, { uid: FILE, size: 20 });
        expect(w.posted.get('inst-1')).toEqual([]);
    });

    it('asks about the app in the window, not one named at watch time', async () => {
        const w = makeWorld();
        w.grant('app-1', SEE);
        w.open('inst-1', 'app-2');
        await w.watchers.add(FILE, 'inst-1', 'app-1');

        await w.watchers.notify(FILE, { uid: FILE });
        expect(w.posted.get('inst-1')).toEqual([]);
        expect(w.checks.at(-1)).toEqual({ permissions: [SEE], appUid: 'app-2' });
    });

    it('sends one event per change however often the app asked to watch', async () => {
        const w = makeWorld();
        w.open('inst-1', 'app-1');
        w.grant('app-1', SEE);
        await w.watchers.add(FILE, 'inst-1', 'app-1');
        await w.watchers.add(FILE, 'inst-1', 'app-1');

        await w.watchers.notify(FILE, { uid: FILE });
        expect(w.posted.get('inst-1')).toHaveLength(1);
    });

    it('refuses a watch with no app to ask about, or no uid', async () => {
        const w = makeWorld();
        w.open('inst-1', undefined);

        await expect(w.watchers.add(FILE, 'inst-1', undefined)).resolves.toBe(false);
        for ( const uid of [undefined, '', 42, { toString: () => FILE }] ) {
            await expect(w.watchers.add(uid, 'inst-1', 'app-1')).resolves.toBe(false);
        }
    });

    it('drops a watcher whose window has closed', async () => {
        const w = makeWorld();
        w.open('inst-1', 'app-1');
        w.grant('app-1', SEE);
        await w.watchers.add(FILE, 'inst-1', 'app-1');

        w.close('inst-1');
        await w.watchers.notify(FILE, { uid: FILE });
        const checksBefore = w.checks.length;

        w.open('inst-1', 'app-1');
        await w.watchers.notify(FILE, { uid: FILE });
        expect(w.posted.get('inst-1')).toEqual([]);
        expect(w.checks.length).toBe(checksBefore);
    });

    it('delivers a file\'s changes in the order they happened', async () => {
        const posted = [];
        // The check for the first event answers last; the events must not swap.
        let call = 0;
        const watchers = createItemWatchers({
            appHoldsPermissions: async () => {
                const delay = call++ === 1 ? 20 : 0;
                await new Promise((r) => setTimeout(r, delay));
                return true;
            },
            findWatcher: () => ({
                appUid: 'app-1',
                contentWindow: { postMessage: (m) => posted.push(m.data.name) },
            }),
        });
        await watchers.add(FILE, 'inst-1', 'app-1');

        await Promise.all([
            watchers.notify(FILE, { uid: FILE, name: 'a' }),
            watchers.notify(FILE, { uid: FILE, name: 'b' }),
        ]);
        expect(posted).toEqual(['a', 'b']);
    });
});
