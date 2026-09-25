import { req, requireSegment } from './lib/req.js';

/**
 * Clears two-factor authentication on an account the team owns, so the member
 * can enrol again from a device they still have. Owner account only.
 *
 * Deliberately separate from `resetPassword()`, which leaves 2FA alone so that
 * a password reset by itself is not a takeover. Together they are — which is
 * the team's to do for an account it created and pays for, but it has to be
 * chosen rather than arrived at sideways. Both write an audit row and mail the
 * member; this one also ends their sessions and leaves their password untouched.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function resetTwoFactor (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');

    await req(
        this.puter,
        'POST',
        `/teams/${teamSegment}/members/${userSegment}/2fa-reset`,
        { operation: 'resetTwoFactor' },
    );
}
