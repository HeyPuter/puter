import { req, requireSegment } from './lib/req.js';

/**
 * Deletes a team. Owner account only. The accounts it provisioned keep
 * existing; what stops is the team paying for them. Its audit log stays
 * readable to the owner account afterwards.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function del (uid) {
    const segment = requireSegment(uid, 'uid');
    await req(this.puter, 'DELETE', `/teams/${segment}`, { operation: 'delete' });
}
