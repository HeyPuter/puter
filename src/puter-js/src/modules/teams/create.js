import { PuterJSError } from '../../lib/PuterJSError.js';
import { req } from './lib/req.js';
import { toTeam } from './lib/shapes.js';

/** @typedef {import('./types.js').Team} Team */

/**
 * Creates a team owned by the caller, who becomes its owner account.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {import('./types.js').CreateTeamOptions} options
 * @returns {Promise<Team>}
 */
export async function create (options) {
    if ( typeof options?.name !== 'string' || options.name.trim() === '' ) {
        throw new PuterJSError('`name` is required', 'invalid_request');
    }
    const body = { name: options.name };
    if ( options.handle !== undefined ) body.handle = options.handle;

    return toTeam(await req(this.puter, 'POST', '/teams', { body, operation: 'create' }));
}
