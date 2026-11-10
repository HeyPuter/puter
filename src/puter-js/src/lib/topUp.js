/**
 * Whether add-on credit is sold to the account `user` (its whoami) describes:
 * one with a plan of its own. A seat's plan and usage are its team's to pay for.
 *
 * @param {{ subscribed?: unknown, team?: { uid?: unknown } | null } | null | undefined} user
 * @returns {boolean}
 */
export const canTopUp = (user) =>
    user?.subscribed === true &&
    !(typeof user.team?.uid === 'string' && user.team.uid !== '');
