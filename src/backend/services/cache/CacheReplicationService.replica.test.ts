import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventMap } from '../../clients/event/types';
import type { PuterServer } from '../../server';
import { setupTestServer } from '../../testUtil';

let server: PuterServer;
beforeAll(async () => {
    server = await setupTestServer();
});
afterAll(async () => {
    await server?.shutdown();
});
const user = () =>
    server.stores.user.create({
        username: `peer-${randomUUID().slice(0, 8)}`,
        uuid: randomUUID(),
        password: null,
    });
const replicate = async (mutate: () => Promise<unknown>) => {
    const emitted = vi.spyOn(server.clients.event, 'emit');
    let updates: EventMap['outer.cacheUpdate'][];
    try {
        await mutate();
        updates = emitted.mock.calls
            .filter(([key]) => key === 'outer.cacheUpdate')
            .map(
                ([, data]) =>
                    structuredClone(data) as EventMap['outer.cacheUpdate'],
            );
    } finally {
        emitted.mockRestore();
    }
    const keys = [...new Set(updates.flatMap((data) => data.cacheKey))];
    for (const key of keys) await server.clients.redis.del(key);
    for (const data of updates) {
        await server.clients.event.emitAndWait('outer.cacheUpdate', data, {
            from_outside: true,
        });
    }
};
describe('peer cache refills during replica lag', () => {
    it.each(['user', 'app'] as const)(
        'does not revive a revoked %s grant',
        async (kind) => {
            const issuer = await user();
            const holder = await user();
            const app = await server.stores.app.create(
                {
                    title: 'Peer',
                    name: `peer-${randomUUID()}`,
                    index_url: 'https://peer.test/',
                },
                { ownerUserId: issuer.id },
            );
            const store = server.stores.permission;
            const permission = `fs:${randomUUID()}:read`;
            const read = () =>
                kind === 'user'
                    ? store.readLinkedUserUserPerms(holder.id, [permission])
                    : store.readUserAppPerms(holder.id, app.id, [permission]);
            if (kind === 'user')
                await store.upsertUserUserPerm(
                    holder.id,
                    issuer.id,
                    permission,
                    {},
                );
            else
                await store.upsertUserAppPerm(
                    holder.id,
                    app.id,
                    permission,
                    {},
                );
            const table =
                kind === 'user'
                    ? 'user_to_user_permissions'
                    : 'user_to_app_permissions';
            const snapshot = await server.clients.db.pread(
                `SELECT * FROM ${table}`,
            );
            await replicate(() =>
                kind === 'user'
                    ? store.deleteUserUserPermByHolder(
                          holder.id,
                          permission,
                          issuer.id,
                      )
                    : store.deleteUserAppPerm(holder.id, app.id, permission),
            );
            const db = server.clients.db;
            const original = db.read.bind(db);
            const primary = vi.spyOn(db, 'pread').mockImplementation(original);
            const lag = vi
                .spyOn(db, 'read')
                .mockImplementation(async (sql, params) =>
                    sql.includes(table) ? snapshot : original(sql, params),
                );
            try {
                expect(await read()).toEqual([]);
                if (kind === 'user')
                    expect(
                        await store.readLinkedUserUserPermsForHolders(
                            [holder.id],
                            [permission],
                        ),
                    ).toEqual([]);
            } finally {
                lag.mockRestore();
                primary.mockRestore();
            }
            expect(await read()).toEqual([]);
        },
    );
    it('reads updated app rows from the primary after the peer broadcast', async () => {
        const owner = await user();
        const app = await server.stores.app.create(
            {
                title: 'Peer',
                name: `peer-${randomUUID()}`,
                index_url: 'https://old.test/',
            },
            { ownerUserId: owner.id },
        );
        const db = server.clients.db;
        const snapshot = await db.pread('SELECT * FROM apps WHERE id = ?', [
            app.id,
        ]);
        await replicate(() =>
            server.stores.app.update(app.id, {
                index_url: 'https://new.test/',
            }),
        );
        const original = db.read.bind(db);
        const primary = vi.spyOn(db, 'pread').mockImplementation(original);
        const lag = vi
            .spyOn(db, 'read')
            .mockImplementation(async (sql, params) =>
                sql.includes('FROM `apps`') ? snapshot : original(sql, params),
            );
        try {
            expect((await server.stores.app.getByUid(app.uid))?.index_url).toBe(
                'https://new.test/',
            );
            expect(
                (await server.stores.app.getByUids([app.uid])).get(app.uid)
                    ?.index_url,
            ).toBe('https://new.test/');
        } finally {
            lag.mockRestore();
            primary.mockRestore();
        }
    });
});
