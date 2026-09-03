// The `/teams` routes answer in the backend's `snake_case` wire keys. Mapping
// happens here so the published SDK shapes stay camelCase and any wire change
// lands in one file.

/** @typedef {import('../types.js').Team} Team */
/** @typedef {import('../types.js').TeamMember} TeamMember */
/** @typedef {import('../types.js').TeamAuditEntry} TeamAuditEntry */

/**
 * @param {Record<string, unknown>} row
 * @returns {Team}
 */
export function toTeam (row) {
    return {
        uid: /** @type {string} */ (row.uid),
        name: /** @type {string | null} */ (row.name ?? null),
        handle: /** @type {string | null} */ (row.handle ?? null),
        isOwner: row.is_owner === true,
        createdAt: /** @type {string} */ (row.created_at),
    };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {TeamMember}
 */
export function toMember (row) {
    return {
        username: /** @type {string} */ (row.username),
        orgOwned: row.org_owned === true,
        createdAt: /** @type {string} */ (row.created_at),
    };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {TeamAuditEntry}
 */
export function toAuditEntry (row) {
    return {
        action: /** @type {string} */ (row.action),
        reason: /** @type {string | null} */ (row.reason ?? null),
        username: /** @type {string | null} */ (row.username ?? null),
        actorUsername: /** @type {string | null} */ (row.actor_username ?? null),
        createdAt: /** @type {string} */ (row.created_at),
    };
}

/**
 * Applies `map` to whichever of the three list forms `result` is, leaving the
 * form itself alone.
 *
 * @template T
 * @param {unknown} result
 * @param {(row: Record<string, unknown>) => T} map
 * @returns {unknown}
 */
export function mapListResult (result, map) {
    if ( result !== null && typeof result === 'object' && Symbol.asyncIterator in result ) {
        const pages = /** @type {AsyncIterableIterator<{ items: Record<string, unknown>[] }>} */ (result);
        return (async function* () {
            for await ( const page of pages ) {
                yield { ...page, items: (page.items ?? []).map(map) };
            }
        })();
    }
    return Promise.resolve(result).then(value => {
        if ( Array.isArray(value) ) return value.map(map);
        const page = /** @type {{ items?: Record<string, unknown>[] }} */ (value);
        return { ...page, items: (page?.items ?? []).map(map) };
    });
}
