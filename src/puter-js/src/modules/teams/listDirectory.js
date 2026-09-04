import { listRoute } from './lib/listRoute.js';
import { requireSegment } from './lib/req.js';
import { mapListResult, toDirectoryEntry } from './lib/shapes.js';

/** @typedef {import('./types.js').TeamDirectoryEntry} TeamDirectoryEntry */
/** @typedef {import('../../lib/types.js').ListPage<TeamDirectoryEntry>} TeamDirectoryPage */
/** @typedef {Omit<import('../../lib/types.js').ListPaginationOptions, 'offset'>} TeamListOptions */

/**
 * @overload
 * @param {string} uid
 * @param {import('../../lib/types.js').ListStreamOptions} options
 * @returns {AsyncIterableIterator<TeamDirectoryPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {TeamListOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<TeamDirectoryPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {{ limit?: number }} [options]
 * @returns {Promise<TeamDirectoryEntry[]>}
 */
/**
 * The colleagues a member may be offered alongside — for suggesting invitees
 * and the like. Unlike every other `puter.teams` method this is callable by an
 * app acting for the member, not only by the member directly.
 *
 * It rejects with `team_not_found` unless the team has turned its
 * directory on, which it has not by default. Suspended accounts and ones that
 * never took up their credential are left out.
 *
 * The membership tested is always the *person's*, so an app installed by a
 * member of one team can never read another's.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {TeamListOptions | import('../../lib/types.js').ListStreamOptions} [options]
 * @returns {Promise<TeamDirectoryEntry[]> | Promise<TeamDirectoryPage> | AsyncIterableIterator<TeamDirectoryPage>}
 */
export function listDirectory (uid, options) {
    const segment = requireSegment(uid, 'uid');
    return /** @type {Promise<TeamDirectoryEntry[]>} */ (
        mapListResult(listRoute(this.puter, `/teams/${segment}/directory`, options, 'listDirectory'), toDirectoryEntry)
    );
}
