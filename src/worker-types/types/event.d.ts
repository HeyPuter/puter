import type { Puter } from '@heyputer/puter.js';
import type { Params } from './params.d.ts';

/**
 * The deployer's Puter context. Exposed in the global scope as `me`, `my`,
 * and `myself`, and authenticated with the worker's own credentials.
 */
export interface PuterContext {
    puter: Puter;
}

/**
 * The event object passed to every route handler.
 *
 * `TParams` defaults to the open-ended `Params` record, but the `Router`
 * methods infer it from the path literal so handlers get precisely-typed
 * `params` automatically.
 */
export interface WorkerEvent<TParams extends Params = Params> extends Extendable{
    request: Request;
    params: TParams;

    /**
     * Present only when the worker was invoked with a `puter-auth` header
     * (e.g. via `puter.workers.exec()`). When present, the deployer can act
     * on the caller's behalf through `user.puter`.
     */
    user?: PuterContext;

    /** @deprecated Alias for {@link WorkerEvent.user}. May be removed at a future date. */
    requestor?: PuterContext;

    /**
     * The **`WorkerEvent.waitUntil()`** method tells the event dispatcher that work is ongoing. It can also be used to detect whether that work was successful. In puter workers, waitUntil() tells the worker that work is ongoing until the promise settles, and it shouldn't terminate the worker if it wants that work to complete.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ExtendableEvent/waitUntil)
     */
    waitUntil(f: Promise<any>): void;
}

/**
 * The supported return shapes for a route handler. Anything other than a
 * `Response` is wrapped automatically by the router:
 *  - `string` / `Blob` / `ArrayBuffer` / `Uint8Array` / `ReadableStream` /
 *    `URLSearchParams` -> `new Response(value)`
 *  - plain objects -> JSON-encoded with `content-type: application/json`
 */
export type HandlerReturn =
    | Response
    | string
    | Blob
    | ArrayBuffer
    | Uint8Array
    | ReadableStream
    | URLSearchParams
    | Record<string, unknown>
    | unknown[]
    | number
    | boolean
    | null;

export type Handler<TParams extends Params = Params> = (
    event: WorkerEvent<TParams>,
) => HandlerReturn | Promise<HandlerReturn>;
