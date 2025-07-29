export class WorkersHandler {

    constructor(authToken) {
        this.authToken = authToken;
    }

    async create(workerName, filePath) {
        workerName = workerName.toLocaleLowerCase(); // just incase
        let currentWorkers = await puter.kv.get("user-workers");
        if (!currentWorkers) {
            currentWorkers = {};
        }

        const driverCall = await puter.drivers.call("workers", "worker-service", "create", { authorization: puter.authToken, filePath, workerName });
        const driverResult = driverCall.result;
        if (!driverCall.success || !driverResult.success) {
            throw new Error(driverResult?.errors || "Driver failed to execute, do you have the necessary permissions?");
        }
        currentWorkers[workerName] = { filePath, url: driverResult["url"], deployTime: Date.now() };
        await puter.kv.set("user-workers", currentWorkers);

        return driverResult;
    }

    async list() {
        return await puter.kv.get("user-workers");
    }

    async get(workerName) {
        workerName = workerName.toLocaleLowerCase(); // just incase
        try {
            return (await puter.kv.get("user-workers"))[workerName].url;
        } catch (e) {
            throw new Error("Failed to get worker");
        }
    }

    async delete(workerName) {
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
