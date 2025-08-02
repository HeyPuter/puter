const fs = require('fs')
const { calculateWorkerNameNew } = require("./nameUtils.js");
let config = {};
// Constants
const CF_BASE_URL = "https://api.cloudflare.com/"
let WORKERS_BASE_URL;
// Workers for Platforms support

function cfFetch(url, method = "GET", body, givenHeaders) {
    const headers = { "Authorization": "Bearer " + config["XAUTHKEY"] };
    if (givenHeaders) {
        for (const header of givenHeaders) {
            headers[header[0]] = header[1];
        }
    }
    return fetch(url, { headers, method, body })
}
async function getWorker(userData, authorization, workerId) {
    await cfFetch(`${WORKERS_BASE_URL}/scripts/${calculateWorkerNameNew(userData.uuid, workerId)}`, "GET");
}
async function createWorker(userData, authorization, workerName, body, PREAMBLE_LENGTH) {
    const formData = new FormData();

    const workerMetaData = {

        body_part: "swCode",
        compatibility_date: "2025-07-15",
        bindings: [
            {
                type: "secret_text",
                name: "puter_auth",
                text: authorization
            },
            {
                type: "plain_text",
                name: "puter_endpoint",
                text: config.internetExposedUrl || "https://api.puter.com"
            },
            
        ]

    }
    formData.append("metadata", JSON.stringify(workerMetaData));
    formData.append("swCode", body);
    const cfReturnCodes = await (await cfFetch(`${WORKERS_BASE_URL}/scripts/${workerName}/`, "PUT", formData)).json();

    if (cfReturnCodes.success) {
        return { success: true, errors: [], url: `https://${workerName}.puter.work` };
    } else {
        const parsedErrors = [];
        for (const error of cfReturnCodes.errors) {
            const message = error.message;
            let finalMessage = ""
            const lines = message.split("\n");
            finalMessage += lines.shift() + "\n"
            try {
                // throw new Error("test")
                for (const line of lines) {
                    if (line.includes("at worker.js:")) {
                        let positions = line.trimStart().replace("at worker.js:", "").split(":");
                        positions[0] = parseInt(positions[0]) - PREAMBLE_LENGTH;
                        finalMessage += `    at worker.js:${positions.join(":")}\n`;
                    } else {
                        finalMessage += line + "\n"
                    }
                }
            } catch (e) {
                console.error("Failed to parse V8 Stack trace\n" + message);
                finalMessage = message;
            }

            parsedErrors.push(finalMessage)
        }
        return { success: false, errors: parsedErrors, url: null, body };
    }
}
function setPreambleLength(length) {

}
function setCloudflareKeys(givenConfig) {
    config = givenConfig;
    WORKERS_BASE_URL = CF_BASE_URL + `client/v4/accounts/${config.ACCOUNTID}/workers`;
    if (config.namespace) {
        WORKERS_BASE_URL += `/dispatch/namespaces/${config.namespace}`;
    }

}

async function deleteWorker(userData, authorization, workerId) {
    return await (await cfFetch(`${WORKERS_BASE_URL}/scripts/${calculateWorkerNameNew(userData.uuid, workerId)}/`, "DELETE")).json();

}

module.exports = {
    createWorker,
    deleteWorker,
    getWorker,
    setCloudflareKeys
};
