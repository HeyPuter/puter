/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const config = require("./config");

class SelfHostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { SelfhostedService } = require('./services/SelfhostedService');
        services.registerService('__selfhosted', SelfhostedService);

        const DefaultUserService = require('./services/DefaultUserService');
        services.registerService('__default-user', DefaultUserService);

        const ComplainAboutVersionsService = require('./services/ComplainAboutVersionsService');
        services.registerService('complain-about-versions', ComplainAboutVersionsService);

        const DevWatcherService = require('./services/DevWatcherService');
        const path_ = require('path');
        services.registerService('__dev-watcher', DevWatcherService, {
            root: path_.resolve(__dirname, '../../../'),
            commands: [
                {
                    name: 'puter.js:webpack-watch',
                    directory: 'src/puter-js',
                    command: 'npm',
                    args: ['run', 'start-webpack'],
                },
                {
                    name: 'terminal:rollup-watch',
                    directory: 'src/terminal',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
                {
                    name: 'phoenix:rollup-watch',
                    directory: 'src/phoenix',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
                {
                    name: 'git:rollup-watch',
                    directory: 'src/git',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
            ],
        });

        const { ServeStaticFilesService } = require("./services/ServeStaticFilesService");
        services.registerService('__serve-puterjs', ServeStaticFilesService, {
            directories: [
                {
                    prefix: '/sdk',
                    path: path_.resolve(__dirname, '../../../src/puter-js/dist'),
                },
                {
                    prefix: '/builtin/terminal',
                    path: path_.resolve(__dirname, '../../../src/terminal/dist'),
                },
                {
                    prefix: '/builtin/phoenix',
                    path: path_.resolve(__dirname, '../../../src/phoenix/dist'),
                },
                {
                    prefix: '/builtin/git',
                    path: path_.resolve(__dirname, '../../../src/git/dist'),
                },
                {
                    prefix: '/builtin/dev-center',
                    path: path_.resolve(__dirname, '../../../src/dev-center'),
                },
            ],
        });
        
        const { ServeSingleFileService } = require('./services/ServeSingeFileService');
        services.registerService('__serve-puterjs-new', ServeSingleFileService, {
            path: path_.resolve(__dirname,
                '../../../src/puter-js/dist/puter.dev.js'),
            route: '/puter.js/v2',
        });
    }
}

module.exports = SelfHostedModule;
