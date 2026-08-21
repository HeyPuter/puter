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
 *
 * @typedef {'email'
 *     | 'folder'
 *     | 'apps'
 *     | 'subdomains'
 *     | 'appData'
 *     | 'appRootDir'
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
 * Details for `'permission'`, the raw-permission-string escape hatch. Several
 * at once go under a single prompt.
 *
 * @typedef {Object} PermsPermissionRequest
 * @property {string} [permission] - One permission string.
 * @property {string[]} [permissions] - Several, instead of `permission`.
 */

/**
 * Every details shape a `request`/`check` call accepts; the resource decides
 * which one applies — see the per-resource overloads.
 *
 * @typedef {PermsAccessRequest
 *     | PermsFolderRequest
 *     | PermsAppDataRequest
 *     | PermsAppRootDirRequest
 *     | PermsPermissionRequest} PermsRequestDetails
 */

/**
 * One batch entry: the resource, with its own details in the same object, so
 * one array can carry entries that each take different fields.
 *
 * @typedef {{ resource: 'email' }
 *     | ({ resource: 'folder' } & PermsFolderRequest)
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
 * The three access classes. `delete` is orthogonal to `write`: neither implies
 * the other, so an app that only adds data cannot remove any.
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
