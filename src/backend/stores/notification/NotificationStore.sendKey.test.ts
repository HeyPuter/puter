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

/**
 * `send_key` is cleared on every rewrite once the column exists, whichever node
 * rewrites and whatever its config: a row a delayed send wrote and another node
 * replaced must not be delivered again under that send's key.
 */

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { NotificationStore } from './NotificationStore.js';

let server: PuterServer;
let userId: number;

/** A store on the same database, as another node with its own config. */
const node = (config: Partial<IConfig>): NotificationStore =>
    new NotificationStore(
        config as IConfig,
        server.clients as never,
        server.stores as never,
    );

/** A row as a delayed send writes it, keyed `sendKey`. */
const writeSent = async (store: NotificationStore): Promise<string> => {
    const sendKey = uuidv4();
    await server.clients.db.batchWrite(
        store.sendEntries(
            {
                sendKey,
                userId,
                value: { title: 'later' },
                type: 'app-message',
                audience: 'account',
                appUid: null,
                at: Date.now(),
            },
            { table: 'user', where: '`id` = ?', values: [userId] },
        ),
    );
    return sendKey;
};

const sendKeyOf = async (uid: string): Promise<unknown> => {
    const [row] = await server.clients.db.pread(
        'SELECT `send_key` FROM `notification` WHERE `uid` = ?',
        [uid],
    );
    return row?.send_key;
};

beforeAll(async () => {
    server = await setupTestServer();
    const username = `sendkey-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    });
    userId = user.id;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('clearing send_key on a rewrite', () => {
    it('clears it from a row another node wrote, whatever either config says', async () => {
        const writer = node({ events: { enabled: true } } as Partial<IConfig>);
        const rewriter = node({});
        const sendKey = await writeSent(writer);
        expect(await sendKeyOf(sendKey)).toBe(sendKey);

        await expect(
            rewriter.updateValue(sendKey, userId, { title: 'replaced' }),
        ).resolves.toBe(true);
        expect(await sendKeyOf(sendKey)).toBeNull();
    });

    it('probes once and keeps a present column for the process', async () => {
        const store = node({});
        const pread = vi.spyOn(server.clients.db, 'pread');
        const first = await writeSent(store);
        const second = await writeSent(store);

        await store.updateValue(first, userId, { v: 1 });
        await store.updateValue(second, userId, { v: 2 });

        const probes = pread.mock.calls.filter(([sql]) =>
            String(sql).includes('WHERE 1 = 0'),
        );
        expect(probes).toHaveLength(1);
        expect(await sendKeyOf(first)).toBeNull();
        expect(await sendKeyOf(second)).toBeNull();
    });

    it('rewrites without naming the column while it is absent, and clears it after the next probe once it exists', async () => {
        const db = server.clients.db;
        const store = node({});
        const sendKey = await writeSent(store);
        const write = vi.spyOn(db, 'write');
        const realPread = db.pread.bind(db);
        let columnExists = false;
        vi.spyOn(db, 'pread').mockImplementation(async (sql, values) => {
            if (!columnExists && String(sql).includes('WHERE 1 = 0'))
                throw new Error('no such column: send_key');
            return realPread(sql, values);
        });
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const rewriteSql = () =>
            String(
                write.mock.calls.findLast(([sql]) =>
                    String(sql).startsWith('UPDATE `notification` SET `value`'),
                )?.[0],
            );

        await store.updateValue(sendKey, userId, { v: 1 });
        expect(rewriteSql()).not.toContain('send_key');
        expect(await sendKeyOf(sendKey)).toBe(sendKey);

        // Within the minute the absent answer stands.
        columnExists = true;
        now += 30_000;
        await store.updateValue(sendKey, userId, { v: 2 });
        expect(rewriteSql()).not.toContain('send_key');
        expect(await sendKeyOf(sendKey)).toBe(sendKey);

        now += 31_000;
        await store.updateValue(sendKey, userId, { v: 3 });
        expect(rewriteSql()).toContain('`send_key` = NULL');
        expect(await sendKeyOf(sendKey)).toBeNull();
    });

    it('shares one probe between rewrites that race it', async () => {
        const db = server.clients.db;
        const store = node({});
        const keys = await Promise.all([writeSent(store), writeSent(store)]);
        const pread = vi.spyOn(db, 'pread');

        await Promise.all(
            keys.map((uid) => store.updateValue(uid, userId, { v: 1 })),
        );

        const probes = pread.mock.calls.filter(([sql]) =>
            String(sql).includes('WHERE 1 = 0'),
        );
        expect(probes).toHaveLength(1);
        for (const uid of keys) expect(await sendKeyOf(uid)).toBeNull();
    });
});

describe('writing a delayed send twice', () => {
    const entriesFor = (sendKey: string, replaceUid: string | null = null) =>
        node({}).sendEntries(
            {
                sendKey,
                userId,
                value: { title: 'later' },
                type: 'app-message',
                audience: 'account',
                appUid: null,
                replaceUid,
                at: Date.now(),
            },
            { table: 'user', where: '`id` = ?', values: [userId] },
        );
    const rowsKeyed = async (uid: string): Promise<number> =>
        (
            await server.clients.db.pread(
                'SELECT 1 FROM `notification` WHERE `uid` = ?',
                [uid],
            )
        ).length;

    it('writes nothing again once the row was rewritten and lost its key', async () => {
        const sendKey = await writeSent(node({}));
        await node({}).updateValue(sendKey, userId, { title: 'replaced' });
        expect(await sendKeyOf(sendKey)).toBeNull();

        await server.clients.db.batchWrite(entriesFor(sendKey));
        expect(await rowsKeyed(sendKey)).toBe(1);
    });

    it('adds no row once the replaced row carries the key', async () => {
        const replaced = await writeSent(node({}));
        const sendKey = uuidv4();
        await server.clients.db.batchWrite(entriesFor(sendKey, replaced));
        expect(await sendKeyOf(replaced)).toBe(sendKey);
        expect(await rowsKeyed(sendKey)).toBe(0);

        await server.clients.db.batchWrite(entriesFor(sendKey, replaced));
        expect(await rowsKeyed(sendKey)).toBe(0);
    });
});
