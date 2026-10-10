import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { OIDCStore } from './OIDCStore.js';

type OidcRow = {
    user_id: number;
    provider: string;
    provider_sub: string;
};

const createPostgresUniqueError = (): Error & { code: string } => {
    return Object.assign(
        new Error(
            'duplicate key value violates unique constraint "idx_user_oidc_providers_provider_sub_unique"',
        ),
        { code: '23505' },
    );
};

const createStore = (rows: readonly OidcRow[]) => {
    const db = {
        write: vi.fn(
            async (
                _sql: string,
                _params: readonly unknown[],
            ): Promise<void> => {
                throw createPostgresUniqueError();
            },
        ),
        pread: vi.fn(
            async (
                _sql: string,
                _params: readonly unknown[],
            ): Promise<readonly OidcRow[]> => rows,
        ),
    };
    const store = new OIDCStore({}, { db });

    return { db, store };
};

describe('OIDCStore', () => {
    it('treats a Postgres unique violation as idempotent for an existing same-user link', async () => {
        const { db, store } = createStore([
            {
                user_id: 123,
                provider: 'test-provider',
                provider_sub: 'subject-1',
            },
        ]);

        await expect(
            store.link(123, 'test-provider', 'subject-1'),
        ).resolves.toBeUndefined();

        expect(db.pread).toHaveBeenCalledWith(
            expect.stringContaining('user_oidc_providers'),
            ['test-provider', 'subject-1'],
        );
    });

    it('rejects a Postgres unique violation for an existing different-user link', async () => {
        const { store } = createStore([
            {
                user_id: 456,
                provider: 'test-provider',
                provider_sub: 'subject-1',
            },
        ]);

        await expect(
            store.link(123, 'test-provider', 'subject-1'),
        ).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'conflict',
        });

        // Neither the other account's id nor the raw provider subject.
        const error = await store
            .link(123, 'test-provider', 'subject-1')
            .catch((e: Error) => e);
        expect(error.message).not.toContain('456');
        expect(error.message).not.toContain('subject-1');
    });
});

describe('OIDCStore.link behind a lagging replica', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `oidc-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
    };

    it('refuses an identity linked to another account the replica has not seen yet', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const sub = `sub-${uuidv4()}`;
        await server.stores.oidc.link(owner.id, 'test-provider', sub);

        // sqlite's pread delegates to read, so the primary is pinned to the
        // real one while replica reads of the link table come back empty.
        const db = server.clients.db;
        const realRead = db.read.bind(db);
        const pread = vi.spyOn(db, 'pread').mockImplementation(realRead);
        const read = vi
            .spyOn(db, 'read')
            .mockImplementation(async (q, p) =>
                /FROM `user_oidc_providers`/u.test(q) ? [] : realRead(q, p),
            );
        try {
            await expect(
                server.stores.oidc.link(other.id, 'test-provider', sub),
            ).rejects.toMatchObject({ statusCode: 409 });
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }
    });
});
