import path from 'path-browserify';

/**
 * Convert a v2 (camelCase) fsentry from `/fs/readdir` into the v1 snake_case
 * shape existing callers and the GUI consume. The backend readdir response is
 * enriched with the three fields the client can't reconstruct on its own
 * (`type`, a signed `thumbnail`, and `associatedApp`); everything else is a
 * rename or a trivial derivation here. Mirrors the backend's `toLegacyEntry`.
 *
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
const mapV2EntryToV1 = (entry) => {
    if ( ! entry || typeof entry !== 'object' ) return entry;

    const entryPath = typeof entry.path === 'string' ? entry.path : '';
    const dirname = entryPath ? path.dirname(entryPath) : entry.dirname;
    const pathComponents = entryPath.split('/');
    const appdata_app = pathComponents[2] === 'AppData'
        ? pathComponents[3]
        : undefined;
    const subdomains = Array.isArray(entry.subdomains) ? entry.subdomains : [];

    return {
        id: entry.uuid,
        uid: entry.uid ?? entry.uuid,
        uuid: entry.uuid,
        parent_id: entry.parentUid ?? null,
        parent_uid: entry.parentUid ?? null,
        path: entry.path,
        dirname,
        dirpath: dirname,
        name: entry.name,
        is_dir: Boolean(entry.isDir),
        is_shortcut: entry.isShortcut ? 1 : 0,
        shortcut_to: entry.shortcutTo ?? null,
        is_symlink: entry.isSymlink ? 1 : 0,
        symlink_path: entry.symlinkPath ?? null,
        type: entry.type ?? null,
        writable: true,
        is_public: entry.isPublic ?? null,
        thumbnail: entry.thumbnail ?? null,
        immutable: Boolean(entry.immutable),
        metadata: entry.metadata ?? null,
        modified: entry.modified,
        created: entry.created ?? null,
        accessed: entry.accessed ?? null,
        size: entry.size ?? null,
        layout: entry.layout ?? null,
        subdomains,
        workers: Array.isArray(entry.workers) ? entry.workers : [],
        has_website: entry.hasWebsite ?? subdomains.length > 0,
        suggested_apps: entry.suggestedApps,
        associated_app: entry.associatedApp ?? null,
        appdata_app,
    };
};

export default mapV2EntryToV1;
