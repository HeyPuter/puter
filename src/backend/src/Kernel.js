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
const { AdvancedBase, libs } = require("@heyputer/putility");
const { Context } = require('./util/context');
const BaseService = require("./services/BaseService");
const useapi = require('useapi');
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers');
const { Extension } = require("./Extension");
const { ExtensionModule } = require("./ExtensionModule");
const { spawn } = require("node:child_process");

const fs = require('fs');
const path_ = require('path');
const { prependToJSFiles } = require("./kernel/modutil");

const uuid = require('uuid');
const readline = require("node:readline/promises");

const { quot } = libs.string;

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
        this.extensionExports = {};
        this.registry = {};
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
            boot_parameters,
        });
        const environment = runtimeEnv.init();
        this.environment = environment;

        // polyfills
        require('./polyfill/to-string-higher-radix');
    }

    boot () {
        const args = yargs(hideBin(process.argv)).argv

        this._runtime_init({ args });

        const config = require('./config');

        globalThis.ll = o => o;
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

        // === START: Initialize Service Registry ===
        const { Container } = require('./services/Container');

        const services = new Container({ logger: this.bootLogger });
        this.services = services;

        const root_context = Context.create({
            environment: this.environment,
            useapi: this.useapi,
            services,
            config,
            logger: this.bootLogger,
            extensionExports: this.extensionExports,
            registry: this.registry,
            args,
        }, 'app');
        globalThis.root_context = root_context;

        root_context.arun(async () => {
            await this._install_modules();
            await this._boot_services();
        });


        Error.stackTraceLimit = 200;
    }

    async _install_modules () {
        const { services } = this;

        // Internal modules
        for ( const module_ of this.modules ) {
            services.registerModule(module_.constructor.name, module_);
            const mod_context = this._create_mod_context(Context.get(), {
                name: module_.constructor.name,
                ['module']: module_,
                external: false,
            });
            await module_.install(mod_context);
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
        
        // In runtime directory, we'll create a `mod_packages` directory.`
        if ( fs.existsSync('mod_packages') ) {
            fs.rmSync('mod_packages', { recursive: true, force: true });
        }
        fs.mkdirSync('mod_packages');
        
        // Initialize some globals that external mods depend on
        globalThis.__puter_extension_globals__ = {
            extensionObjectRegistry: {},
            useapi: this.useapi,
            global_config: require('./config'),
        };
        
        // Install the mods...
        
        const mod_install_root_context = Context.get();
        
        const mod_directory_promises = [];
        const mod_installation_promises = [];

        const mod_paths = this.environment.mod_paths;
        for ( const mods_dirpath of mod_paths ) {
            const p = (async () => {
                if ( ! fs.existsSync(mods_dirpath) ) {
                    this.services.logger.error(
                        `mod directory not found: ${quot(mods_dirpath)}; skipping...`
                    );
                    // intentional delay so error is seen
                    this.services.logger.info('boot will continue in 4 seconds');
                    await new Promise(rslv => setTimeout(rslv, 4000));
                    return;
                }
                const mod_dirnames = await fs.promises.readdir(mods_dirpath);
                for ( const mod_dirname of mod_dirnames ) {
                    mod_installation_promises.push(this.install_extern_mod_({
                        mod_install_root_context,
                        mod_dirname,
                        mod_path: path_.join(mods_dirpath, mod_dirname),
                    }));
                }
            })();
            if ( process.env.SYNC_MOD_INSTALL ) await p;
            mod_directory_promises.push(p);
        }
        
        await Promise.all(mod_directory_promises);
        
        const mods_to_run = (await Promise.all(mod_installation_promises))
            .filter(v => v !== undefined);
        mods_to_run.sort((a, b) => a.priority - b.priority);
        let i = 0;
        while (i < mods_to_run.length) {
            const currentPriority = mods_to_run[i].priority;
            const samePriorityMods = [];
            
            // Collect all mods with the same priority
            while (i < mods_to_run.length && mods_to_run[i].priority === currentPriority) {
                samePriorityMods.push(mods_to_run[i]);
                i++;
            }
            
            // Run all mods with the same priority concurrently
            await Promise.all(samePriorityMods.map(mod => {
                this._run_extern_mod({ mod });
            }));
        }
    }
        
    async install_extern_mod_({
        mod_install_root_context,
        mod_dirname,
        mod_path,
    }) {
        let stat = fs.lstatSync(mod_path);
        while ( stat.isSymbolicLink() ) {
            mod_path = fs.readlinkSync(mod_path);
            stat = fs.lstatSync(mod_path);
        }

        // Mod must be a directory or javascript file
        if ( ! stat.isDirectory() && !(mod_path.endsWith('.js')) ) {
            return;
        }
        
        const mod_name = path_.parse(mod_path).name;
        const mod_package_dir = `mod_packages/${mod_name}`;
        fs.mkdirSync(mod_package_dir);
        
        let priority = 0;

        if ( ! stat.isDirectory() ) {
            await this.create_mod_package_json(mod_package_dir, {
                name: mod_name,
                entry: 'main.js'
            });
            await Promise.all([
                fs.promises.copyFile(mod_path, path_.join(mod_package_dir, 'main.js')),
                (async () => {
                    const rl = readline.createInterface({
                        input: fs.createReadStream(mod_path),
                    });
                    for await ( const line of rl ) {
                        if ( line.trim() === '' ) continue;
                        if ( ! line.startsWith('//@puter') ) break;
                        const tokens = line.split(' ');
                        if ( tokens[1] === 'priority' ) {
                            priority = Number(tokens[2]);
                        }
                    }
                })(),
            ]);
        } else {
            // If directory is empty, we'll just skip it
            if ( fs.readdirSync(mod_path).length === 0 ) {
                this.bootLogger.warn(`Empty mod directory ${quot(mod_path)}; skipping...`);
                return;
            }
            
            const promises = [];

            // Create package.json if it doesn't exist
            if ( ! fs.existsSync(path_.join(mod_path, 'package.json')) ) {
                promises.push(this.create_mod_package_json(mod_package_dir, {
                    name: mod_name,
                }));
            }
            
            const puter_json_path = path_.join(mod_path, 'puter.json');
            if ( fs.existsSync(puter_json_path) ) {
                promises.push((async () => {
                    const buffer = await fs.promises.readFile(puter_json_path);
                    const json = buffer.toString();
                    const obj = JSON.parse(json);
                    priority = obj.priority;
                })());
            }
            
            // Copy mod contents to `/mod_packages`
            promises.push(fs.promises.cp(mod_path, mod_package_dir, {
                recursive: true,
            }));
            
            await Promise.all(promises);
        }
        
        const extension_id = uuid.v4();
        
        await prependToJSFiles(mod_package_dir, [
            `const { use, def } = globalThis.__puter_extension_globals__.useapi;`,
            `const { use: puter } = globalThis.__puter_extension_globals__.useapi;`,
            `const extension = globalThis.__puter_extension_globals__` +
                `.extensionObjectRegistry[${JSON.stringify(extension_id)}];`,
            `const config = extension.config;`,
            `const registry = extension.registry;`,
            `const register = registry.register;`,
            `const global_config = globalThis.__puter_extension_globals__.global_config`,
        ].join('\n') + '\n');

        const mod_require_dir = path_.join(process.cwd(), mod_package_dir);
        
        await this.run_npm_install(mod_require_dir);
        
        const mod = new ExtensionModule();
        mod.extension = new Extension();
        mod.priority = priority;
        
        globalThis.__puter_extension_globals__.extensionObjectRegistry[extension_id]
            = mod.extension;

        mod.mod_require_dir = mod_require_dir;
        mod.mod_context = this._create_mod_context(mod_install_root_context, {
            name: mod_dirname,
            ['module']: mod,
            external: true,
            mod_path,
        });

        const mod_packageJSON_bin = await fs.promises.readFile(path_.join(mod_package_dir, 'package.json'));
        const mod_packageJSON_str = mod_packageJSON_bin.toString();
        mod.mod_packageJSON = JSON.parse(mod_packageJSON_str);
        
        return mod;
    };
    
    async _run_extern_mod({
        mod,
    }) {
        let exportObject = null;
        
        const {
            mod_packageJSON,
            mod_require_dir,
        } = mod;
        
        const maybe_promise = (typ => typ.trim().toLowerCase())(mod_packageJSON.type ?? '') === 'module'
            ? await import(path_.join(mod_require_dir, mod_packageJSON.main ?? 'index.js'))
            : require(mod_require_dir);

        if ( maybe_promise && maybe_promise instanceof Promise ) {
            exportObject = await maybe_promise;
        } else exportObject = maybe_promise;
        
        const extension_name = exportObject?.name ?? mod_packageJSON.name;
        this.extensionExports[extension_name] = exportObject;
        mod.extension.registry = this.registry;
        mod.extension.name = extension_name;
        
        if ( exportObject.construct ) {
            mod.extension.on('construct', exportObject.construct);
        }
        if ( exportObject.preinit ) {
            mod.extension.on('preinit', exportObject.preinit);
        }

        if ( exportObject.init ) {
            mod.extension.on('init', exportObject.init);
        }

        Object.defineProperty(mod.extension, 'config', {
            get: () => require('./config').services?.[extension_name] ?? {},
        });
        
        // This is where the 'install' event gets triggered
        await mod.install(mod.mod_context);
    }

    _create_mod_context (parent, options) {
        const modapi = {};

        let mod_path = options.mod_path;
        if ( ! mod_path && options.module.dirname ) {
            mod_path = options.module.dirname();
        }

        if ( mod_path ) {
            modapi.libdir = (prefix, directory) => {
                const fullpath = path_.join(mod_path, directory);
                const fsitems = fs.readdirSync(fullpath);
                for ( const item of fsitems ) {
                    if ( ! item.endsWith('.js') ) {
                        continue;
                    }
                    if ( item.endsWith('.test.js') ) {
                        continue;
                    }
                    const stat = fs.statSync(path_.join(fullpath, item));
                    if ( ! stat.isFile() ) {
                        continue;
                    }

                    const name = item.slice(0, -3);
                    const path = path_.join(fullpath, item);
                    let lib = require(path);

                    // TODO: This context can be made dynamic by adding a
                    // getter-like behavior to useapi.
                    this.useapi.def(`${prefix}.${name}`, lib);
                }
            }
        }
        const mod_context = parent.sub({ modapi }, `mod:${options.name}`);
        return mod_context;

    }
    
    async create_mod_package_json (mod_path, { name, entry }) {
        // Expect main.js or index.js to exist
        const options = ['main.js', 'index.js'];

        // If no entry specified, find file with conventional name
        if ( ! entry ) {
            for ( const option of options ) {
                if ( fs.existsSync(path_.join(mod_path, option)) ) {
                    entry = option;
                    break;
                }
            }
        }

        // If no entry specified or found, skip or error
        if ( ! entry ) {
            this.bootLogger.error(`Expected main.js or index.js in ${quot(mod_path)}`);
            if ( ! process.env.SKIP_INVALID_MODS ) {
                this.bootLogger.error(`Set SKIP_INVALID_MODS=1 (environment variable) to run anyway.`);
                process.exit(1);
            } else {
                return;
            }
        }

        const data = JSON.stringify({
            name,
            version: '1.0.0',
            main: entry ?? 'main.js',
        });
        
        console.log('WRITING TO', path_.join(mod_path, 'package.json'));
        
        await fs.promises.writeFile(path_.join(mod_path, 'package.json'), data);
    }
    
    async run_npm_install (path) {
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        const proc = spawn(npmCmd, ["install"], { cwd: path, shell: true, stdio: "inherit" });
        return new Promise((rslv, rjct) => {
            proc.on('close', code => {
                if ( code !== 0 ) {
                    throw new Error(`exit code: ${code}`);
                }
                rslv();
            });
            proc.on('error', err => {
                rjct(err);
            })
        })
    }
}

module.exports = { Kernel };
