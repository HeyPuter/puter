import type { ListPage, ListPaginationOptions, ListStreamOptions } from '../shared.d.ts';

/** Information about a deployed worker, as returned by `get()` and `list()`. */
export interface WorkerInfo {
    /** The name of the worker. */
    name: string;
    /** The URL of the worker. */
    url: string;
    /** The file path of the worker's source code. */
    file_path: string;
    /** The unique identifier of the worker file. */
    file_uid: string;
    /** The date and time when the worker was created. */
    created_at: string;
}

/** The result of a worker deployment, as returned by `create()`. */
export interface WorkerDeployment {
    /** Whether the worker deployment was successful. */
    success: boolean;
    /** The URL of the deployed worker. */
    url: string;
    /** Any errors that occurred during deployment. */
    errors?: string[];
}

export class WorkersHandler {
    /**
     * Creates and deploys a new worker from a JavaScript file containing router code.
     * A worker is tied to its name: create it once, then deploy changes by overwriting
     * its source file rather than calling `create()` again. Workers cannot be larger
     * than 10MB. Requires a Puter account with a verified email address.
     *
     * @param workerName The name for the worker. May contain letters, numbers, hyphens, and underscores.
     * @param filePath The path to a JavaScript file in your Puter account that contains the router code.
     * @param appName The name of an existing app to associate the worker with. When provided, the worker is bound to that app and no sandbox app is created.
     */
    create (workerName: string, filePath: string, appName?: string): Promise<WorkerDeployment>;
    /**
     * @param options Controls the worker's sandbox. `sandbox` defaults to `true`;
     * when `true`, a dedicated `sandbox-<workerName>` app is created (or reused) to
     * own the worker. Pass `false` to opt out.
     */
    create (workerName: string, filePath: string, options?: { sandbox?: boolean }): Promise<WorkerDeployment>;
    /** Deletes an existing worker and stops its execution. Resolves to `true` if successful. */
    delete (workerName: string): Promise<boolean>;
    /**
     * Sends a request to a worker endpoint, automatically including the user's session
     * so the worker gets user context (`user.puter`) for the User-Pays model. Accepts the
     * same input as the Fetch API; resolves to a `Response`.
     */
    exec (request: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /** Gets information for a specific worker, or `undefined` if it does not exist. */
    get (workerName: string): Promise<WorkerInfo | undefined>;
    /**
     * Lists all workers in your account with their details, fetching page by
     * page under the hood. With `stream: true` it instead returns an async
     * iterator of pages for `for await ... of`; with any pagination option
     * it resolves to a single page envelope.
     */
    list (options: ListStreamOptions): AsyncIterableIterator<ListPage<WorkerInfo>>;
    list (options: ListPaginationOptions & ({ limit: number } | { offset: number } | { cursor: string | null } | { includeTotal: true })): Promise<ListPage<WorkerInfo>>;
    list (): Promise<WorkerInfo[]>;
    getLoggingHandle (workerName: string): Promise<EventTarget & {
        close: () => void;
        onLog: (event: MessageEvent) => void;
    }>;
}
