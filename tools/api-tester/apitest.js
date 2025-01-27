const YAML = require('yaml');

const TestSDK = require('./lib/TestSDK');
const log_error = require('./lib/log_error');
const TestRegistry = require('./lib/TestRegistry');

const fs = require('node:fs');
const { parseArgs } = require('node:util');

const args = process.argv.slice(2);

let config, report;

try {
    const parsed = parseArgs({
        options: {
            config: {
                type: 'string',
            },
            report: {
                type: 'string',
            },
            onlycase: { type: 'string' },
            bench: { type: 'boolean' },
            unit: { type: 'boolean' },
        },
        allowPositionals: true,
    });

    ({ values: {
        config,
        report,
        onlycase,
        bench,
        unit,
    }, positionals: [id] } = parsed);

    onlycase = onlycase !== undefined ? Number.parseInt(onlycase) : undefined;
} catch (e) {
    console.error(e);
    console.error(
        'Usage: apitest [OPTIONS]\n' +
        '\n' +
        'Options:\n' +
        '  --config=<path>  (required)  Path to configuration file\n' +
        '  --report=<path>  (optional)  Output file for full test results\n' +
        ''
    );
    process.exit(1);
}

const conf = YAML.parse(fs.readFileSync(config).toString());


const main = async () => {
    const context = {
        options: {
            onlycase,
        }
    };
    const ts = new TestSDK(conf, context);
    try {
        await ts.delete('api_test', { recursive: true });
    } catch (e) {
    }
    await ts.mkdir('api_test', { overwrite: true });
    ts.cd('api_test');

    const registry = new TestRegistry(ts);

    registry.add_test_sdk('puter-rest.v1', require('./test_sdks/puter-rest')({
        config: conf,
    }));

    require('./tests/__entry__.js')(registry);
    require('./benches/simple.js')(registry);

    if ( id ) {
        if ( unit ) {
            await registry.run_test(id);
        } else if ( bench ) {
            await registry.run_bench(id);
        } else {
            await registry.run(id);
        }
        return;
    }

    if ( unit ) {
        await registry.run_all_tests();
    } else if ( bench ) {
        await registry.run_all_benches();
    } else {
        await registry.run_all();
    }


    // await ts.runTestPackage(require('./tests/write_cart'));
    // await ts.runTestPackage(require('./tests/move_cart'));
    // await ts.runTestPackage(require('./tests/copy_cart'));
    // await ts.runTestPackage(require('./tests/write_and_read'));
    // await ts.runTestPackage(require('./tests/move'));
    // await ts.runTestPackage(require('./tests/stat'));
    // await ts.runTestPackage(require('./tests/readdir'));
    // await ts.runTestPackage(require('./tests/mkdir'));
    // await ts.runTestPackage(require('./tests/batch'));
    // await ts.runTestPackage(require('./tests/delete'));
    const all = unit && bench;
    if ( all || unit ) ts.printTestResults();
    if ( all || bench ) ts.printBenchmarkResults();
}

const main_e = async () => {
    try {
        await main();
    } catch (e) {
        log_error(e);
    }
}

main_e();
