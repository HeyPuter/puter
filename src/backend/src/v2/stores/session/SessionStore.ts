import { PuterStore } from '../types';
import type { SessionRow } from '../../services/auth/types';

/**
 * Minimal session persistence for v2 auth.
 *
 * The v1 `SessionService` (services/SessionService.js) maintains a redis-backed
 * activity cache, a flush loop that writes `last_activity` batched to DB, and
 * user→sessions index sets. None of that is needed by the auth probe — it
 * only wants "does this session uuid exist, and who owns it?".
 *
 * We ship the minimal lookup here and let the full session lifecycle land
 * later (creation on login, deletion on logout, activity tracking) when we
 * port the auth controller.
 */
export class SessionStore extends PuterStore {

    /** Look up a session by its uuid. Returns `null` if not found. */
    async getByUuid (uuid: string): Promise<SessionRow | null> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        return (rows[0] as SessionRow | undefined) ?? null;
    }
}
