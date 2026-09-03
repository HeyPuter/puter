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
 * Returns everything the team has done to its accounts, newest first.
 * Owner account only, and still readable after the team is deleted.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {TeamListOptions | import('../../lib/types.js').ListStreamOptions} [options]
 * @returns {Promise<TeamAuditEntry[]> | Promise<TeamAuditPage> | AsyncIterableIterator<TeamAuditPage>}
 */
export function listAudit (uid, options) {
    const segment = requireSegment(uid, 'uid');
    return /** @type {Promise<TeamAuditEntry[]>} */ (
        mapListResult(listRoute(this.puter, `/teams/${segment}/audit`, options, 'listAudit'), toAuditEntry)
    );
}
