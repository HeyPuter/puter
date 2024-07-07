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
const { Context } = require('./util/context');
const BaseService = require("./services/BaseService");
const useapi = require('useapi');

class Kernel extends AdvancedBase {
    constructor ({ entry_path } = {}) {
        super();

        this.modules = [];
        this.useapi = useapi();

        this.useapi.withuse(() => {
            def('Module', AdvancedBase);
            def('Service', BaseService);
        });

        this.entry_path = entry_path;
    }

    add_module (module) {
        this.modules.push(module);
    }

    _runtime_init (boot_parameters) {
        const kvjs = require('@heyputer/kv.js');
        const kv = new kvjs();
        global.kv = kv;
        global.cl = console.log;
        
        const { RuntimeEnvironment } = require('./boot/RuntimeEnvironment');
        const { BootLogger } = require('./boot/BootLogger');

        // Temporary logger for boot process;
        // LoggerService will be initialized in app.js
        const bootLogger = new BootLogger();
        this.bootLogger = bootLogger;

        // Determine config and runtime locations
        const runtimeEnv = new RuntimeEnvironment({
            entry_path: this.entry_path,
            logger: bootLogger,
        });
        const environment = runtimeEnv.init();
        this.environment = environment;

        // polyfills
        require('./polyfill/to-string-higher-radix');
    }

    boot () {
        this._runtime_init();

        // const express = require('express')
        // const app = express();
        const config = require('./config');

        globalThis.ll = () => {};
        globalThis.xtra_log = () => {};
        if ( config.env === 'dev' ) {
            globalThis.ll = o => {
                console.log('debug: ' + require('node:util').inspect(o));
                return o;
            };
            globalThis.xtra_log = (...args) => {
                // append to file in temp
                const fs = require('fs');
                const path = require('path');
                const log_path = path.join('/tmp/xtra_log.txt');
                fs.appendFileSync(log_path, args.join(' ') + '\n');
            }
        }

        const { consoleLogManager } = require('./util/consolelog');
        consoleLogManager.initialize_proxy_methods();

        // TODO: temporary dependency inversion; requires moving:
        //   - rm, so we can move mv
        //   - mv, so we can move mkdir
        //   - generate_default_fsentries, so we can move mkdir
        //   - mkdir, which needs an fs provider

        // === START: Initialize Service Registry ===
        const { Container } = require('./services/Container');

        const services = new Container({ logger: this.bootLogger });
        this.services = services;
        // app.set('services', services);

        const root_context = Context.create({
            environment: this.environment,
            useapi: this.useapi,
            services,
            config,
            logger: this.bootLogger,
        }, 'app');
        globalThis.root_context = root_context;

        root_context.arun(async () => {
            await this._install_modules();
            await this._boot_services();
        });


        // Error.stackTraceLimit = Infinity;
        Error.stackTraceLimit = 200;
    }

    async _install_modules () {
        const { services } = this;

        // Internal modules
        for ( const module of this.modules ) {
            await module.install(Context.get());
        }

        // External modules
        await this.install_extern_mods_();

        try {
            await services.init();
        } catch (e) {
            // First we'll try to mark the system as invalid via
            // SystemValidationService. This might fail because this service
            // may not be initialized yet.

            const svc_systemValidation = (() => {
                try {
                    return services.get('system-validation');
                } catch (e) {
                    return null;
                }
            })();

            if ( ! svc_systemValidation ) {
                // If we can't mark the system as invalid, we'll just have to
                // throw the error and let the server crash.
                throw e;
            }

            await svc_systemValidation.mark_invalid(
                'failed to initialize services',
                e,
            );
        }

        for ( const module of this.modules ) {
            await module.install_legacy?.(Context.get());
        }

        services.ready.resolve();
        // provide services to helpers

        const { tmp_provide_services } = require('./helpers');
        tmp_provide_services(services);
    }

    async _boot_services () {
        const { services } = this;

        await services.ready;
        await services.emit('boot.consolidation');

        // === END: Initialize Service Registry ===

        // self check
        (async () => {
            await services.ready;
            globalThis.services = services;
            const log = services.get('log-service').create('init');
            log.info('services ready');

            log.system('server ready', {
                deployment_type: globalThis.deployment_type,
            });
        })();

        await services.emit('boot.activation');
        await services.emit('boot.ready');
    }

    async install_extern_mods_ () {
        const path_ = require('path');
        const fs = require('fs');

        const mod_paths = this.environment.mod_paths;
        for ( const mods_dirpath of mod_paths ) {
            const mod_dirnames = fs.readdirSync(mods_dirpath);
            for ( const mod_dirname of mod_dirnames ) {
                const mod_path = path_.join(mods_dirpath, mod_dirname);

                const stat = fs.statSync(mod_path);
                if ( ! stat.isDirectory() ) {
                    continue;
                }

                const mod_class = this.useapi.withuse(() => require(mod_path));
                const mod = new mod_class();
                if ( ! mod ) {
                    continue;
                }

                if ( mod.install ) {
                    this.useapi.awithuse(async () => {
                        await mod.install(Context.get());
                    });
                }
            }
        }
    }
}

module.exports = { Kernel };
