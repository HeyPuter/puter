import type { ListPage, ListStreamOptions, RequestCallbacks } from '../shared.d.ts';
import type { FSItem } from './fs-item.d.ts';

/**
 * Storage space information for the current user, in bytes.
 */
export interface SpaceInfo {
    /** Total storage capacity available to the user, in bytes. */
    capacity: number;
    /** Amount of storage space used by the user, in bytes. */
    used: number;
}

/**
 * Options for the `copy` operation.
 */
export interface CopyOptions extends RequestCallbacks<FSItem> {
    /** Path to the file or directory to copy. Required when passing options as the only argument. */
    source?: string;
    /** Path to the destination. Required when passing options as the only argument. */
    destination?: string;
    /** Whether to overwrite the destination file or directory if it already exists. Defaults to `false`. */
    overwrite?: boolean;
    /** The new name to use for the copied file or directory. Defaults to `undefined`. */
    newName?: string;
    /** Whether to deduplicate the file or directory name if it already exists. Defaults to `false`. */
    dedupeName?: boolean;
}

/**
 * Options for the `move` operation.
 */
export interface MoveOptions extends RequestCallbacks<FSItem> {
    /** Path to the file or directory to move. Required when passing options as the only argument. */
    source?: string;
    /** Path to the destination. Required when passing options as the only argument. */
    destination?: string;
    /** Whether to overwrite the destination file or directory if it already exists. Defaults to `false`. */
    overwrite?: boolean;
    /** The new name to use for the moved file or directory. Defaults to `undefined`. */
    newName?: string;
    /** Whether to create missing parent directories. Defaults to `false`. */
    createMissingParents?: boolean;
    newMetadata?: Record<string, unknown>;
    excludeSocketID?: string;
    original_client_socket_id?: string;
}

/**
 * Options for the `mkdir` operation.
 */
export interface MkdirOptions extends RequestCallbacks<FSItem> {
    /** The directory path to create if not specified via function parameter. */
    path?: string;
    /** Whether to overwrite the directory if it already exists. Defaults to `false`. */
    overwrite?: boolean;
    /** Whether to deduplicate the directory name if it already exists. Defaults to `false`. */
    dedupeName?: boolean;
    rename?: boolean;
    /** Whether to create missing parent directories. Defaults to `false`. */
    createMissingParents?: boolean;
    recursive?: boolean;
    shortcutTo?: string;
}

/**
 * Options for the `delete` operation.
 */
export interface DeleteOptions extends RequestCallbacks<void> {
    /** A single path or array of paths to delete. Required when passing options as the only argument. */
    paths?: string | string[];
    /** Whether to delete the directory recursively. Defaults to `true`. */
    recursive?: boolean;
    /** Whether to delete only the descendants of the directory and not the directory itself. Defaults to `false`. */
    descendantsOnly?: boolean;
}

/**
 * Options for the `read` operation.
 */
export interface ReadOptions extends RequestCallbacks<Blob> {
    /** Path to the file to read. Required when passing options as the only argument. */
    path?: string;
    /** The offset to start reading from. */
    offset?: number;
    /** The number of bytes to read from the offset. Required if `offset` is provided. */
    byte_count?: number;
}

/**
 * Options for the `readdir` operation.
 */
export interface ReaddirOptions extends RequestCallbacks<FSItem[]> {
    /** The path to the directory to read. Required when passing options as the only argument. */
    path?: string;
    /** The UID of the directory to read. */
    uid?: string;
    no_thumbs?: boolean;
    no_assocs?: boolean;
    consistency?: 'strong' | 'eventual';
    /** Maximum number of entries to return. */
    limit?: number;
    /** Skips the given number of entries. Prefer `cursor` for paging through large directories. */
    offset?: number;
    /** Sort field. Default is `name`. */
    sortBy?: 'name' | 'modified' | 'type' | 'size';
    /** Sort direction. Default is `asc`. */
    sortOrder?: 'asc' | 'desc';
}

/**
 * Options for the `rename` operation.
 */
export interface RenameOptions extends RequestCallbacks<FSItem> {
    /** The UID of the file or directory to rename. Can be used instead of `path`. */
    uid?: string;
    /** Path to the file or directory to rename. Required when passing options as the only argument. */
    path?: string;
    /** The new name for the file or directory. Required when passing options as the only argument. */
    newName?: string;
    excludeSocketID?: string;
    original_client_socket_id?: string;
}

/**
 * Options for the `stat` operation.
 */
export interface StatOptions extends RequestCallbacks<FSItem> {
    /** Path to the file or directory. Required when passing options as the only argument. */
    path?: string;
    /** The UID of the file or directory. Can be used instead of `path`. */
    uid?: string;
    consistency?: 'strong' | 'eventual';
    /** Whether to return subdomain information. Defaults to `false`. */
    returnSubdomains?: boolean;
    /** Whether to return permission information. Defaults to `false`. */
    returnPermissions?: boolean;
    /** Whether to return version information. Defaults to `false`. */
    returnVersions?: boolean;
    /** Whether to return size information. Defaults to `false`. */
    returnSize?: boolean;
}

/**
 * Options for the `upload` operation.
 */
export interface UploadOptions extends RequestCallbacks<FSItem | FSItem[]> {
    /** Whether to overwrite the destination file if it already exists. Defaults to `false`. */
    overwrite?: boolean;
    /** Whether to deduplicate the file name if it already exists. Defaults to `true`. Ignored when `overwrite` is `true`. */
    dedupeName?: boolean;
    name?: string;
    parsedDataTransferItems?: boolean;
    createFileParent?: boolean;
    createMissingAncestors?: boolean;
    /** Whether to create missing parent directories. Defaults to `false`. */
    createMissingParents?: boolean;
    shortcutTo?: string;
    appUID?: string;
    strict?: boolean;
    init?: (operationId: string, xhr: XMLHttpRequest) => void;
    start?: () => void;
    progress?: (operationId: string, progress: number) => void;
    abort?: (operationId: string) => void;
}

/**
 * Options for the `write` operation.
 */
export interface WriteOptions extends RequestCallbacks<FSItem> {
    /** Whether to overwrite the file if it already exists. Defaults to `true`. */
    overwrite?: boolean;
    /** Whether to deduplicate the file name if it already exists. Defaults to `false`. */
    dedupeName?: boolean;
    /** Whether to create missing parent directories. Defaults to `false`. */
    createMissingParents?: boolean;
    createMissingAncestors?: boolean;
    init?: (operationId: string, xhr: XMLHttpRequest) => void;
    start?: () => void;
    progress?: (operationId: string, progress: number) => void;
    abort?: (operationId: string) => void;
}

export interface SignResult<T = Record<string, unknown>> {
    token: string;
    items: T | T[];
}

export type UploadItems = DataTransferItemList | DataTransferItem | FileList | File[] | Blob[] | Blob | File | string | unknown[];

/**
 * The Cloud Storage API. Lets you store and manage files and directories in the cloud.
 */
export class FS {
    /**
     * Returns the storage space capacity and usage for the current user, in bytes.
     * Requires permission to access the user's storage space.
     */
    space (): Promise<SpaceInfo>;
    space (options: RequestCallbacks<SpaceInfo>): Promise<SpaceInfo>;
    space (success: (value: SpaceInfo) => void, error?: (reason: unknown) => void): Promise<SpaceInfo>;

    /**
     * Creates a directory. Resolves to the `FSItem` of the created directory.
     * If `path` is not absolute, it is resolved relative to the app's root directory.
     */
    mkdir (options: MkdirOptions): Promise<FSItem>;
    mkdir (path: string, options?: MkdirOptions): Promise<FSItem>;
    mkdir (path: string, options: MkdirOptions, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;
    mkdir (path: string, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    /**
     * Copies a file or directory from one location to another. Resolves to the `FSItem`
     * of the copied file or directory. If the source does not exist, the promise is rejected.
     * If `destination` is a directory, the item is copied into it using the same name.
     */
    copy (options: CopyOptions): Promise<FSItem>;
    copy (source: string, destination: string, options?: CopyOptions): Promise<FSItem>;
    copy (source: string, destination: string, options: CopyOptions | undefined, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    /**
     * Moves a file or directory from one location to another. Resolves to the `FSItem`
     * of the moved file or directory. If the source does not exist, the promise is rejected.
     * If `destination` is a directory, the item is moved into it using the same name.
     */
    move (options: MoveOptions): Promise<FSItem>;
    move (source: string, destination: string, options?: MoveOptions): Promise<FSItem>;

    /**
     * Renames a file or directory to a new name. Resolves to the `FSItem` of the renamed item.
     * If `path` is not absolute, it is resolved relative to the app's root directory.
     */
    rename (options: RenameOptions): Promise<FSItem>;
    rename (path: string, newName: string, success?: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    /**
     * Reads data from a file. Resolves to a `Blob` containing the file's contents.
     * If `path` is not absolute, it is resolved relative to the app's root directory.
     */
    read (options: ReadOptions): Promise<Blob>;
    read (path: string, options?: ReadOptions): Promise<Blob>;
    read (path: string, success: (value: Blob) => void, error?: (reason: unknown) => void): Promise<Blob>;

    /**
     * Reads the contents of a directory. Resolves to an array of `FSItem` objects
     * (files and directories) within the specified directory.
     * If `path` is not absolute, it is resolved relative to the app's root directory.
     */
    readdir (options: ReaddirOptions & ListStreamOptions): AsyncIterableIterator<ListPage<FSItem>>;
    readdir (options: ReaddirOptions & { includeTotal?: boolean } & ({ cursor: string | null } | { includeTotal: true })): Promise<ListPage<FSItem>>;
    readdir (options: ReaddirOptions): Promise<FSItem[]>;
    readdir (path: string, success?: (value: FSItem[]) => void, error?: (reason: unknown) => void): Promise<FSItem[]>;

    /**
     * Gets information about a file or directory. Resolves to the `FSItem` of the item.
     * If `path` is not absolute, it is resolved relative to the app's root directory.
     */
    stat (options: StatOptions): Promise<FSItem>;
    stat (path: string, options?: StatOptions): Promise<FSItem>;
    stat (path: string, options: StatOptions, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;
    stat (path: string, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    /**
     * Deletes a file or directory. Accepts a single path or an array of paths.
     * Resolves when the file(s) or directory(ies) are deleted.
     * If a path is not absolute, it is resolved relative to the app's root directory.
     */
    delete (options: DeleteOptions): Promise<void>;
    delete (paths: string | string[], options?: DeleteOptions): Promise<void>;

    /**
     * Uploads local items to the Puter filesystem. Resolves to a single `FSItem` if `items`
     * contains one item, or an array of `FSItem` objects if it contains multiple items.
     * If `dirPath` is not set, items are uploaded to the app's root directory.
     */
    upload (items: UploadItems, dirPath?: string, options?: UploadOptions): Promise<FSItem | FSItem[]>;

    /**
     * Writes data to a file, creating it if it does not exist. Resolves to the `FSItem`
     * of the written file. If `path` is not absolute, it is resolved relative to the app's
     * root directory. A `File` may be written directly, in which case its path is derived
     * from the file's name.
     */
    write (file: File): Promise<FSItem>;
    write (path: string, data: string | File | Blob | ArrayBuffer | ArrayBufferView, options?: WriteOptions): Promise<FSItem>;

    sign (appUid: string, items: unknown | unknown[], success?: (result: SignResult) => void, error?: (reason: unknown) => void): Promise<SignResult>;

    /**
     * Generates a URL that can be used to read a file. Resolves to the URL string.
     * `expiresIn` controls how long the URL stays valid, as a
     * [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken#usage) duration string
     * (e.g. `'24h'`, `'30d'`; units `s`, `m`, `h`, `d`, `w`, `y`) or a number of seconds.
     * Defaults to `'24h'`.
     */
    getReadURL (path: string, expiresIn?: string | number): Promise<string>;
}
