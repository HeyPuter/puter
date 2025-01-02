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
const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");

class SelfHostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { SelfhostedService } = require('./SelfhostedService');
        services.registerService('__selfhosted', SelfhostedService);

        const DefaultUserService = require('./DefaultUserService');
        services.registerService('__default-user', DefaultUserService);

        const ComplainAboutVersionsService = require('./ComplainAboutVersionsService');
        services.registerService('complain-about-versions', ComplainAboutVersionsService);

        const DevWatcherService = require('./DevWatcherService');
        const path_ = require('path');
        
        const { DBKVService } = require("../../services/DBKVService");
        services.registerService('puter-kvstore', DBKVService);

        // TODO: sucks
        const RELATIVE_PATH = '../../../../../';

        if ( ! config.no_devwatch )
        services.registerService('__dev-watcher', DevWatcherService, {
            root: path_.resolve(__dirname, RELATIVE_PATH),
            commands: [
                {
                    name: 'puter.js:webpack-watch',
                    directory: 'src/puter-js',
                    command: 'npm',
                    args: ['run', 'start-webpack'],
                    env: {
                        PUTER_ORIGIN: ({ global_config: config }) => config.origin,
                        PUTER_API_ORIGIN: ({ global_config: config }) => config.api_base_url,
                    },
                },
                {
                    name: 'gui:webpack-watch',
                    directory: 'src/gui',
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
                {
                    name: 'emulator:webpack-watch',
                    directory: 'src/emulator',
                    command: 'npm',
                    args: ['run', 'start-webpack'],
                },
            ],
        });

        const { ServeStaticFilesService } = require("./ServeStaticFilesService");
        services.registerService('__serve-puterjs', ServeStaticFilesService, {
            directories: [
                {
                    prefix: '/sdk',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/puter-js/dist'),
                },
                {
                    prefix: '/builtin/terminal',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/terminal/dist'),
                },
                {
                    prefix: '/builtin/phoenix',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/phoenix/dist'),
                },
                {
                    prefix: '/builtin/git',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/git/dist'),
                },
                {
                    prefix: '/builtin/dev-center',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/dev-center'),
                },
                {
                    prefix: '/builtin/dev-center',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/dev-center'),
                },
                {
                    prefix: '/builtin/emulator/image',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/emulator/image'),
                },
                {
                    prefix: '/builtin/emulator',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'src/emulator/dist'),
                },
                {
                    prefix: '/vendor/v86/bios',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'submodules/v86/bios'),
                },
                {
                    prefix: '/vendor/v86',
                    path: path_.resolve(__dirname, RELATIVE_PATH, 'submodules/v86/build'),
                },
            ],
        });
        
        const { ServeSingleFileService } = require('./ServeSingeFileService');
        services.registerService('__serve-puterjs-new', ServeSingleFileService, {
            path: path_.resolve(__dirname,
                RELATIVE_PATH,
                'src/puter-js/dist/puter.dev.js'),
            route: '/puter.js/v2',
        });
        services.registerService('__serve-putilityjs-new', ServeSingleFileService, {
            path: path_.resolve(__dirname,
                RELATIVE_PATH,
                'src/putility/dist/putility.dev.js'),
            route: '/putility.js/v1',
        });
        services.registerService('__serve-gui-js', ServeSingleFileService, {
            path: path_.resolve(__dirname,
                RELATIVE_PATH,
                'src/gui/dist/gui.dev.js'),
            route: '/putility.js/v1',
        });
    }
}

module.exports = SelfHostedModule;
