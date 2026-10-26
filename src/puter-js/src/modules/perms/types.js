// Shapes shared across the `puter.perms` operations. JSDoc-only; no runtime exports.

/**
 * An access level a request can ask for. `write` implies `read`.
 *
 * @typedef {'read' | 'write'} PermsAccess
 */

/**
 * A special folder a `'folder'` request can name. Trash and AppData are
 * deliberately absent: nothing should ask for blanket access to either, and
 * another app's AppData is reached through `'appData'` instead.
 *
 * @typedef {'Desktop' | 'Documents' | 'Pictures' | 'Videos'} PermsFolderName
 */

/**
 * What a `request`/`check` call is about; decides the details and the result.
 * `puter.perms.Resource` names each one. `'permission'` is deprecated.
 *
 * @typedef {'fs'
 *     | 'folder'
 *     | 'email'
 *     | 'apps'
 *     | 'subdomains'
 *     | 'appData'
 *     | 'appRootDir'
 *     | 'backgroundEvents'
 *     | 'kvShare'
 *     | 'permission'} PermsResource
 */

/**
 * Details for a resource that only takes an access level — `'apps'` and
 * `'subdomains'`.
 *
 * @typedef {Object} PermsAccessRequest
 * @property {PermsAccess} [access] - Defaults to `'read'`. `write` implies read.
 */

/**
 * Details for `'folder'`.
 *
 * @typedef {Object} PermsFolderRequest
 * @property {PermsFolderName} name - Desktop, Documents, Pictures, or Videos.
 * @property {PermsAccess} [access] - Defaults to `'read'`.
 */

/**
 * Details for `'fs'`: one file or folder, by `path` or by `uid`. Access to a
 * folder covers everything inside it.
 *
 * @typedef {Object} PermsFsRequest
 * @property {string} [path] - An absolute path, or one starting with `~/` for
 *   the user's home folder.
 * @property {string} [uid] - The file or folder's uid, instead of `path`.
 * @property {PermsAccess} [access] - Defaults to `'read'`. `write` implies read.
 * @property {PermsCreateKind} [create] - Create a missing `path` after the user
 *   allows it. Defaults to `true`.
 */

/**
 * The level of share a `'kvShare'` request lets the app create. `'watch'`
 * shares change events for the region, `'read'` adds reads, and `'write'` adds
 * writes and deletes. Each level covers the ones before it.
 *
 * @typedef {'watch' | 'read' | 'write'} PermsKvShareAccess
 */

/**
 * Details for `'kvShare'`: let this app share a region of the key-value data it
 * keeps for the user with other people it picks.
 *
 * @typedef {Object} PermsKvShareRequest
 * @property {string} prefix - The key prefix of the region, such as
 *   `'workspace:abc:'`. Not the whole namespace, and not a pattern.
 * @property {PermsKvShareAccess} [access] - Defaults to `'watch'`.
 */

/**
 * Details for `'appData'` — another app's key-value namespace and AppData files.
 *
 * @typedef {Object} PermsAppDataRequest
 * @property {string | { uid: string } | { name: string }} app - The target app,
 * by uid or by registered name.
 * @property {AppDataScopes} scopes - What this app wants to do with that data.
 */

/**
 * Details for `'appRootDir'` — the root directory of one of the user's own apps.
 *
 * @typedef {Object} PermsAppRootDirRequest
 * @property {string | { uid: string }} app - The app, by uid or an object with one.
 * @property {PermsAccess} [access] - Defaults to `'read'`.
 */

/**
 * What kind of entry `create` should make when its path is missing. `true`
 * (the default) picks a kind from the basename (a dot beyond one leading one
 * means a file); `'dir'`/`'file'` force it; `false` leaves a missing path alone.
 *
 * @typedef {boolean | 'dir' | 'file'} PermsCreateKind
 */

/**
 * Details for `'permission'`, the raw-permission-string escape hatch. Several
 * at once go under a single prompt.
 *
 * @deprecated Use the resource the string names: `'fs'`, `'email'`, `'apps'`,
 *   `'subdomains'`, `'appData'`, `'appRootDir'`, `'backgroundEvents'`, or
 *   `'kvShare'`.
 *
 * @typedef {Object} PermsPermissionRequest
 * @property {string} [permission] - One permission string.
 * @property {string[]} [permissions] - Several, instead of `permission`.
 * @property {PermsCreateKind} [create] - For an `fs:` permission naming a
 *   missing path, create it after approval. Defaults to `true`. See
 *   `puter.perms.request`.
 */

/**
 * Every details shape a `request`/`check` call accepts; the resource decides
 * which one applies — see the per-resource overloads.
 *
 * @typedef {PermsAccessRequest
 *     | PermsFsRequest
 *     | PermsFolderRequest
 *     | PermsKvShareRequest
 *     | PermsAppDataRequest
 *     | PermsAppRootDirRequest
 *     | PermsPermissionRequest} PermsRequestDetails
 */

/**
 * One batch entry: the resource, with its own details in the same object, so
 * one array can carry entries that each take different fields.
 *
 * @typedef {{ resource: 'email' | 'backgroundEvents' }
 *     | ({ resource: 'fs' } & PermsFsRequest)
 *     | ({ resource: 'folder' } & PermsFolderRequest)
 *     | ({ resource: 'kvShare' } & PermsKvShareRequest)
 *     | ({ resource: 'apps' | 'subdomains' } & PermsAccessRequest)
 *     | ({ resource: 'appData' } & PermsAppDataRequest)
 *     | ({ resource: 'appRootDir' } & PermsAppRootDirRequest)
 *     | ({ resource: 'permission' } & PermsPermissionRequest)} PermsBatchEntry
 */

/**
 * The stores an `app-data` scope can name.
 *
 * @typedef {'kv' | 'fs'} AppDataStore
 */

/**
 * The three access classes. Each implies the ones before it (`delete` >
 * `write` > `read`), so an app that only adds data cannot remove any.
 *
 * @typedef {'read' | 'write' | 'delete'} AppDataClass
 */

/**
 * A key-value scope: an access class, or one concrete operation. Classes are
 * the coarser form — `read` covers `get`/`list`, `write` covers
 * `set`/`add`/`incr`/`decr`/`update`, and `delete` covers
 * `del`/`remove`/`expire`/`expireAt`.
 *
 * `flush` is deliberately absent — it empties a whole namespace and no scope
 * reaches it.
 *
 * @typedef {AppDataClass
 *     | 'get' | 'list'
 *     | 'set' | 'add' | 'incr' | 'decr' | 'update'
 *     | 'del' | 'remove' | 'expire' | 'expireAt'} AppDataKvScope
 */

/**
 * A file scope. Classes only, with no per-operation form: ACL checks a mode,
 * not an operation, so there is nothing finer to name.
 *
 * @typedef {AppDataClass} AppDataFsScope
 */

/**
 * One `'<store>:<name>'` pair, as the array form takes them.
 *
 * @typedef {`kv:${AppDataKvScope}` | `fs:${AppDataFsScope}`} AppDataScopePair
 */

/**
 * What an `'appData'` request accepts. A bare class applies to both stores; the array
 * form spells out the store on every entry; the object form groups by store.
 * There is no bare-name array — an entry with no store would be ambiguous
 * between the two.
 *
 * @typedef {AppDataClass
 *     | AppDataScopePair[]
 *     | {
 *         kv?: AppDataKvScope | AppDataKvScope[],
 *         fs?: AppDataFsScope | AppDataFsScope[],
 *     }} AppDataScopes
 */

export {};
