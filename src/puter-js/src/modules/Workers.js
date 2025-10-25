import getAbsolutePathForApp from "./FileSystem/utils/getAbsolutePathForApp.js";
import * as utils from '../lib/utils.js';

export class WorkersHandler {

    constructor(authToken) {
        this.authToken = authToken;
    }

    async create(workerName, filePath, appName) {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }

        let appId;
        if (typeof (appName)=== "string") {
            appId = ((await puter.apps.list()).find(el => el.name === appName)).uid;
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        let currentWorkers = await puter.kv.get("user-workers");
        if (!currentWorkers) {
            currentWorkers = {};
        }
        filePath = getAbsolutePathForApp(filePath);

        const driverResult = await utils.make_driver_method(['authorization', 'filePath', 'workerName', 'appId'], 'workers', "worker-service", 'create')(puter.authToken, filePath, workerName, appId);;

        if (!driverResult.success) {
            throw new Error(driverResult?.errors || "Driver failed to execute, do you have the necessary permissions?");
        }
        currentWorkers[workerName] = { filePath, url: driverResult["url"], deployTime: Date.now(), createTime: Date.now() };
        await puter.kv.set("user-workers", currentWorkers);

        return driverResult;
    }

    async exec(...args) {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }

        const req = new Request(...args);
        if (!req.headers.get("puter-auth")) {
            req.headers.set("puter-auth", puter.authToken);
        }
        return fetch(req);
    }

    async list() {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }
        const driverCall = await utils.make_driver_method([], 'workers', "worker-service", 'getFilePaths')();
        return driverCall;
    }

    async get(workerName) {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        const driverCall = await utils.make_driver_method(['workerName'], 'workers', "worker-service", 'getFilePaths')(workerName);
        return driverCall[0];
    }

    async delete(workerName) {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        // const driverCall = await puter.drivers.call("workers", "worker-service", "destroy", { authorization: puter.authToken, workerName });
        const driverResult = await utils.make_driver_method(['authorization', 'workerName'], 'workers', "worker-service", 'destroy')(puter.authToken, workerName);

        if (!driverResult.result) {
            if (!driverResult.result) {
                new Error("Worker doesn't exist");
            }
            throw new Error(driverResult?.errors || "Driver failed to execute, do you have the necessary permissions?");
        } else {
            let currentWorkers = await puter.kv.get("user-workers");

            if (!currentWorkers) {
                currentWorkers = {};
            }
            delete currentWorkers[workerName];

            await puter.kv.set("user-workers", currentWorkers);
            return true;
        }
    }
    
    async getLoggingHandle (workerName) {
        const loggingEndpoint = await utils.make_driver_method([], 'workers', "worker-service", 'getLoggingUrl')(puter.authToken, workerName);
        const socket = new WebSocket(`${loggingEndpoint}/${puter.authToken}/${workerName}`);
        const logStreamObject = new EventTarget();
        logStreamObject.onLog = (data) => { };

        // Coercibility to ReadableStream
        Object.defineProperty(logStreamObject, 'start', {
            enumerable: false,
            value: async (controller) => {
                socket.addEventListener("message", (event) => {
                    controller.enqueue(JSON.parse(event.data));
                });
                socket.addEventListener("close", (event) => {
                    try {
                        controller.close();
                    } catch (e) { }
                });
            }
        });
        Object.defineProperty(logStreamObject, 'cancel', {
            enumerable: false,
            value: async () => {
                socket.close();
            }
        });


        socket.addEventListener("message", (event) => {
            const logEvent = new MessageEvent("log", { data: JSON.parse(event.data) });

            logStreamObject.dispatchEvent(logEvent)
            logStreamObject.onLog(logEvent);
        });
        logStreamObject.close = socket.close;
        return new Promise((res, rej) => {
            let done = false;
            socket.onopen = ()=>{
                done = true;
                res(logStreamObject);
            }

            socket.onerror = () => {
                if (!done) {
                    rej("Failed to open logging connection");
                }
            }
        })
    }

}
