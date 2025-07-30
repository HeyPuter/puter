import getAbsolutePathForApp from "./FileSystem/utils/getAbsolutePathForApp.js";

export class WorkersHandler {

    constructor(authToken) {
        this.authToken = authToken;
    }

    async create(workerName, filePath) {
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                throw 'Authentication failed.';
            }
        }

        workerName = workerName.toLocaleLowerCase(); // just incase
        let currentWorkers = await puter.kv.get("user-workers");
        if (!currentWorkers) {
            currentWorkers = {};
        }
        filePath = getAbsolutePathForApp(filePath);

        const driverCall = await puter.drivers.call("workers", "worker-service", "create", { authorization: puter.authToken, filePath, workerName });
        const driverResult = driverCall.result;
        if (!driverCall.success || !driverResult.success) {
            throw new Error(driverResult?.errors || "Driver failed to execute, do you have the necessary permissions?");
        }
        currentWorkers[workerName] = { filePath, url: driverResult["url"], deployTime: Date.now() };
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

        return await puter.kv.get("user-workers");
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
        try {
            return (await puter.kv.get("user-workers"))[workerName].url;
        } catch (e) {
            throw new Error("Failed to get worker");
        }
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
        const driverCall = await puter.drivers.call("workers", "worker-service", "destroy", { authorization: puter.authToken, workerName });

        if (!driverCall.success || !driverCall.result.result) {
            if (!driverCall.result.result) {
                throw new Error("Worker doesn't exist");
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

}
