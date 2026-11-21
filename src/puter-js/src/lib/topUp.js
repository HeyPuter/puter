/**
 * Whether `user` (a whoami) is a team seat. A seat's plan is its team's, and so are
 * paying for its usage and changing the plan.
 *
 * @param {{ team?: { uid?: unknown } | null } | null | undefined} user
 * @returns {boolean}
 */
export const isSeat = (user) => typeof user?.team?.uid === 'string' && user.team.uid !== '';

/**
 * Whether add-on credit is sold to the account `user` (its whoami) describes:
 * one with a plan of its own, and not a team seat.
 *
 * @param {{ subscribed?: unknown, team?: { uid?: unknown } | null } | null | undefined} user
 * @returns {boolean}
 */
export const canTopUp = (user) => user?.subscribed === true && !isSeat(user);
