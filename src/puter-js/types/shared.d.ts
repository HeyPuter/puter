export type PuterEnvironment = 'app' | 'gui' | 'web' | 'web-worker' | 'service-worker' | 'nodejs';

export interface RequestCallbacks<T = unknown> {
    success?: (value: T) => void;
    error?: (reason: unknown) => void;
}

export interface APILoggingConfig {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface APICallLogger {
    isEnabled(): boolean;
    logRequest(entry: Record<string, unknown>): void;
    updateConfig(config: APILoggingConfig): void;
    disable(): void;
}

export interface PaginationOptions {
    page?: number;
    per_page?: number;
}

/**
 * Standard pagination request params shared by list APIs
 * (`puter.apps.list()`, `puter.hosting.list()`, `puter.workers.list()`,
 * `puter.fs.readdir()`).
 */
export interface ListPaginationOptions {
    /** Maximum items per page. Each endpoint documents its cap and default. */
    limit?: number;
    /**
     * Skips the given number of items. Cannot be combined with `cursor` or
     * `stream`; prefer `cursor` — requests get slower and more expensive the
     * larger the offset.
     */
    offset?: number;
    /**
     * Opaque continuation cursor. Pass `null` for the first page, then each
     * page's `cursor` to fetch the next one.
     */
    cursor?: string | null;
    /**
     * When `true`, the result includes a `total` count of every item across
     * all pages.
     */
    includeTotal?: boolean;
}

/** One page of a paginated listing. */
export interface ListPage<T> {
    /** The items on this page. A page may hold fewer than `limit` items while more pages exist. */
    items: T[];
    /** Present only while more pages exist; pass it to the next call to resume. */
    cursor?: string;
    /** Total item count across all pages; present when requested via `includeTotal`. */
    total?: number;
}

/**
 * The `stream: true` form of list methods: returns an async iterator of
 * pages for `for await ... of` instead of a promise.
 */
export interface ListStreamOptions {
    /** Stream page envelopes as they are fetched. */
    stream: true;
    /** Maximum items per page. Defaults to the endpoint's page size. */
    limit?: number;
    /** Start streaming from a previous page's `cursor` instead of the beginning. */
    cursor?: string | null;
    /** Include a `total` count on the first streamed page. */
    includeTotal?: boolean;
}

export interface PaginatedResult<T> {
    data: T[];
    page?: number;
    pages?: number;
}

export interface ToolSchema {
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
    exec: (parameters: Record<string, unknown>) => unknown | Promise<unknown>;
}
