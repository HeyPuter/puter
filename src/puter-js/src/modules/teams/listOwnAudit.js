import { listRoute } from './lib/listRoute.js';
import { requireSegment } from './lib/req.js';
import { mapListResult, toAuditEntry } from './lib/shapes.js';

/** @typedef {import('./types.js').TeamAuditEntry} TeamAuditEntry */
/** @typedef {import('../../lib/types.js').ListPage<TeamAuditEntry>} TeamAuditPage */
/** @typedef {Omit<import('../../lib/types.js').ListPaginationOptions, 'offset'>} TeamListOptions */

/**
 * @overload
 * @param {string} uid
 * @param {import('../../lib/types.js').ListStreamOptions} options
 * @returns {AsyncIterableIterator<TeamAuditPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {TeamListOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<TeamAuditPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {{ limit?: number }} [options]
 * @returns {Promise<TeamAuditEntry[]>}
 */
/**
 * Returns the caller's own entries in a team's audit log — what the
 * team did to their account. Any member may call it.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {TeamListOptions | import('../../lib/types.js').ListStreamOptions} [options]
 * @returns {Promise<TeamAuditEntry[]> | Promise<TeamAuditPage> | AsyncIterableIterator<TeamAuditPage>}
 */
export function listOwnAudit (uid, options) {
    const segment = requireSegment(uid, 'uid');
    return /** @type {Promise<TeamAuditEntry[]>} */ (
        mapListResult(listRoute(this.puter, `/teams/${segment}/audit/me`, options, 'listOwnAudit'), toAuditEntry)
    );
}
