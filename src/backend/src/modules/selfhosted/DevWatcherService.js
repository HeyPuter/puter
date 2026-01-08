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
const { webpack, web } = require('webpack');
const BaseService = require('../../services/BaseService');

const path_ = require('node:path');
const fs = require('node:fs');

class ProxyLogger {
    constructor (log) {
        this.log = log;
    }
    attach (stream) {
        let buffer = '';
        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            let lineEndIndex = buffer.indexOf('\n');
            while ( lineEndIndex !== -1 ) {
                const line = buffer.substring(0, lineEndIndex);
                this.log(line);
                buffer = buffer.substring(lineEndIndex + 1);
                lineEndIndex = buffer.indexOf('\n');
            }
        });

        stream.on('end', () => {
            if ( buffer.length ) {
                this.log(buffer);
            }
        });
    }
}

/**
 * @description
 * This service is used to run webpack watchers.
 */
class DevWatcherService extends BaseService {
    static MODULES = {
        path: require('path'),
        spawn: require('child_process').spawn,
    };

    async _init (args) {
        this.args = args;
    }

    // Oh geez we need to wait for the web server to initialize
    // so that `config.origin` has the actual port in it if the
    // port is set to `auto` - you have no idea how confusing
    // this was to debug the first time, like Ahhhhhh!!
    // but hey at least we have this convenient event listener.
    async ['__on_ready.webserver'] () {
        const svc_process = this.services.get('process');

        let { root, commands, webpack } = this.args;
        if ( ! webpack ) webpack = [];

        let promises = [];
        for ( const entry of commands ) {
            const { directory } = entry;
            const fullpath = this.modules.path.join(root, directory);
            // promises.push(this.start_({ ...entry, fullpath }));
            promises.push(svc_process.start({ ...entry, fullpath }));
        }
        for ( const entry of webpack ) {
            const p = this.start_a_webpack_watcher_(entry);
            promises.push(p);
        }
        await Promise.all(promises);

        // It's difficult to tell when webpack is "done" its first
        // run so we just wait a bit before we say we're ready.
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    async get_configjs ({ directory, configIsFor, possibleConfigNames }) {
        let configjsPath, moduleType;

        for ( const [configName, supposedModuleType] of possibleConfigNames ) {
            // There isn't really an async fs.exists() funciton. I assume this
            // is because 'exists' is already a very fast operation.
            const supposedPath = path_.join(this.args.root, directory, configName);
            if ( fs.existsSync(supposedPath) ) {
                configjsPath = supposedPath;
                moduleType = supposedModuleType;
                break;
            }
        }

        if ( ! configjsPath ) {
            throw new Error(`could not find ${configIsFor} config for: ${directory}`);
        }

        // If the webpack config ends with .js it could be an ES6 module or a
        // CJS module, so the absolute safest thing to do so as not to completely
        // break in specific patch version of supported versions of node.js is
        // to read the package.json and see what it says is the import mechanism.
        if ( moduleType === 'package.json' ) {
            const packageJSONPath = path_.join(this.args.root, directory, 'package.json');
            const packageJSONObject = JSON.parse(fs.readFileSync(packageJSONPath));
            moduleType = packageJSONObject?.type ?? 'module';
        }

        return {
            configjsPath,
            moduleType,
        };
    }

    async start_a_webpack_watcher_ (entry) {
        const possibleConfigNames = [
            ['webpack.config.js', 'package.json'],
            ['webpack.config.cjs', 'commonjs'],
            ['webpack.config.mjs', 'module'],
        ];

        const {
            configjsPath: webpackConfigPath,
            moduleType,
        } = await this.get_configjs({
            directory: entry.directory,
            configIsFor: 'webpack', // for error message
            possibleConfigNames,
        });

        let oldEnv;

        if ( entry.env ) {
            oldEnv = process.env;
            const newEnv = Object.create(process.env);
            let global_config = null;
            try {
                const svc_config = this.services.get('config');
                global_config = svc_config ? svc_config.get('global_config') : null;
            } catch (e) {
                // Config service not available yet, will use null
            }

            for ( const k in entry.env ) {
                const envValue = entry.env[k];
                // If it's a function, call it with the config, otherwise use the value directly
                if ( typeof envValue === 'function' ) {
                    try {
                        const result = envValue({ global_config: global_config });
                        // Only set the env var if we got a non-empty result
                        // This allows the webpack config to use its fallback values
                        if ( result ) {
                            newEnv[k] = result;
                        }
                    } catch (e) {
                        // If config is not available yet, don't set the env var
                        // This allows the webpack config to use its fallback values from config files
                        // Only log if it's not a null/undefined access error (which is expected)
                        if ( !e.message.includes('Cannot read properties of null') &&
                            !e.message.includes('Cannot read properties of undefined') ) {
                            this.log.warn(`Could not evaluate env function for ${k}: ${e.message}`);
                        }
                    }
                } else {
                    newEnv[k] = envValue;
                }
            }
            process.env = newEnv; // Yep, it totally lets us do this
        }
        let webpackConfig = moduleType === 'module'
            ? (await import(webpackConfigPath)).default
            : require(webpackConfigPath);

        // The webpack config can sometimes be a function
        if ( typeof webpackConfig === 'function' ) {
            webpackConfig = await webpackConfig();
        }

        if ( oldEnv ) process.env = oldEnv;

        webpackConfig.context = webpackConfig.context
            ? path_.resolve(path_.join(this.args.root, entry.directory), webpackConfig.context)
            : path_.join(this.args.root, entry.directory);

        if ( entry.onConfig ) entry.onConfig(webpackConfig);

        const webpacker = webpack(webpackConfig);

        let errorAfterLastEnd = false;
        let firstEvent = true;
        webpacker.watch({}, (err, stats) => {
            let hideSuccess = false;
            if ( firstEvent ) {
                firstEvent = false;
                hideSuccess = true;
            }
            if ( err || stats.hasErrors() ) {
                // Extract error information without serializing the entire stats object
                const errorInfo = {
                    err: err ? err.message : null,
                    errors: stats.compilation?.errors?.map(e => e.message) || [],
                    warnings: stats.compilation?.warnings?.map(w => w.message) || [],
                };
                this.log.error(`error information: ${entry.directory} using Webpack`, errorInfo);
                this.log.error(`❌ failed to update ${entry.directory} using Webpack`);
            } else {
                // Normally success messages aren't important, but sometimes it takes
                // a little bit for the bundle to update so a developer probably would
                // like to have a visual indication in the console when it happens.
                if ( ! hideSuccess ) {
                    this.log.info(`✅ updated ${entry.directory} using Webpack`);
                }
            }
        });
    }
};

module.exports = DevWatcherService;
