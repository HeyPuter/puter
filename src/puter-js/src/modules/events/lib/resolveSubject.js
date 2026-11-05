import getAbsolutePathForApp from '../../FileSystem/utils/getAbsolutePathForApp.js';

/**
 * Resolves a relative `fs:` subject path the same way `puter.fs` operations
 * do:
 *
 *   - Already absolute (`/...`) or tilde-rooted (`~...`) -> unchanged.
 *   - UUID anchor (no `/` and no glob) -> unchanged.
 *   - Anything else -> run through `getAbsolutePathForApp`, which prepends
 *     `~/AppData/<appID>/` when there is an app context, or `~/` otherwise.
 *
 * The operation filter (`:add`, `:write`, ...) and glob suffix are stripped
 * before the path is tested and re-attached after, so `fs:./inbox:add`
 * resolves the `./inbox` part only.
 *
 * @param {string} subject   Raw subject string, e.g. `fs:./inbox:add`.
 * @param {import('../../../index.js').Puter} [puter]   The Puter instance,
 *   defaulting to `globalThis.puter`. Needed for `appID`.
 * @returns {string} Subject with the `fs:` path portion resolved.
 */
export const resolveSubject = (subject, puter = globalThis.puter) => {
    // Only `fs:` subjects embed a path; everything else passes through.
    if (!subject.startsWith('fs:')) return subject;

    // Strip the `fs:` family prefix.
    const rest = subject.slice('fs:'.length);

    // Split off an optional trailing `:op` filter (`:add`, `:write`, ...).
    // FS ops are single-word suffixes with no slashes.  Split on the last `:`
    // only when what follows it looks like a known op (no `/`).
    let pathPart = rest;
    let opSuffix = '';

    const lastColon = rest.lastIndexOf(':');
    if (lastColon !== -1) {
        const candidate = rest.slice(lastColon + 1);
        const FS_OPS = ['add', 'write', 'move', 'remove', 'meta'];
        if (FS_OPS.includes(candidate)) {
            pathPart = rest.slice(0, lastColon);
            opSuffix = `:${candidate}`;
        }
    }

    // Already absolute or tilde-rooted -> nothing to do.
    if (pathPart.startsWith('/') || pathPart.startsWith('~')) {
        return subject;
    }

    // Looks like a bare UUID (no slashes, no glob chars) -> treat as uid, not path.
    const reLooksLikeUUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (reLooksLikeUUID.test(pathPart)) return subject;

    // Relative path - resolve it the same way FS operations do.
    const resolved = getAbsolutePathForApp(pathPart, puter);
    return `fs:${resolved}${opSuffix}`;
};
