// METADATA // {"ai-commented":{"service":"claude"}}
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
import { AdvancedBase } from '@heyputer/putility';
import useapi from 'useapi';
import why from '../exports.js';
import { RuntimeModuleRegistry } from '../src/extension/RuntimeModuleRegistry.js';
import { Kernel } from '../src/Kernel.js';
import { Core2Module } from '../src/modules/core/Core2Module.js';
import { Container } from '../src/services/Container.js';
import { HTTPThumbnailService } from '../src/services/thumbnails/HTTPThumbnailService.js';
import { consoleLogManager } from '../src/util/consolelog.js';
import { Context } from '../src/util/context.js';
const { BaseService, EssentialModules } = why;

/**
 * A simple implementation of the log interface for the test kernel.
 */
class TestLogger {
    constructor () {
        console.log('\x1B[36;1mBoot logger started :)\x1B[0m');
    }
    info (...args) {
        console.log('\x1B[36;1m[TESTKERNEL/INFO]\x1B[0m',
                        ...args);
    }
    error (...args) {
        console.log('\x1B[31;1m[TESTKERNEL/ERROR]\x1B[0m',
                        ...args);
    }
}

/**
* TestKernel class extends AdvancedBase to provide a testing environment for Puter services
* Implements a simplified version of the main Kernel for testing purposes, including:
* - Module management and installation
* - Service container initialization
* - Custom logging functionality
* - Context creation and management
* Does not include full service initialization or legacy service support
*/
export class TestKernel extends AdvancedBase {
    constructor () {
        super();

        this.modules = [];
        this.useapi = useapi();

        /**
        * Initializes the useapi instance for the test kernel.
        * Defines base Module and Service classes in the useapi context.
        * @returns {void}
        */
        this.useapi.withuse(() => {
            // eslint-disable-next-line no-undef
            def('Module', AdvancedBase);
            // eslint-disable-next-line no-undef
            def('Service', BaseService);
        });

        this.logfn_ = (...a) => a;

        this.runtimeModuleRegistry = new RuntimeModuleRegistry();
    }

    add_module (module) {
        this.modules.push(module);
    }

    /**
    * Adds a module to the test kernel's module list
    * @param {Module} module - The module instance to add
    * @description Stores the provided module in the kernel's internal modules array for later installation
    */
    boot () {
        consoleLogManager.initialize_proxy_methods();

        consoleLogManager.decorate_all(({ _manager, replace }, ...a) => {
            replace(...this.logfn_(...a));
        });

        this.testLogger = new TestLogger();

        const services = new Container({ logger: this.testLogger });
        this.services = services;
        // app.set('services', services);

        const root_context = Context.create({
            services,
            useapi: this.useapi,
            ['runtime-modules']: this.runtimeModuleRegistry,
        }, 'app');
        globalThis.root_context = root_context;

        root_context.arun(async () => {
            await this._install_modules();
            // await this._boot_services();
        });

        // Error.stackTraceLimit = Infinity;
        Error.stackTraceLimit = 200;
    }

    /**
    * Installs modules into the test kernel environment
    */
    async _install_modules () {
        const { services } = this;

        const mod_install_root_context = Context.get();

        for ( const module of this.modules ) {
            const mod_context = this._create_mod_context(mod_install_root_context,
                            {
                                name: module.constructor.name,
                                ['module']: module,
                                external: false,
                            });
            await module.install(mod_context);
        }

        // Real kernel initializes services here, but in this test kernel
        // we don't initialize any services.

        // Real kernel adds legacy services here but these will break
        // the test kernel.

        services.ready.resolve();

        // provide services to helpers
        // const { tmp_provide_services } = require('../src/helpers');
        // tmp_provide_services(services);
    }
}

TestKernel.prototype._create_mod_context =
    Kernel.prototype._create_mod_context;

const do_after_tests_ = [];

/**
* Executes a function immediately and adds it to the list of functions to be executed after tests
*
* This is used to log things inline with console output from tests, and then
* again later without those console outputs.
*
* @param {Function} fn - The function to execute and store for later
*/
const repeat_after = (fn) => {
    fn();
    do_after_tests_.push(fn);
};

let total_passed = 0;
let total_failed = 0;

/**
* Tracks test results across all services
* @type {number} total_passed - Count of all passed assertions
* @type {number} total_failed - Count of all failed assertions
*/
const main = async () => {
    const k = new TestKernel();
    for ( const mod of EssentialModules ) {
        k.add_module(new mod());
    }
    k.add_module({
        install: async (context) => {
            const services = context.get('services');
            services.registerService('thumbs-http', HTTPThumbnailService);
        },
    });
    k.boot();
    console.log('awaiting services ready');
    await k.services.ready;
    console.log('services have become ready');

    const service_names = process.argv.length > 2
        ? process.argv.slice(2)
        : Object.keys(k.services.instances_);

    for ( const name of service_names ) {
        if ( ! k.services.instances_[name] ) {
            console.log(`\x1B[31;1mService not found: ${name}\x1B[0m`);
            process.exit(1);
        }

        const ins = k.services.instances_[name];
        ins.construct();
        if ( !ins._test || typeof ins._test !== 'function' ) {
            continue;
        }
        ins.log = k.testLogger;
        let passed = 0;
        let failed = 0;

        repeat_after(() => {
            console.log(`\x1B[33;1m=== [ Service :: ${name} ] ===\x1B[0m`);
        });

        const testapi = {
            assert: (condition, name) => {
                name = name || condition.toString();
                if ( condition() ) {
                    passed++;
                    repeat_after(() => console.log(`\x1B[32;1m  ✔ ${name}\x1B[0m`));
                } else {
                    failed++;
                    repeat_after(() => console.log(`\x1B[31;1m  ✘ ${name}\x1B[0m`));
                }
            },
        };

        testapi.assert.equal = (a, b, name) => {
            name = name || `${a} === ${b}`;
            if ( a === b ) {
                passed++;
                repeat_after(() => console.log(`\x1B[32;1m  ✔ ${name}\x1B[0m`));
            } else {
                failed++;
                repeat_after(() => {
                    console.log(`\x1B[31;1m  ✘ ${name}\x1B[0m`);
                    console.log(`\x1B[31;1m    Expected: ${b}\x1B[0m`);
                    console.log(`\x1B[31;1m    Got: ${a}\x1B[0m`);
                });
            }
        };

        await ins._test(testapi);

        total_passed += passed;
        total_failed += failed;
    }

    console.log('\x1B[36;1m<===\x1B[0m ' +
        'ASSERTION OUTPUTS ARE REPEATED BELOW' +
        ' \x1B[36;1m===>\x1B[0m');

    for ( const fn of do_after_tests_ ) {
        fn();
    }

    console.log('\x1B[36;1m=== [ Summary ] ===\x1B[0m');
    console.log(`Passed: ${total_passed}`);
    console.log(`Failed: ${total_failed}`);

    process.exit(total_failed ? 1 : 0);
};

if ( import.meta.main ) {
    main();
}

export const createTestKernel = async ({
    serviceMap,
}) => {
    const testKernel = new TestKernel();
    testKernel.add_module(new Core2Module());
    for ( const [name, service] of Object.entries(serviceMap) ) {
        testKernel.add_module({
            install: context => {
                const services = context.get('services');
                services.registerService(name, service);
            },
        });
    }
    testKernel.boot();
    await testKernel.services.ready;
    return testKernel;
};
