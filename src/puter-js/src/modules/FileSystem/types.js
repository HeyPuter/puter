// Shapes shared across the `puter.fs` operations. JSDoc-only; no runtime exports.

/** @typedef {import('../FSItem.js').FSItem} FSItem */
/**
 * @template [T=unknown]
 * @typedef {import('../../lib/types.js').RequestCallbacks<T>} RequestCallbacks
 */

/**
 * Storage space information for the current user, in bytes.
 *
 * @typedef {Object} SpaceInfo
 * @property {number} capacity Total storage capacity available to the user, in bytes.
 * @property {number} used Amount of storage space used by the user, in bytes.
 */

/**
 * @typedef {Object} CopyOptionsOwn
 * @property {string} [source] Path to the file or directory to copy. Required when passing options as
 * the only argument.
 * @property {string} [destination] Path to the destination. Required when passing options as the only
 * argument.
 * @property {boolean} [overwrite] Whether to overwrite the destination file or directory if it already
 * exists. Defaults to `false`.
 * @property {string} [newName] The new name to use for the copied file or directory. Defaults to
 * `undefined`.
 * @property {boolean} [dedupeName] Whether to deduplicate the file or directory name if it already
 * exists. Defaults to `false`.
 */

/**
 * Options for the `copy` operation.
 *
 * @typedef {CopyOptionsOwn & RequestCallbacks<FSItem>} CopyOptions
 */

/**
 * @typedef {Object} MoveOptionsOwn
 * @property {string} [source] Path to the file or directory to move. Required when passing options as
 * the only argument.
 * @property {string} [destination] Path to the destination. Required when passing options as the only
 * argument.
 * @property {boolean} [overwrite] Whether to overwrite the destination file or directory if it already
 * exists. Defaults to `false`.
 * @property {string} [newName] The new name to use for the moved file or directory. Defaults to
 * `undefined`.
 * @property {boolean} [createMissingParents] Whether to create missing parent directories. Defaults to
 * `false`.
 * @property {Record<string, unknown>} [newMetadata]
 * @property {string} [excludeSocketID]
 * @property {string} [original_client_socket_id]
 */

/**
 * Options for the `move` operation.
 *
 * @typedef {MoveOptionsOwn & RequestCallbacks<FSItem>} MoveOptions
 */

/**
 * @typedef {Object} MkdirOptionsOwn
 * @property {string} [path] The directory path to create if not specified via function parameter.
 * @property {boolean} [overwrite] Whether to overwrite the directory if it already exists. Defaults to
 * `false`.
 * @property {boolean} [dedupeName] Whether to deduplicate the directory name if it already exists.
 * Defaults to `false`.
 * @property {boolean} [rename]
 * @property {boolean} [createMissingParents] Whether to create missing parent directories. Defaults to
 * `false`.
 * @property {boolean} [recursive]
 * @property {string} [shortcutTo]
 */

/**
 * Options for the `mkdir` operation.
 *
 * @typedef {MkdirOptionsOwn & RequestCallbacks<FSItem>} MkdirOptions
 */

/**
 * @typedef {Object} DeleteOptionsOwn
 * @property {string | string[]} [paths] A single path or array of paths to delete. Required when
 * passing options as the only argument.
 * @property {boolean} [recursive] Whether to delete the directory recursively. Defaults to `true`.
 * @property {boolean} [descendantsOnly] Whether to delete only the descendants of the directory and not
 * the directory itself. Defaults to `false`.
 */

/**
 * Options for the `delete` operation.
 *
 * @typedef {DeleteOptionsOwn & RequestCallbacks<void>} DeleteOptions
 */

/**
 * @typedef {Object} ReadOptionsOwn
 * @property {string} [path] Path to the file to read. Required when passing options as the only
 * argument.
 * @property {number} [offset] The offset to start reading from.
 * @property {number} [byte_count] The number of bytes to read from the offset. Required if `offset` is
 * provided.
 */

/**
 * Options for the `read` operation.
 *
 * @typedef {ReadOptionsOwn & RequestCallbacks<Blob>} ReadOptions
 */

/**
 * @typedef {Object} ReaddirOptionsOwn
 * @property {string} [path] The path to the directory to read. Required when passing options as the
 * only argument.
 * @property {string} [uid] The UID of the directory to read.
 * @property {boolean} [no_thumbs]
 * @property {boolean} [no_assocs]
 * @property {'strong' | 'eventual'} [consistency]
 * @property {number} [limit] Maximum number of entries to return.
 * @property {number} [offset] Skips the given number of entries. Prefer `cursor` for paging through
 * large directories.
 * @property {string | null} [cursor] Opaque continuation cursor from a previous page.
 * @property {boolean} [includeTotal] Include a `total` count of every entry across all pages.
 * @property {'name' | 'modified' | 'type' | 'size'} [sortBy] Sort field. Default is `name`.
 * @property {'asc' | 'desc'} [sortOrder] Sort direction. Default is `asc`.
 * @property {boolean} [recursive] Whether to also list the contents of subdirectories. Defaults to
 * `false`.
 * @property {number} [depth] How many levels to descend when `recursive` is `true`. Defaults to
 * unlimited.
 */

/**
 * Options for the `readdir` operation.
 *
 * @typedef {ReaddirOptionsOwn & RequestCallbacks<FSItem[]>} ReaddirOptions
 */

/**
 * @typedef {Object} RenameOptionsOwn
 * @property {string} [uid] The UID of the file or directory to rename. Can be used instead of `path`.
 * @property {string} [path] Path to the file or directory to rename. Required when passing options as
 * the only argument.
 * @property {string} [newName] The new name for the file or directory. Required when passing options as
 * the only argument.
 * @property {string} [excludeSocketID]
 * @property {string} [original_client_socket_id]
 */

/**
 * Options for the `rename` operation.
 *
 * @typedef {RenameOptionsOwn & RequestCallbacks<FSItem>} RenameOptions
 */

/**
 * @typedef {Object} StatOptionsOwn
 * @property {string} [path] Path to the file or directory. Required when passing options as the only
 * argument.
 * @property {string} [uid] The UID of the file or directory. Can be used instead of `path`.
 * @property {'strong' | 'eventual'} [consistency]
 * @property {boolean} [returnSubdomains] Whether to return subdomain information. Defaults to `false`.
 * @property {boolean} [returnWorkers] Whether to return the workers attached to the item. Workers are
 * served alongside subdomains, so this is an alias of `returnSubdomains` — setting either one returns
 * both. Defaults to `false`.
 * @property {boolean} [returnPermissions] Whether to return permission information. Defaults to `false`.
 * @property {boolean} [returnVersions] Whether to return version information. Defaults to `false`.
 * @property {boolean} [returnSize] Whether to return size information. Defaults to `false`.
 */

/**
 * Options for the `stat` operation.
 *
 * @typedef {StatOptionsOwn & RequestCallbacks<FSItem>} StatOptions
 */

/**
 * @typedef {Object} UploadOptionsOwn
 * @property {boolean} [overwrite] Whether to overwrite the destination file if it already exists.
 * Defaults to `false`.
 * @property {boolean} [dedupeName] Whether to deduplicate the file name if it already exists. Defaults
 * to `true`. Ignored when `overwrite` is `true`.
 * @property {string} [name]
 * @property {boolean} [parsedDataTransferItems]
 * @property {boolean} [createFileParent]
 * @property {boolean} [createMissingAncestors]
 * @property {boolean} [createMissingParents] Whether to create missing parent directories. Defaults to
 * `false`.
 * @property {string} [shortcutTo]
 * @property {string} [appUID]
 * @property {boolean} [strict]
 * @property {(operationId: string, xhr: XMLHttpRequest) => void} [init]
 * @property {() => void} [start]
 * @property {(operationId: string, progress: number) => void} [progress]
 * @property {(operationId: string) => void} [abort]
 */

/**
 * Options for the `upload` operation.
 *
 * @typedef {UploadOptionsOwn & RequestCallbacks<FSItem | FSItem[]>} UploadOptions
 */

/**
 * One operation's outcome inside a failed upload: either a failed operation
 * (`error: true`, with its own `status`, `message`, and `code`) or the
 * `FSItem` a successful operation produced.
 *
 * @typedef {{ error: true, status?: number, message?: string, code?: string, [key: string]: unknown }
 *     | FSItem} UploadOperationResult
 */

/**
 * The rejection value of `upload()` when the batch request itself completed
 * but one or more of its operations failed.
 *
 * @typedef {Object} UploadBatchError
 * @property {string} message
 * @property {'batch_upload_failed' | 'batch_upload_partially_failed' | 'batch_upload_no_results'} code
 * `batch_upload_failed` when nothing was written, `batch_upload_partially_failed` when only some
 * operations failed, and `batch_upload_no_results` when the server reported success without saying what
 * it wrote.
 * @property {number} status
 * @property {UploadOperationResult[]} results Every operation's result, in the order the operations
 * were sent.
 * @property {UploadOperationResult[]} failedItems Just the operations that failed.
 * @property {number} failedCount
 * @property {number} totalCount
 */

/**
 * @typedef {Object} WriteOptionsOwn
 * @property {boolean} [overwrite] Whether to overwrite the file if it already exists. Defaults to
 * `true`.
 * @property {boolean} [dedupeName] Whether to deduplicate the file name if it already exists. Defaults
 * to `false`.
 * @property {boolean} [createMissingParents] Whether to create missing parent directories. Defaults to
 * `false`.
 * @property {boolean} [createMissingAncestors]
 * @property {(operationId: string, xhr: XMLHttpRequest) => void} [init]
 * @property {() => void} [start]
 * @property {(operationId: string, progress: number) => void} [progress]
 * @property {(operationId: string) => void} [abort]
 */

/**
 * Options for the `write` operation.
 *
 * @typedef {WriteOptionsOwn & RequestCallbacks<FSItem>} WriteOptions
 */

/**
 * What `sign()` resolves to.
 *
 * @template [T=Record<string, unknown>]
 * @typedef {Object} SignResult
 * @property {string} token
 * @property {T | T[]} items
 */

/**
 * Everything `upload()` accepts as its items argument.
 *
 * @typedef {DataTransferItemList
 *     | DataTransferItem
 *     | FileList
 *     | File[]
 *     | Blob[]
 *     | Blob
 *     | File
 *     | string
 *     | unknown[]} UploadItems
 */

export {};
