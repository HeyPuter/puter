const { AdvancedBase } = require("@heyputer/puter-js-common");
const CoreModule = require("../src/CoreModule");
const { Context } = require("../src/util/context");

class TestKernel extends AdvancedBase {
    constructor () {
        super();

        this.modules = [];

        this.logfn_ = (...a) => a;
    }

    add_module (module) {
        this.modules.push(module);
    }

    boot () {
        const { consoleLogManager } = require('../src/util/consolelog');
        consoleLogManager.initialize_proxy_methods();

        consoleLogManager.decorate_all(({ manager, replace }, ...a) => {
            replace(...this.logfn_(...a));
        });

        const { Container } = require('../src/services/Container');

        const services = new Container();
        this.services = services;
        // app.set('services', services);

        const root_context = Context.create({
            services,
        }, 'app');
        globalThis.root_context = root_context;

        root_context.arun(async () => {
            await this._install_modules();
            // await this._boot_services();
        });

        // Error.stackTraceLimit = Infinity;
        Error.stackTraceLimit = 200;
    }

    async _install_modules () {
        const { services } = this;

        for ( const module of this.modules ) {
            await module.install(Context.get());
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

const k = new TestKernel();
k.add_module(new CoreModule());
k.boot();

const do_after_tests_ = [];

// const do_after_tests = (fn) => {
//     do_after_tests_.push(fn);
// };
const repeat_after = (fn) => {
    fn();
    do_after_tests_.push(fn);
};

let total_passed = 0;
let total_failed = 0;

for ( const name in k.services.instances_ ) {
    console.log('name', name)
    const ins = k.services.instances_[name];
    ins.construct();
    if ( ! ins._test || typeof ins._test !== 'function' ) {
        continue;
    }
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
        }
    };

    ins._test(testapi);

    total_passed += passed;
    total_failed += failed;
}

console.log(`\x1B[36;1m<===\x1B[0m ` +
    'ASSERTION OUTPUTS ARE REPEATED BELOW' +
    ` \x1B[36;1m===>\x1B[0m`);

for ( const fn of do_after_tests_ ) {
    fn();
}

console.log(`\x1B[36;1m=== [ Summary ] ===\x1B[0m`);
console.log(`Passed: ${total_passed}`);
console.log(`Failed: ${total_failed}`);
