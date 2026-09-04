import { PuterJSError } from '../../lib/PuterJSError.js';
import { req, requireSegment } from './lib/req.js';

/**
 * Provisions a new account owned by the team. Owner account only.
 *
 * There is no role: the owner account is the sole administrator and every
 * provisioned account is an ordinary member.
 *
 * The returned password is shown once and is not retrievable afterwards —
 * deliver it out of band. The member must change it at first sign-in.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {import('./types.js').CreateMemberOptions} options
 * @returns {Promise<import('./types.js').TemporaryCredential>}
 */
export async function createMember (uid, options) {
    const segment = requireSegment(uid, 'uid');
    if ( typeof options?.username !== 'string' || options.username.trim() === '' ) {
        throw new PuterJSError('`username` is required', 'invalid_request');
    }
    if ( typeof options?.email !== 'string' || options.email.trim() === '' ) {
        throw new PuterJSError('`email` is required', 'invalid_request');
    }

    const result = /** @type {Record<string, unknown>} */ (await req(this.puter, 'POST', `/teams/${segment}/members`, {
        body: { username: options.username, email: options.email },
        operation: 'createMember',
    }));
    return {
        username: /** @type {string} */ (result.username),
        temporaryPassword: /** @type {string} */ (result.temporary_password),
    };
}
