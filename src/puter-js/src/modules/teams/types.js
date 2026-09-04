// Shapes shared across the `puter.teams` operations. JSDoc-only; no runtime exports.

/**
 * A team. `uid` is the only stable reference: `handle` is a label that
 * `update()` can change and deleting the team releases, so a stored
 * handle can later resolve to a different team.
 *
 * @typedef {Object} Team
 * @property {string} uid The team's unique identifier. Pass this to every other `puter.teams` method.
 * @property {string | null} name The team's display name.
 * @property {string | null} handle The team's short handle, unique while it exists. `null` when unset.
 * @property {boolean} isOwner Whether the caller is the owner account of this team.
 * @property {string} createdAt When the team was created, in `YYYY-MM-DDTHH:MM:SSZ` format.
 */

/**
 * Options for `Teams.create()`.
 *
 * @typedef {Object} CreateTeamOptions
 * @property {string} name The team's display name.
 * @property {string | null} [handle] A short handle, lowercase letters, digits and single hyphens.
 * Omit or pass `null` for none.
 */

/**
 * Attributes to change with `Teams.update()`. Omitted fields are left alone.
 *
 * @typedef {Object} UpdateTeamAttributes
 * @property {string} [name] The team's new display name.
 * @property {string | null} [handle] A new handle, or `null` to release the current one.
 */

/**
 * An account belonging to a team.
 *
 * @typedef {Object} TeamMember
 * @property {string} username The member's Puter username.
 * @property {boolean} orgOwned Whether the team provisioned and pays for this account, as opposed
 * to a pre-existing account that joined it.
 * @property {string} createdAt When the account joined the team, in `YYYY-MM-DDTHH:MM:SSZ` format.
 */

/**
 * Details for the account `Teams.createMember()` provisions.
 *
 * @typedef {Object} CreateMemberOptions
 * @property {string} username The username for the new account. Must be free across all of Puter.
 * @property {string} email The address the member is reachable at. It must not already own an account.
 */

/**
 * The one-time credential for an account that has not been used yet. It is
 * shown once and cannot be retrieved afterwards — deliver it out of band.
 *
 * @typedef {Object} TemporaryCredential
 * @property {string} username The account the credential is for.
 * @property {string} temporaryPassword The password the member signs in with once, then must change.
 */

/**
 * One entry in a team's record of what it did to its accounts.
 *
 * @typedef {Object} TeamAuditEntry
 * @property {string} action What was done, e.g. `create_member`, `disable_member`, `delete_team`.
 * @property {string | null} reason The reason recorded with the action, when one was given.
 * @property {string | null} username The account the action was about. `null` if that account is gone.
 * @property {string | null} actorUsername Who performed it. `null` when Puter itself did.
 * @property {string} createdAt When it happened, in `YYYY-MM-DDTHH:MM:SSZ` format.
 */

export {};
