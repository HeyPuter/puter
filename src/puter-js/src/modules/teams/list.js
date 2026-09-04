import { listRoute } from './lib/listRoute.js';
import { mapListResult, toTeam } from './lib/shapes.js';

/** @typedef {import('./types.js').Team} Team */
/** @typedef {import('../../lib/types.js').ListPage<Team>} TeamPage */
/** @typedef {Omit<import('../../lib/types.js').ListPaginationOptions, 'offset'>} TeamListOptions */

/**
 * @overload
 * @param {import('../../lib/types.js').ListStreamOptions} options
 * @returns {AsyncIterableIterator<TeamPage>}
 */
/**
 * @overload
 * @param {TeamListOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<TeamPage>}
 */
/**
 * @overload
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Team[]>}
 */
/**
 * Returns the teams the caller belongs to, resolving to a plain array by
 * default. `cursor` or `includeTotal` switches to the `{ items, cursor? }`
 * envelope, and `stream: true` returns an async iterator of envelopes.
 *
 * A deployment with teams turned off has no `/teams` route at all, so this
 * rejects with `not_found` rather than returning an empty list — which is how a
 * caller tells "turned off" from "none yet".
 *
 * @this {import('./index.js').TeamsModule}
 * @param {TeamListOptions | import('../../lib/types.js').ListStreamOptions} [options]
 * @returns {Promise<Team[]> | Promise<TeamPage> | AsyncIterableIterator<TeamPage>}
 */
export function list (options) {
    return /** @type {Promise<Team[]>} */ (
        mapListResult(listRoute(this.puter, '/teams', options, 'list'), toTeam)
    );
}
