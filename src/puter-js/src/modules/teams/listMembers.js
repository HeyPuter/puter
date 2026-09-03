import { listRoute } from './lib/listRoute.js';
import { requireSegment } from './lib/req.js';
import { mapListResult, toMember } from './lib/shapes.js';

/** @typedef {import('./types.js').TeamMember} TeamMember */
/** @typedef {import('../../lib/types.js').ListPage<TeamMember>} TeamMemberPage */
/** @typedef {Omit<import('../../lib/types.js').ListPaginationOptions, 'offset'>} TeamListOptions */

/**
 * @overload
 * @param {string} uid
 * @param {import('../../lib/types.js').ListStreamOptions} options
 * @returns {AsyncIterableIterator<TeamMemberPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {TeamListOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<TeamMemberPage>}
 */
/**
 * @overload
 * @param {string} uid
 * @param {{ limit?: number }} [options]
 * @returns {Promise<TeamMember[]>}
 */
/**
 * Returns the accounts belonging to a team. Any member may call it; the
 * response carries no email, activation state or usage.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {TeamListOptions | import('../../lib/types.js').ListStreamOptions} [options]
 * @returns {Promise<TeamMember[]> | Promise<TeamMemberPage> | AsyncIterableIterator<TeamMemberPage>}
 */
export function listMembers (uid, options) {
    const segment = requireSegment(uid, 'uid');
    return /** @type {Promise<TeamMember[]>} */ (
        mapListResult(listRoute(this.puter, `/teams/${segment}/members`, options, 'listMembers'), toMember)
    );
}
