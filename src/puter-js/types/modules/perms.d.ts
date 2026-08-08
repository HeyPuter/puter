export class Perms {
    grantUser (username: string, permission: string): Promise<Record<string, unknown>>;
    grantGroup (groupUid: string, permission: string): Promise<Record<string, unknown>>;
    grantApp (appUid: string, permission: string): Promise<Record<string, unknown>>;
    grantAppAnyUser (appUid: string, permission: string): Promise<Record<string, unknown>>;
    grantOrigin (origin: string, permission: string): Promise<Record<string, unknown>>;

    revokeUser (username: string, permission: string): Promise<Record<string, unknown>>;
    revokeGroup (groupUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeApp (appUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeAppAnyUser (appUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeOrigin (origin: string, permission: string): Promise<Record<string, unknown>>;

    createGroup (metadata?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
    addUsersToGroup (uid: string, usernames: string[]): Promise<Record<string, unknown>>;
    removeUsersFromGroup (uid: string, usernames: string[]): Promise<Record<string, unknown>>;
    listGroups (): Promise<Record<string, unknown>>;

    /**
     * Request a specific permission string to be granted. Note that some
     * permission strings are not supported and will be denied silently.
     * @param permission - The permission string to request.
     * @returns `true` if the permission was granted, `false` otherwise.
     */
    request (permission: string): Promise<boolean>;

    /**
     * Request to see a user's email. If the permission has already been granted
     * the user will not be prompted and their email address will be returned.
     * @returns The user's email address if granted, `null` if granted but the
     * user has no email address, or `undefined` if access is denied.
     */
    requestEmail (): Promise<string | null | undefined>;

    /**
     * Request read access to the user's Desktop folder.
     * @returns The Desktop folder path if granted, or `undefined` if denied.
     */
    requestReadDesktop (): Promise<string | undefined>;

    /**
     * Request write access to the user's Desktop folder.
     * @returns The Desktop folder path if granted, or `undefined` if denied.
     */
    requestWriteDesktop (): Promise<string | undefined>;

    /**
     * Request read access to the user's Documents folder.
     * @returns The Documents folder path if granted, or `undefined` if denied.
     */
    requestReadDocuments (): Promise<string | undefined>;

    /**
     * Request write access to the user's Documents folder.
     * @returns The Documents folder path if granted, or `undefined` if denied.
     */
    requestWriteDocuments (): Promise<string | undefined>;

    /**
     * Request read access to the user's Pictures folder.
     * @returns The Pictures folder path if granted, or `undefined` if denied.
     */
    requestReadPictures (): Promise<string | undefined>;

    /**
     * Request write access to the user's Pictures folder.
     * @returns The Pictures folder path if granted, or `undefined` if denied.
     */
    requestWritePictures (): Promise<string | undefined>;

    /**
     * Request read access to the user's Videos folder.
     * @returns The Videos folder path if granted, or `undefined` if denied.
     */
    requestReadVideos (): Promise<string | undefined>;

    /**
     * Request write access to the user's Videos folder.
     * @returns The Videos folder path if granted, or `undefined` if denied.
     */
    requestWriteVideos (): Promise<string | undefined>;

    /**
     * Request read access to the user's apps.
     * @returns `true` if read access was granted, `false` otherwise.
     */
    requestReadApps (): Promise<boolean>;

    /**
     * Request write (manage) access to the user's apps.
     * @returns `true` if manage access was granted, `false` otherwise.
     */
    requestManageApps (): Promise<boolean>;

    /**
     * Request read access to the user's subdomains.
     * @returns `true` if read access was granted, `false` otherwise.
     */
    requestReadSubdomains (): Promise<boolean>;

    /**
     * Request write (manage) access to the user's subdomains.
     * @returns `true` if manage access was granted, `false` otherwise.
     */
    requestManageSubdomains (): Promise<boolean>;

    /**
     * Request permission to use another app's data: its key-value namespace and
     * its AppData directory, both scoped to the current user.
     *
     * Deleting entries is a separate scope from writing them, so request
     * `delete` explicitly when the app needs to remove data it did not write.
     *
     * @param appIdentifier - The target app's uid, registered name, or an object
     * carrying either.
     * @param scopes - An access class applied to both stores, an array of
     * `'<store>:<name>'` pairs, or a per-store object.
     * @returns `true` if the app may now use that data, `false` if denied.
     */
    requestAppData (
        appIdentifier: string | { uid: string } | { name: string },
        scopes: AppDataScopes,
    ): Promise<boolean>;
}

/** The stores an `app-data` scope can name. */
export type AppDataStore = 'kv' | 'fs';

/**
 * The three access classes. `delete` is orthogonal to `write`: neither implies
 * the other, so an app that only adds data cannot remove any.
 */
export type AppDataClass = 'read' | 'write' | 'delete';

/**
 * A key-value scope: an access class, or one concrete operation. Classes are
 * the coarser form — `read` covers `get`/`list`, `write` covers
 * `set`/`add`/`incr`/`decr`/`update`, and `delete` covers
 * `del`/`remove`/`expire`/`expireAt`.
 *
 * `flush` is deliberately absent — it empties a whole namespace and no scope
 * reaches it.
 */
export type AppDataKvScope =
    | AppDataClass
    | 'get' | 'list'
    | 'set' | 'add' | 'incr' | 'decr' | 'update'
    | 'del' | 'remove' | 'expire' | 'expireAt';

/**
 * A file scope. Classes only, with no per-operation form: ACL checks a mode,
 * not an operation, so there is nothing finer to name.
 */
export type AppDataFsScope = AppDataClass;

/** One `'<store>:<name>'` pair, as the array form takes them. */
export type AppDataScopePair =
    | `kv:${AppDataKvScope}`
    | `fs:${AppDataFsScope}`;

/**
 * What `requestAppData` accepts. A bare class applies to both stores; the array
 * form spells out the store on every entry; the object form groups by store.
 * There is no bare-name array — an entry with no store would be ambiguous
 * between the two.
 */
export type AppDataScopes =
    | AppDataClass
    | AppDataScopePair[]
    | {
        kv?: AppDataKvScope | AppDataKvScope[],
        fs?: AppDataFsScope | AppDataFsScope[],
    };
