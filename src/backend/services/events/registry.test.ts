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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EventKey } from '../../clients/event/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import {
    PUBLIC_SUBJECTS,
    UNPUBLISHED_INTERNAL_EVENTS,
    lookupFsSubject,
    lookupKvSubject,
    lookupPublicSubject,
    pushProjection,
    type FsDeliveryContext,
    type FsPublicSubject,
    type KvDeliveryContext,
    type PublicSubject,
} from './registry.js';

const PROJECTED_KEYS = [
    'id',
    'op',
    'path',
    'self',
    'seq',
    'subject',
    'ts',
    'uid',
];

/** A KV event names a key where an FS event names a node. */
const PROJECTED_KV_KEYS = ['id', 'key', 'op', 'self', 'seq', 'subject', 'ts'];

const entry = {
    id: 42,
    uuid: 'uid-node',
    uid: 'uid-node',
    userId: 7,
    parentId: 41,
    parentUid: 'uid-parent',
    path: '/alice/Documents/report.png',
    name: 'report.png',
    isDir: false,
    bucket: 'puter-local',
    bucketRegion: 'us-east-1',
    publicToken: null,
    fileRequestToken: null,
    isShortcut: false,
    shortcutTo: null,
    associatedAppId: null,
    layout: null,
    sortBy: null,
    sortOrder: null,
    isPublic: null,
    thumbnail: null,
    immutable: false,
    metadata: null,
    modified: 1_700_000_000,
    created: 1_700_000_000,
    accessed: 1_700_000_000,
    size: 1024,
    symlinkPath: null,
    isSymlink: false,
    subdomains: [],
    workers: [],
    suggestedApps: [],
} satisfies FSEntry;

const delivery: FsDeliveryContext = {
    key: 'fs.write.file',
    entry,
    ancestors: [
        { uid: 'uid-parent', path: '/u/Documents' },
        { uid: 'uid-home', path: '/u' },
    ],
    id: 'ev-1',
    ts: 1_700_000_001,
    self: true,
    seq: 3,
};

// The `fs.*`/`kv.*` keys declared on the bus, read from the source of truth so
// a new one shows up here without anyone remembering to add it.
const busKeysNeedingADecision = (): string[] => {
    const source = readFileSync(
        fileURLToPath(new URL('../../clients/event/types.ts', import.meta.url)),
        'utf8',
    );
    const start = source.indexOf('export type EventMap = {');
    const end = source.indexOf('} & IExtensionEventMap;');
    expect(start, 'EventMap declaration moved').toBeGreaterThan(-1);
    expect(end, 'EventMap terminator moved').toBeGreaterThan(start);

    const keys = source
        .slice(start, end)
        .matchAll(/^\s*'((?:fs|kv)\.[^']+)'\s*:/gm);
    return [...keys].map((match) => match[1]);
};

const kvDelivery: KvDeliveryContext = {
    key: 'kv.mutated',
    userUuid: 'user-uuid',
    appUid: 'app-1234',
    kvKey: 'cart:items',
    op: 'set',
    id: 'ev-2',
    ts: 1_700_000_002,
    self: true,
    seq: 0,
};

const fsSubjects = (): FsPublicSubject[] =>
    PUBLIC_SUBJECTS.filter(
        (subject): subject is FsPublicSubject => subject.family === 'fs',
    );

describe('PUBLIC_SUBJECTS', () => {
    it('maps each internal key to exactly one subject', () => {
        const keys = PUBLIC_SUBJECTS.flatMap((subject) => subject.internal);
        expect(keys).toEqual([...new Set(keys)]);
    });

    it('projects only the published shape', () => {
        const subject = lookupFsSubject('fs.write.file');
        const projected = subject!.project(delivery);
        expect(Object.keys(projected).sort()).toEqual(PROJECTED_KEYS);
        expect(projected).toMatchObject({
            id: 'ev-1',
            subject: 'fs:uid-node:write',
            op: 'write',
            uid: 'uid-node',
            path: '/alice/Documents/report.png',
            self: true,
            ts: 1_700_000_001,
            seq: 3,
        });
    });

    it('leaks no entry internals into the projection', () => {
        for (const subject of fsSubjects()) {
            const projected = subject.project(delivery) as Record<
                string,
                unknown
            >;
            expect(Object.keys(projected).sort()).toEqual(PROJECTED_KEYS);
            for (const leak of ['userId', 'bucket', 'metadata', 'entry'])
                expect(projected[leak]).toBeUndefined();
        }
    });

    it('anchors an event on its node and every ancestor', () => {
        const subject = lookupFsSubject('fs.create.file');
        expect(subject!.tokens(delivery)).toEqual([
            'f#uid-node',
            'f#uid-parent',
            'f#uid-home',
        ]);
        expect(subject!.matchOn(delivery)).toBe(
            '/alice/Documents/report.png',
        );
    });

    it('requires list to subscribe — see alone is not enough', () => {
        for (const subject of fsSubjects()) expect(subject.mode).toBe('list');
    });

    it('produces no push payload while notify is null', () => {
        for (const subject of fsSubjects()) {
            expect(subject.notify).toBeNull();
            expect(
                pushProjection(subject, subject.project(delivery)),
            ).toBeNull();
        }
    });

    it('defaults every entry to broadcast', () => {
        for (const subject of PUBLIC_SUBJECTS)
            expect(subject.defaultDelivery).toBe('broadcast');
    });
});

describe('the kv subject', () => {
    const subject = () => lookupKvSubject('kv.mutated')!;

    it('projects a key where an fs event projects a node', () => {
        const projected = subject().project(kvDelivery);

        expect(Object.keys(projected).sort()).toEqual(PROJECTED_KV_KEYS);
        expect(projected).toEqual({
            id: 'ev-2',
            subject: 'kv:app-1234:cart:items',
            op: 'set',
            key: 'cart:items',
            self: true,
            ts: 1_700_000_002,
            seq: 0,
        });
    });

    it('names the namespace app, never the namespace itself', () => {
        const projected = subject().project(kvDelivery) as Record<
            string,
            unknown
        >;
        for (const leak of ['namespace', 'userUuid', 'uid', 'path'])
            expect(projected[leak]).toBeUndefined();
    });

    it('carries the op the mutation reported', () => {
        for (const op of ['set', 'del', 'expire'] as const)
            expect(subject().project({ ...kvDelivery, op }).op).toBe(op);
    });

    it('anchors on the exact key and on its prefixes', () => {
        expect(subject().tokens(kvDelivery)).toEqual([
            'k#user-uuid#app-1234#cart:items',
            'k#user-uuid#app-1234#',
            'k#user-uuid#app-1234#cart:',
        ]);
        expect(subject().matchOn(kvDelivery)).toBe('cart:items');
    });

    it('globs over the whole key, with no delimiter to stop a `*`', () => {
        expect(subject().matchSeparator).toBeNull();
        expect(subject().matchScope('cart:', 'cart:items:1')).toBe(
            'cart:items:1',
        );
    });

    it('is not pushable and broadcasts by default', () => {
        expect(subject().notify).toBeNull();
        expect(subject().defaultDelivery).toBe('broadcast');
    });
});

describe('lookupPublicSubject', () => {
    it('resolves a registered key', () => {
        expect(lookupPublicSubject('fs.move.node')?.subject).toBe('fs:*:move');
        expect(lookupPublicSubject('fs.rename')?.subject).toBe('fs:*:move');
    });

    it('fails closed on an unregistered key', () => {
        const unregistered: EventKey[] = [
            'fs.copy.node',
            'fs.storage.upload-progress',
            'kv.flushed',
            'user.email-changed',
        ];
        for (const key of unregistered)
            expect(lookupPublicSubject(key)).toBeUndefined();
    });

    it('keeps the families apart', () => {
        expect(lookupKvSubject('fs.write.file')).toBeUndefined();
        expect(lookupFsSubject('kv.mutated')).toBeUndefined();
        expect(lookupKvSubject('kv.mutated')?.subject).toBe('kv:*');
    });
});

describe('bus key coverage', () => {
    it('finds the bus keys to decide on', () => {
        const keys = busKeysNeedingADecision();
        expect(keys).toContain('fs.write.file');
        expect(keys.length).toBeGreaterThan(1);
    });

    it('decides every fs/kv bus key exactly once', () => {
        const published = PUBLIC_SUBJECTS.flatMap(
            (subject) => subject.internal as readonly string[],
        );
        const unpublished = UNPUBLISHED_INTERNAL_EVENTS.map(
            (item) => item.event as string,
        );
        const decided = [...published, ...unpublished];

        expect(busKeysNeedingADecision().filter((key) => !decided.includes(key)))
            .toEqual([]);
        expect(published.filter((key) => unpublished.includes(key))).toEqual([]);
        expect(decided).toEqual([...new Set(decided)]);
    });

    it('gives every unpublished event a reason', () => {
        for (const item of UNPUBLISHED_INTERNAL_EVENTS)
            expect(item.reason.length).toBeGreaterThan(20);
    });
});

describe('registry typing', () => {
    it('exposes entries under the shared shape', () => {
        const subjects: readonly PublicSubject[] = PUBLIC_SUBJECTS;
        expect(subjects.length).toBeGreaterThan(0);
    });
});
