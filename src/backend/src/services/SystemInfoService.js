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

const BaseService = require('./BaseService');
const os = require('os');
const { Endpoint } = require('../util/expressutil');
const configurable_auth = require('../middleware/configurable_auth');

class SystemInfoService extends BaseService {
    static MODULES = {
        fs: require('fs'),
        child_process: require('child_process'),
    };

    async _init () {
        this.start_time = Date.now();
    }

    /**
     * Installs routes for the system info service
     * @param {*} _ Unused parameter
     * @param {Object} param1 Object containing Express app instance
     * @param {Express} param1.app Express application instance
     * @private
     */
    ['__on_install.routes'] (_, { app }) {
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        app.use('/', router);

        Endpoint({
            route: '/system-info/get',
            methods: ['GET', 'POST'],
            mw: [
                configurable_auth(),
            ],
            handler: async (req, res) => {
                // Determine OS Info
                let os_info = {
                    platform: os.platform(),
                    release: os.release(),
                    type: os.type(),
                    arch: os.arch(),
                };

                // Try to get distro info on Linux
                if ( os.platform() === 'linux' ) {
                    try {
                        const os_release = await this.modules.fs.promises.readFile('/etc/os-release', 'utf8');
                        const lines = os_release.split('\n');
                        for ( const line of lines ) {
                            if ( line.startsWith('PRETTY_NAME=') ) {
                                os_info.distro = line.split('=')[1].replace(/"/g, '');
                                break;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                const cpus = os.cpus();
                const cpu_model = cpus.length > 0 ? cpus[0].model : 'Unknown';
                const cpu_cores = cpus.length;

                // Basic memory stats (bytes)
                const total_mem = os.totalmem();
                const free_mem = os.freemem();

                const uptime = os.uptime(); // seconds

                res.json({
                    os: os_info,
                    cpu: {
                        model: cpu_model,
                        cores: cpu_cores,
                    },
                    memory: {
                        total: total_mem,
                        free: free_mem,
                    },
                    uptime: uptime,
                    server_time: Date.now(),
                });
            },
        }).attach(router);
    }
}

module.exports = { SystemInfoService };
