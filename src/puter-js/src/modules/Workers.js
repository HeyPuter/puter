import getAbsolutePathForApp from './FileSystem/utils/getAbsolutePathForApp.js';
import { PuterModule } from '../lib/PuterModule.js';
import * as utils from '../lib/utils.js';
import { fetchAllPages, iteratePages } from '../lib/pagination.js';

/** @typedef {import('../../types/modules/workers').WorkerDeployment} WorkerDeployment */
/** @typedef {import('../../types/modules/workers').WorkerInfo} WorkerInfo */
/** @typedef {import('../../types/shared').ListPage<WorkerInfo>} WorkerPage */
/** @typedef {import('../../types/shared').ListPaginationOptions} ListPaginationOptions */
/** @typedef {import('../../types/shared').ListStreamOptions} ListStreamOptions */

/**
 * The `puter.workers` module: deploy and call serverless workers.
 */
export class WorkersHandler extends PuterModule {
    /**
     * @overload
     * @param {string} workerName
     * @param {string} filePath
     * @param {string} [appName] an existing app to bind the worker to
     * @returns {Promise<WorkerDeployment>}
     */
    /**
     * @overload
     * @param {string} workerName
     * @param {string} filePath
     * @param {{ sandbox?: boolean }} [options] pass `{ sandbox: false }` to opt
     *   out of the dedicated `sandbox-<workerName>` app that owns the worker
     * @returns {Promise<WorkerDeployment>}
     */
    /**
     * Deploys a worker from a JavaScript file in the user's Puter storage that
     * exports router code. A worker is tied to its name: create it once, then
     * ship changes by overwriting its source file rather than creating it
     * again. Requires a verified account, and the file must be under 10MB.
     *
     * @param {string} workerName
     * @param {string} filePath
     * @param {string | { sandbox?: boolean }} [appName]
     * @returns {Promise<WorkerDeployment>}
     */
    async create (workerName, filePath, appName) {
        await this.#authenticateIfNeeded();

        let appId;
        if ( typeof (appName) === 'object' || typeof (appName) === 'undefined' ) {
            const user = (this.puter.whoami || await this.puter.getUser());

            if ( user.is_user_token && (appName === undefined || appName?.sandbox !== false) ) {
                let sandboxApp;
                try {
                    sandboxApp = await this.puter.apps.get(`sandbox-${ workerName }`);
                } catch ( e ) {
                    sandboxApp = await this.puter.apps.create(`sandbox-${ workerName }`, 'https://worker-sandbox.puter.com/');
                }
                if ( sandboxApp.owner.uuid !== user.uuid ) {
                    throw new Error(`Sandbox context is not owned by you! This worker's sandbox is currently owned by: ${ sandboxApp.owner.username }`);
                }
                appId = sandboxApp.uid;
            }
        }
        if ( typeof (appName) === 'string' ) {
            appId = ((await this.puter.apps.list()).find(el => el.name === appName)).uid;
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        let currentWorkers = await this.puter.kv.get('user-workers');
        if ( ! currentWorkers ) {
            currentWorkers = {};
        }
        filePath = getAbsolutePathForApp(filePath);

        const driverResult = await utils.makeDriverMethod({ iface: 'workers', driver: 'worker-service', method: 'create', argNames: ['authorization', 'filePath', 'workerName', 'appId'] })(this.puter.authToken, filePath, workerName, appId);;

        if ( ! driverResult.success ) {
            throw new Error(driverResult?.errors || 'Driver failed to execute, do you have the necessary permissions?');
        }
        currentWorkers[workerName] = { filePath, url: driverResult['url'], deployTime: Date.now(), createTime: Date.now() };
        await this.puter.kv.set('user-workers', currentWorkers);

        return driverResult;
    }

    /**
     * Calls a worker endpoint, attaching the user's session so the worker gets
     * user context (`user.puter`) for the User-Pays model. Takes the same
     * arguments as `fetch` and resolves to its `Response`. Set the
     * `x-puter-no-auth` header to send the request without the session.
     *
     * @param {...unknown} args a `fetch`-compatible `(input, init?)` pair
     * @returns {Promise<Response>}
     */
    async exec (...args) {
        await this.#authenticateIfNeeded();

        const req = new Request(...args);
        if ( ! req.headers.get('puter-auth') && !req.headers.get('x-puter-no-auth')) {
            req.headers.set('puter-auth', this.puter.authToken);
        }
        req.headers.delete('x-puter-no-auth');
        // Passthrough to a user worker URL: takes the fetch Request interface and
        // returns the raw fetch Response as public API, so it stays on fetch
        // rather than the XHR-based fetchUrl (whose response is a narrower shape).
        return fetch(req);
    }

    async #authenticateIfNeeded () {
        if ( !this.puter.authToken && this.puter.env === 'web' ) {
            try {
                await this.puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }
    }

    /**
     * @overload
     * @param {ListStreamOptions} options
     * @returns {AsyncIterableIterator<WorkerPage>}
     */
    /**
     * @overload
     * @param {ListPaginationOptions} options
     * @returns {Promise<WorkerPage>}
     */
    /**
     * @overload
     * @returns {Promise<WorkerInfo[]>}
     */
    /**
     * Lists the account's workers. By default every page is fetched under the
     * hood and returned as one array; any pagination option returns a single
     * `{items, cursor?, total?}` page instead, and `stream: true` returns an
     * async iterator over those pages.
     *
     * @param {ListStreamOptions | ListPaginationOptions} [options]
     * @returns {Promise<WorkerInfo[] | WorkerPage> | AsyncIterableIterator<WorkerPage>}
     */
    list (options) {
        const opts = (options && typeof options === 'object') ? options : {};
        const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');
        const getFilePaths = utils.makeDriverMethod({ iface: 'workers', driver: 'worker-service', method: 'getFilePaths' });

        const base = {};
        if ( opts.limit !== undefined ) base.limit = opts.limit;
        const fetchPage = pageParams => getFilePaths({ ...base, ...pageParams });

        if ( opts.stream === true ) {
            if ( opts.offset !== undefined ) {
                throw { message: '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.', code: 'invalid_request' };
            }
            const self = this;
            return (async function* () {
                await self.#authenticateIfNeeded();
                yield* iteratePages(fetchPage, { cursor: opts.cursor, includeTotal: opts.includeTotal === true });
            })();
        }

        // Any pagination param keeps the single-request behavior: the page
        // envelope from the backend, exactly as requested.
        if ( opts.limit !== undefined || opts.offset !== undefined || hasCursor || opts.includeTotal !== undefined ) {
            return (async () => {
                await this.#authenticateIfNeeded();
                const args = { ...base };
                if ( opts.offset !== undefined ) args.offset = opts.offset;
                if ( hasCursor ) args.cursor = opts.cursor ?? null;
                if ( opts.includeTotal !== undefined ) args.includeTotal = opts.includeTotal;
                return await getFilePaths(args);
            })();
        }

        // Unbound listing: fetch page by page under the hood so no single
        // request carries the whole result, then return the legacy array.
        return (async () => {
            await this.#authenticateIfNeeded();
            return await fetchAllPages(fetchPage);
        })();
    }

    /**
     * Returns the named worker, or `undefined` if the account has no worker by
     * that name. Worker names are case-insensitive.
     *
     * @param {string} workerName
     * @returns {Promise<WorkerInfo | undefined>}
     */
    async get (workerName) {
        await this.#authenticateIfNeeded();

        workerName = workerName.toLocaleLowerCase(); // just incase
        const driverCall = await utils.makeDriverMethod({ iface: 'workers', driver: 'worker-service', method: 'getFilePaths', argNames: ['workerName'] })(workerName);
        return driverCall[0];
    }

    /**
     * Deletes a worker and stops it serving. Resolves to `true` on success.
     *
     * @param {string} workerName
     * @returns {Promise<boolean>}
     */
    async delete (workerName) {
        await this.#authenticateIfNeeded();

        workerName = workerName.toLocaleLowerCase(); // just incase
        const driverResult = await utils.makeDriverMethod({ iface: 'workers', driver: 'worker-service', method: 'destroy', argNames: ['authorization', 'workerName'] })(this.puter.authToken, workerName);

        if ( ! driverResult.result ) {
            if ( ! driverResult.result ) {
                new Error("Worker doesn't exist");
            }
            throw new Error(driverResult?.errors || 'Driver failed to execute, do you have the necessary permissions?');
        } else {
            let currentWorkers = await this.puter.kv.get('user-workers');

            if ( ! currentWorkers ) {
                currentWorkers = {};
            }
            delete currentWorkers[workerName];

            await this.puter.kv.set('user-workers', currentWorkers);
            return true;
        }
    }

    /**
     * Opens a live log stream for a worker. The resolved handle is an
     * `EventTarget` that emits `log` events (and calls `onLog`) as the worker
     * logs; `close()` ends the stream. It also carries `start`/`cancel`, so it
     * can be handed to a `ReadableStream`.
     *
     * @param {string} workerName
     * @returns {Promise<EventTarget & { close: () => void, onLog: (event: MessageEvent) => void }>}
     */
    async getLoggingHandle (workerName) {
        const loggingEndpoint = await utils.makeDriverMethod({ iface: 'workers', driver: 'worker-service', method: 'getLoggingUrl' })(this.puter.authToken, workerName);
        const socket = new WebSocket(`${loggingEndpoint}/${this.puter.authToken}/${workerName}`);
        const logStreamObject = new EventTarget();
        logStreamObject.onLog = (_data) => {

        };

        // Coercibility to ReadableStream
        Object.defineProperty(logStreamObject, 'start', {
            enumerable: false,
            value: async (controller) => {
                socket.addEventListener('message', (event) => {
                    controller.enqueue(JSON.parse(event.data));
                });
                socket.addEventListener('close', () => {
                    try {
                        controller.close();
                    } catch (e) {
                        // no-op
                    }
                });
            },
        });
        Object.defineProperty(logStreamObject, 'cancel', {
            enumerable: false,
            value: async () => {
                socket.close();
            },
        });

        socket.addEventListener('message', (event) => {
            const logEvent = new MessageEvent('log', { data: JSON.parse(event.data) });

            logStreamObject.dispatchEvent(logEvent);
            logStreamObject.onLog(logEvent);
        });
        logStreamObject.close = socket.close;
        return new Promise((res, rej) => {
            let done = false;
            socket.onopen = () => {
                done = true;
                res(logStreamObject);
            };

            socket.onerror = () => {
                if ( ! done ) {
                    rej('Failed to open logging connection');
                }
            };
        });
    }

}
