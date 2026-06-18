import { describe, expect, it, vi } from 'vitest';
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
            async (_sql: string, _params: readonly unknown[]): Promise<void> => {
                throw createPostgresUniqueError();
            },
        ),
        read: vi.fn(
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

        expect(db.read).toHaveBeenCalledWith(
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
    });
});
