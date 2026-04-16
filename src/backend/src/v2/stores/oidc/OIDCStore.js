import { PuterStore } from '../types';

/**
 * CRUD over the `user_oidc_providers` table.
 *
 * Columns: id, user_id, provider, provider_sub, refresh_token, created_at.
 * UNIQUE(provider, provider_sub).
 */
export class OIDCStore extends PuterStore {

    // ── Reads ────────────────────────────────────────────────────────

    async getByProviderSub (provider, providerSub) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `user_oidc_providers` WHERE `provider` = ? AND `provider_sub` = ? LIMIT 1',
            [provider, providerSub],
        );
        return rows[0] ?? null;
    }

    async listByUserId (userId) {
        return this.clients.db.read(
            'SELECT * FROM `user_oidc_providers` WHERE `user_id` = ?',
            [userId],
        );
    }

    // ── Writes ───────────────────────────────────────────────────────

    async link (userId, provider, providerSub, refreshToken = null) {
        try {
            await this.clients.db.write(
                'INSERT INTO `user_oidc_providers` (`user_id`, `provider`, `provider_sub`, `refresh_token`) VALUES (?, ?, ?, ?)',
                [userId, provider, providerSub, refreshToken],
            );
        } catch ( e ) {
            // Already linked — swallow UNIQUE constraint violation
            if ( e.message?.includes('UNIQUE') || e.code === 'SQLITE_CONSTRAINT' || e.code === 'ER_DUP_ENTRY' ) {
                return;
            }
            throw e;
        }
    }

    async unlinkByUserId (userId, provider) {
        await this.clients.db.write(
            'DELETE FROM `user_oidc_providers` WHERE `user_id` = ? AND `provider` = ?',
            [userId, provider],
        );
    }
}
