/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const configurable_auth = require("../../middleware/configurable_auth");
const { Endpoint } = require("../../util/expressutil");
const BaseService = require("../BaseService");
const fs = require("node:fs");

const { createWorker, setCloudflareKeys, deleteWorker } = require("./workerUtils/cloudflareDeploy");
const { getUserInfo } = require("./workerUtils/puterUtils");

const preamble = fs.readFileSync("../../src/backend/src/services/worker/res/workerPreamble.js", "utf-8");
const PREAMBLE_LENGTH = preamble.split("\n").length - 1

class WorkerService extends BaseService {
    ['__on_install.routes'](_, { app }) {
        const r_workers = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        setCloudflareKeys(this.config);

        app.use('/workers', r_workers);

        Endpoint({
            route: '/:operation/:workerId',
            methods: ['PUT'],
            mw: [configurable_auth({ optional: true })],
            handler: async (req, response) => {
                const { operation, workerId } = req.params;
                const authorization = req.headers.authorization;
                if (!authorization)
                    throw response.status(403) && response.send("No authorization");

                // Validate token and get data about user
                const userData = req.actor.type.user;

                if (!userData)
                    return;
                req.body = await new Promise((res, rej) => {
                    const chunks = [];
                    req.on("data", (data) => {
                        chunks.push(data);
                    });
                    req.on("end", () => {
                        res(Buffer.concat(chunks).toString("utf8"));
                    });
                    req.on("error", (e) => {
                        rej(e);
                    })
                });
                // console.log(req.body)
                let responseFromAPI;

                switch (operation) {
                    case "create":
                        responseFromAPI = await createWorker(userData, authorization, workerId, preamble + req.body, PREAMBLE_LENGTH);
                        break;
                    default:
                        throw response.status(400) && response.send("Invalid worker operation " + JSON.stringify(req.params));
                }
                response.send(responseFromAPI);
            }
        }).attach(r_workers);

    }
    static IMPLEMENTS = {
        ['workers']: {
            async create({ fileData, workerName, authorization }) {
                try {
                    const userData = await getUserInfo(authorization);
                    return await createWorker(userData, authorization, workerName, preamble + fileData, PREAMBLE_LENGTH);
                } catch (e) {
                    return {success: false, e}
                }
            },
            async destroy({ workerName, authorization }) {
                try {
                    const userData = await getUserInfo(authorization);
                    return await deleteWorker(userData, authorization, workerName);
                } catch (e) {
                    return {success: false, e}
                }
            },
            async startLogs({ workerName, authorization }) {
                return await this.exec_({ runtime, code });
            },
            async endLogs({ workerName, authorization }) {
                return await this.exec_({ runtime, code });
            },
        }
    }
    async ['__on_driver.register.interfaces']() {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');

        col_interfaces.set('workers', {
            description: 'Execute code with various languages.',
            methods: {
                create: {
                    description: 'Create a backend worker',
                    parameters: {
                        fileData: {
                            type: "string",
                            description: "The code of the worker to upload"
                        },
                        workerName: {
                            type: "string",
                            description: "The name of the worker you want to upload"
                        },
                        authorization: {
                            type: "string",
                            description: "Puter token"
                        }
                    },
                    result: { type: 'json' },
                },
                startLogs: {
                    description: 'Get logs for your backend worker',
                    parameters: {
                        workerName: {
                            type: "string",
                            description: "The name of the worker you want the logs of"
                        },
                        authorization: {
                            type: "string",
                            description: "Puter token"
                        }
                    },
                    result: { type: 'json' },
                },
                endLogs: {
                    description: 'Get logs for your backend worker',
                    parameters: {
                        workerName: {
                            type: "string",
                            description: "The name of the worker you want the logs of"
                        },
                        authorization: {
                            type: "string",
                            description: "Puter token"
                        }
                    },
                    result: { type: 'json' },
                },
                destroy: {
                    description: 'Get rid of your backend worker',
                    parameters: {
                        workerName: {
                            type: "string",
                            description: "The name of the worker you want to destroy"
                        },
                        authorization: {
                            type: "string",
                            description: "Puter token"
                        }
                    },
                    result: { type: 'json' },
                },
            }
        });
    }
}

module.exports = {
    WorkerService,
};
