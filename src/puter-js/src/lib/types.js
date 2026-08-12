// Shared JSDoc-only types. No runtime exports.
//
// These are the shapes more than one module needs. Everything here is emitted
// into `types/lib/types.d.ts` by `npm run build:puterjs:types`; nothing under
// `types/` is written by hand.

/**
 * Constructor of `Class` whose instances omit the `Keys` members. Cast a
 * class to this to keep implementation-only fields (like the owning Puter
 * instance) off the public type without wrapping the class at runtime.
 *
 * The constraint must be `any[]`, not `unknown[]`: a constructor with typed
 * parameters isn't assignable to `new (...args: unknown[])`.
 *
 * @template {new (...args: any[]) => any} Class
 * @template {keyof InstanceType<Class>} Keys
 * @typedef {new (...args: ConstructorParameters<Class>) => Omit<InstanceType<Class>, Keys>} OmitMembers
 */

/**
 * The environment the SDK is running in.
 *
 * @typedef {'app' | 'gui' | 'web' | 'web-worker' | 'service-worker' | 'nodejs'} PuterEnvironment
 */

/**
 * The legacy positional callbacks most methods accept alongside the promise
 * they return.
 *
 * @template [T=unknown]
 * @typedef {Object} RequestCallbacks
 * @property {(value: T) => void} [success] Called with the result once the call succeeds.
 * @property {(reason: unknown) => void} [error] Called with the rejection reason if the call fails.
 */

/**
 * @typedef {Object} APILoggingConfigOwn
 * @property {boolean} [enabled] Whether request logging is on.
 */

/** @typedef {APILoggingConfigOwn & Record<string, unknown>} APILoggingConfig */

/**
 * Standard pagination request params shared by list APIs
 * (`puter.apps.list()`, `puter.hosting.list()`, `puter.workers.list()`,
 * `puter.fs.readdir()`).
 *
 * @typedef {Object} ListPaginationOptions
 * @property {number} [limit] Maximum items per page. Each endpoint documents its cap and default.
 * @property {number} [offset] Skips the given number of items. Cannot be combined with `cursor` or
 * `stream`; prefer `cursor` — requests get slower and more expensive the larger the offset.
 * @property {string | null} [cursor] Opaque continuation cursor. Pass `null` for the first page, then
 * each page's `cursor` to fetch the next one.
 * @property {boolean} [includeTotal] When `true`, the result includes a `total` count of every item
 * across all pages.
 */

/**
 * One page of a paginated listing.
 *
 * @template [T=unknown]
 * @typedef {Object} ListPage
 * @property {T[]} items The items on this page. A page may hold fewer than `limit` items while more pages exist.
 * @property {string} [cursor] Present only while more pages exist; pass it to the next call to resume.
 * @property {number} [total] Total item count across all pages; present when requested via `includeTotal`.
 */

/**
 * The `stream: true` form of list methods: returns an async iterator of
 * pages for `for await ... of` instead of a promise.
 *
 * @typedef {Object} ListStreamOptions
 * @property {true} stream Stream page envelopes as they are fetched.
 * @property {number} [limit] Maximum items per page. Defaults to the endpoint's page size.
 * @property {string | null} [cursor] Start streaming from a previous page's `cursor` instead of the beginning.
 * @property {boolean} [includeTotal] Include a `total` count on the first streamed page.
 */

/**
 * @deprecated Superseded by {@link ListPaginationOptions}; kept for callers still
 * passing the page/per-page form.
 *
 * @typedef {Object} PaginationOptions
 * @property {number} [page]
 * @property {number} [per_page]
 */

/**
 * @deprecated Superseded by {@link ListPage}.
 *
 * @template [T=unknown]
 * @typedef {Object} PaginatedResult
 * @property {T[]} data
 * @property {number} [page]
 * @property {number} [pages]
 */

/**
 * A tool the SDK exposes to a parent app over the `puter.tools` bridge.
 *
 * @typedef {Object} ToolSchema
 * @property {{ name: string, description: string, parameters: Record<string, unknown>, strict?: boolean }} function
 * The tool's JSON-schema description, in OpenAI function-calling form.
 * @property {(parameters: Record<string, unknown>) => unknown | Promise<unknown>} exec
 * Runs the tool with the parameters the caller supplied.
 */

export {};
