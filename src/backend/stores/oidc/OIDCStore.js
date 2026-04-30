import { PuterStore } from '../types';

/**
 * CRUD over the `user_oidc_providers` table.
 *
 * Columns: id, user_id, provider, provider_sub, refresh_token, created_at.
 * UNIQUE(provider, provider_sub).
 */
export class OIDCStore extends PuterStore {
    // ── Reads ────────────────────────────────────────────────────────

    async getByProviderSub(provider, providerSub) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `user_oidc_providers` WHERE `provider` = ? AND `provider_sub` = ? LIMIT 1',
            [provider, providerSub],
        );
        return rows[0] ?? null;
    }

    async listByUserId(userId) {
        return this.clients.db.read(
            'SELECT * FROM `user_oidc_providers` WHERE `user_id` = ?',
            [userId],
        );
    }

    // ── Writes ───────────────────────────────────────────────────────

    async link(userId, provider, providerSub, refreshToken = null) {
        try {
            await this.clients.db.write(
                'INSERT INTO `user_oidc_providers` (`user_id`, `provider`, `provider_sub`, `refresh_token`) VALUES (?, ?, ?, ?)',
                [userId, provider, providerSub, refreshToken],
            );
            return;
        } catch (e) {
            const isUnique =
                e.message?.includes('UNIQUE') ||
                e.code === 'SQLITE_CONSTRAINT' ||
                e.code === 'ER_DUP_ENTRY';
            if (!isUnique) throw e;
        }

        // UNIQUE(provider, provider_sub) collision — either we're re-linking
        // the same (user, provider, sub) triple (idempotent no-op), or the
        // sub already belongs to a DIFFERENT user. The latter must fail loudly
        // so callers don't assume success and act on an unrelated account.
        const existing = await this.getByProviderSub(provider, providerSub);
        if (!existing) return;
        if (existing.user_id !== userId) {
            throw new Error(
                `OIDC link conflict: (${provider}, ${providerSub}) already bound to user ${existing.user_id}`,
            );
        }
    }

    async unlinkByUserId(userId, provider) {
        await this.clients.db.write(
            'DELETE FROM `user_oidc_providers` WHERE `user_id` = ? AND `provider` = ?',
            [userId, provider],
        );
    }
}
