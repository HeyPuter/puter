import { req, requireSegment } from './lib/req.js';
import { toTeam } from './lib/shapes.js';

/**
 * Returns one team the caller belongs to.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @returns {Promise<import('./types.js').Team>}
 */
export async function get (uid) {
    const segment = requireSegment(uid, 'uid');
    return toTeam(await req(this.puter, 'GET', `/teams/${segment}`, { operation: 'get' }));
}
