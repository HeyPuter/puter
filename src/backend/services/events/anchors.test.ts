/**
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

import { describe, expect, it } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import {
    resolveFsAnchor,
    resolveNotifAnchor,
    type FsAnchorDeps,
} from './anchors.js';
import { compileMatch, relativeTo } from './matcher.js';
import { parseSubject } from './subjects.js';

const USERNAME = 'alice';

// A small tree: the home dir, Documents under it, and a file under that.
const TREE: Record<string, string> = {
    '/alice': 'uid-home',
    '/alice/Documents': 'uid-docs',
    '/alice/Documents/report.png': 'uid-report',
};

const asEntry = (path: string, uid: string): FSEntry =>
    ({ uid, uuid: uid, path, name: path.split('/').pop() }) as FSEntry;

const deps: FsAnchorDeps = {
    resolveNode: async (ref) => {
        if (ref.uid) {
            const found = Object.entries(TREE).find(
                ([, uid]) => uid === ref.uid,
            );
            return found ? asEntry(found[0], found[1]) : null;
        }
        const uid = ref.path ? TREE[ref.path] : undefined;
        return uid && ref.path ? asEntry(ref.path, uid) : null;
    },
    // Mirrors `FSService.getAncestorChain`: existing entries only, deepest
    // first, never including root itself.
    getAncestorChain: async (path) => {
        const chain: Array<{ uid: string; path: string }> = [];
        let cursor = path;
        while (cursor !== '/') {
            if (TREE[cursor]) chain.push({ uid: TREE[cursor], path: cursor });
            cursor = cursor.slice(0, cursor.lastIndexOf('/')) || '/';
        }
        return chain;
    },
};

const resolve = (subject: string) =>
    resolveFsAnchor(parseSubject(subject), deps, { username: USERNAME }, subject);

describe('resolveFsAnchor', () => {
    it('anchors an existing path on the node itself, unfiltered', async () => {
        await expect(resolve('fs:~/Documents:write')).resolves.toEqual({
            token: 'f#uid-docs',
            uid: 'uid-docs',
            path: '/alice/Documents',
            match: null,
            op: 'write',
        });
    });

    it('anchors a missing leaf on its parent, matching by name', async () => {
        await expect(
            resolve('fs:~/Documents/triggerFile:add'),
        ).resolves.toMatchObject({
            uid: 'uid-docs',
            path: '/alice/Documents',
            match: 'triggerFile',
        });
    });

    it('climbs a missing chain and keeps the whole remainder', async () => {
        await expect(
            resolve('fs:~/Documents/a/b/triggerFile:add'),
        ).resolves.toMatchObject({
            uid: 'uid-docs',
            match: 'a/b/triggerFile',
        });
    });

    it('terminates the climb at the home directory', async () => {
        await expect(resolve('fs:~/Nope/Deeper/file:add')).resolves.toEqual({
            token: 'f#uid-home',
            uid: 'uid-home',
            path: '/alice',
            match: 'Nope/Deeper/file',
            op: 'add',
        });
    });

    it('anchors a glob at its literal prefix', async () => {
        await expect(resolve('fs:~/Documents/**/*.png:add')).resolves.toEqual({
            token: 'f#uid-docs',
            uid: 'uid-docs',
            path: '/alice/Documents',
            match: '**/*.png',
            op: 'add',
        });
    });

    it('joins a missing chain onto a glob remainder', async () => {
        await expect(
            resolve('fs:~/Documents/archive/**/*.png:add'),
        ).resolves.toMatchObject({
            uid: 'uid-docs',
            match: 'archive/**/*.png',
        });
    });

    it('resolves a node-form subject by uid', async () => {
        await expect(resolve('fs:uid-report:write')).resolves.toEqual({
            token: 'f#uid-report',
            uid: 'uid-report',
            path: '/alice/Documents/report.png',
            match: null,
            op: 'write',
        });
    });

    it('never stores a home-relative path', async () => {
        for (const subject of [
            'fs:~',
            'fs:~/Documents',
            'fs:~/Documents/**/*.png',
            'fs:~/Nope/Deeper/file',
        ]) {
            const anchor = await resolve(subject);
            expect(anchor.path.startsWith(`/${USERNAME}`)).toBe(true);
            expect(anchor.match ?? '').not.toContain('~');
        }
    });

    it('rejects a home path with no username to expand against', async () => {
        await expect(
            resolveFsAnchor(
                parseSubject('fs:~/Documents'),
                deps,
                {},
                'fs:~/Documents',
            ),
        ).rejects.toMatchObject({ legacyCode: 'bad_request' });
    });

    it('rejects an unresolvable uid', async () => {
        await expect(resolve('fs:uid-gone')).rejects.toBeInstanceOf(HttpError);
        await expect(resolve('fs:uid-gone')).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
            // Same message shape as `assertSubscribeAuthorized`'s safe-404 —
            // a mismatch here would itself be an existence oracle.
            message: 'No such entry: fs:uid-gone',
        });
    });

    it('rejects a path with no existing ancestor at all', async () => {
        await expect(resolve('fs:/nobody/here')).rejects.toMatchObject({
            legacyCode: 'subject_does_not_exist',
        });
    });

    it('rejects a path that has to be normalized', async () => {
        await expect(resolve('fs:~/Documents/../Documents')).rejects.toThrow();
    });
});

describe('anchor and match together', () => {
    it('matches the awaited file once it appears under the anchor', async () => {
        const anchor = await resolve('fs:~/Documents/triggerFile:add');
        const compiled = compileMatch(anchor.match!);
        const created = '/alice/Documents/triggerFile';
        expect(compiled.test(relativeTo(anchor.path, created)!)).toBe(true);
        expect(
            compiled.test(
                relativeTo(anchor.path, '/alice/Documents/other')!,
            ),
        ).toBe(false);
    });

    it('matches a deep glob subject only under its anchor', async () => {
        const anchor = await resolve('fs:~/Documents/**/*.png:add');
        const compiled = compileMatch(anchor.match!);
        expect(
            compiled.test(
                relativeTo(anchor.path, '/alice/Documents/a/b/x.png')!,
            ),
        ).toBe(true);
        expect(relativeTo(anchor.path, '/alice/Desktop/x.png')).toBeNull();
    });
});

describe('resolveNotifAnchor', () => {
    const USER = 'user-uuid-alice';
    const APP = 'app-uuid-widget';

    it('widens a session\'s own developer/app-user slice to any app', () => {
        for (const audience of ['developer', 'app-user'] as const) {
            const anchor = resolveNotifAnchor(parseSubject(`notif:${audience}`), {
                userUuid: USER,
                appUid: null,
            });
            expect(anchor.appScoped).toBe(false);
            expect(anchor.anyApp).toBe(true);
            expect(anchor.match).toBe(`*:${audience}`);

            const compiled = compileMatch(anchor.match, { separator: ':' });
            // Some other app's row, and a row naming none at all — both are
            // this session's own mailbox to hear about.
            expect(compiled.test(`${APP}:${audience}`)).toBe(true);
            expect(compiled.test(`${USER}:${audience}`)).toBe(true);
        }
    });

    it('never widens account — it never names an app to widen across', () => {
        const anchor = resolveNotifAnchor(parseSubject('notif:account'), {
            userUuid: USER,
            appUid: null,
        });
        expect(anchor.anyApp).toBe(false);
        expect(anchor.match).toBe(`${USER}:account`);
    });

    it('keeps an app\'s own two-segment slice pinned to itself', () => {
        const anchor = resolveNotifAnchor(parseSubject('notif:developer'), {
            userUuid: USER,
            appUid: APP,
        });
        expect(anchor.appScoped).toBe(true);
        expect(anchor.anyApp).toBe(false);
        expect(anchor.match).toBe(`${APP}:developer`);

        const compiled = compileMatch(anchor.match, { separator: ':' });
        expect(compiled.test(`${APP}:developer`)).toBe(true);
        // Not this app: an app's generic subject never reaches another's rows.
        expect(compiled.test('some-other-app:developer')).toBe(false);
    });

    it('keeps an explicitly named app pinned to just that one', () => {
        const anchor = resolveNotifAnchor(
            parseSubject(`notif:${APP}:developer`),
            { userUuid: USER, appUid: null },
        );
        expect(anchor.appScoped).toBe(true);
        expect(anchor.anyApp).toBe(false);
        expect(anchor.match).toBe(`${APP}:developer`);
    });
});
