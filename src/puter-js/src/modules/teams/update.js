import { req, requireSegment } from './lib/req.js';
import { toTeam } from './lib/shapes.js';

/**
 * Renames a team or changes its handle. Owner account only. A released
 * handle becomes available to other teams, so anything holding one should
 * hold the `uid` instead.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {import('./types.js').UpdateTeamAttributes} attributes
 * @returns {Promise<import('./types.js').Team>}
 */
export async function update (uid, attributes) {
    const segment = requireSegment(uid, 'uid');

    const body = {};
    if ( attributes?.name !== undefined ) body.name = attributes.name;
    if ( attributes?.handle !== undefined ) body.handle = attributes.handle;
    if ( attributes?.directoryEnabled !== undefined ) body.directory_enabled = attributes.directoryEnabled;

    return toTeam(await req(this.puter, 'PUT', `/teams/${segment}`, { body, operation: 'update' }));
}
