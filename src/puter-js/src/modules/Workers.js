import getAbsolutePathForApp from './FileSystem/utils/getAbsolutePathForApp.js';
import * as utils from '../lib/utils.js';
import { fetchAllPages, iteratePages } from '../lib/pagination.js';

export class WorkersHandler {

    constructor (authToken) {
        this.authToken = authToken;
    }

    async create (workerName, filePath, appName) {
        await this.#authenticateIfNeeded();

        let appId;
        if ( typeof (appName) === 'object' || typeof (appName) === 'undefined' ) {
            const user = (puter.whoami || await puter.getUser());

            if ( user.is_user_token && (appName === undefined || appName?.sandbox !== false) ) {
                let sandboxApp;
                try {
                    sandboxApp = await puter.apps.get(`sandbox-${ workerName }`);
                } catch ( e ) {
                    sandboxApp = await puter.apps.create(`sandbox-${ workerName }`, 'https://worker-sandbox.puter.com/');
                }
                if ( sandboxApp.owner.uuid !== user.uuid ) {
                    throw new Error(`Sandbox context is not owned by you! This worker's sandbox is currently owned by: ${ sandboxApp.owner.username }`);
                }
                appId = sandboxApp.uid;
            }
        }
        if ( typeof (appName) === 'string' ) {
            appId = ((await puter.apps.list()).find(el => el.name === appName)).uid;
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        let currentWorkers = await puter.kv.get('user-workers');
        if ( ! currentWorkers ) {
            currentWorkers = {};
        }
        filePath = getAbsolutePathForApp(filePath);

        const driverResult = await utils.make_driver_method(['authorization', 'filePath', 'workerName', 'appId'], 'workers', 'worker-service', 'create')(puter.authToken, filePath, workerName, appId);;

        if ( ! driverResult.success ) {
            throw new Error(driverResult?.errors || 'Driver failed to execute, do you have the necessary permissions?');
        }
        currentWorkers[workerName] = { filePath, url: driverResult['url'], deployTime: Date.now(), createTime: Date.now() };
        await puter.kv.set('user-workers', currentWorkers);

        return driverResult;
    }

    async exec (...args) {
        await this.#authenticateIfNeeded();

        const req = new Request(...args);
        if ( ! req.headers.get('puter-auth') && !req.headers.get('x-puter-no-auth')) {
            req.headers.set('puter-auth', puter.authToken);
        }
        req.headers.delete('x-puter-no-auth');
        // Passthrough to a user worker URL: takes the fetch Request interface and
        // returns the raw fetch Response as public API, so it stays on fetch
        // rather than the XHR-based fetchUrl (whose response is a narrower shape).
        return fetch(req);
    }

    async #authenticateIfNeeded () {
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }
    }

    list (options) {
        const opts = (options && typeof options === 'object') ? options : {};
        const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');
        const getFilePaths = utils.make_driver_method([], 'workers', 'worker-service', 'getFilePaths');

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

    async get (workerName) {
        await this.#authenticateIfNeeded();

        workerName = workerName.toLocaleLowerCase(); // just incase
        const driverCall = await utils.make_driver_method(['workerName'], 'workers', 'worker-service', 'getFilePaths')(workerName);
        return driverCall[0];
    }

    async delete (workerName) {
        await this.#authenticateIfNeeded();

        workerName = workerName.toLocaleLowerCase(); // just incase
        // const driverCall = await puter.drivers.call("workers", "worker-service", "destroy", { authorization: puter.authToken, workerName });
        const driverResult = await utils.make_driver_method(['authorization', 'workerName'], 'workers', 'worker-service', 'destroy')(puter.authToken, workerName);

        if ( ! driverResult.result ) {
            if ( ! driverResult.result ) {
                new Error("Worker doesn't exist");
            }
            throw new Error(driverResult?.errors || 'Driver failed to execute, do you have the necessary permissions?');
        } else {
            let currentWorkers = await puter.kv.get('user-workers');

            if ( ! currentWorkers ) {
                currentWorkers = {};
            }
            delete currentWorkers[workerName];

            await puter.kv.set('user-workers', currentWorkers);
            return true;
        }
    }

    async getLoggingHandle (workerName) {
        const loggingEndpoint = await utils.make_driver_method([], 'workers', 'worker-service', 'getLoggingUrl')(puter.authToken, workerName);
        const socket = new WebSocket(`${loggingEndpoint}/${puter.authToken}/${workerName}`);
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
