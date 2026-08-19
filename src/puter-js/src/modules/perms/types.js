// Shapes shared across the `puter.perms` operations. JSDoc-only; no runtime exports.

/**
 * An access level a request can ask for. `write` implies `read`.
 *
 * @typedef {'read' | 'write'} PermsAccess
 */

/**
 * A special folder `requestFolder` can name. Trash and AppData are deliberately
 * absent: nothing should ask for blanket access to either, and another app's
 * AppData is reached through `requestAppData` instead.
 *
 * @typedef {'Desktop' | 'Documents' | 'Pictures' | 'Videos'} PermsFolderName
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
 * What `requestAppData` accepts. A bare class applies to both stores; the array
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
