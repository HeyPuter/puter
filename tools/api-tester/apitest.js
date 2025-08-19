const YAML = require('yaml');

const TestSDK = require('./lib/TestSDK');
const log_error = require('./lib/log_error');
const TestRegistry = require('./lib/TestRegistry');

const fs = require('node:fs');
const { parseArgs } = require('node:util');

const args = process.argv.slice(2);

let config, report, suiteName, onlycase, bench, unit, stopOnFailure, id;

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
            suite: { type: 'string' },
            'stop-on-failure': { type: 'boolean' },
        },
        allowPositionals: true,
    });

    ({ values: {
        config,
        report,
        onlycase,
        bench,
        unit,
        suite: suiteName,
        'stop-on-failure': stopOnFailure,
    }, positionals: [id] } = parsed);

    onlycase = onlycase !== undefined ? Number.parseInt(onlycase) : undefined;
    // Ensure suiteName is a string or undefined
    suiteName = suiteName || undefined;
} catch (e) {
    console.error(e);
    console.error(
        'Usage: apitest [OPTIONS]\n' +
        '\n' +
        'Options:\n' +
        '  --config=<path>  (required)  Path to configuration file\n' +
        '  --report=<path>  (optional)  Output file for full test results\n' +
        '  --suite=<name>   (optional)  Run only tests with matching suite name\n' +
        '  --stop-on-failure (optional)  Stop execution on first test failure\n' +
        ''
    );
    process.exit(1);
}

const conf = YAML.parse(fs.readFileSync(config).toString());


const main = async () => {
    const results = [];
    for (const mountpoint of conf.mountpoints) {
        const result = await test({ mountpoint });
        results.push(...result);
    }

    let tbl = {};
    for ( const result of results ) {
        tbl[result.name + ' - ' + result.settings] = {
            passed: result.caseCount - result.failCount,
            failed: result.failCount,
            total: result.caseCount,
            'duration (s)': result.duration ? result.duration.toFixed(2) : 'N/A',
        }
    }

    // hard-coded identifier for ci script
    console.log("==================== nightly build results begin ====================")

    console.table(tbl);

    // hard-coded identifier for ci script
    console.log("==================== nightly build results end ====================")
}

/**
 * Run test using the given config, and return the test results
 * 
 * @param {Object} options
 * @param {Object} options.mountpoint
 * @returns {Promise<Object>}
 */
async function test({ mountpoint }) {
    const context = {
        mountpoint
    };

    const ts = new TestSDK(conf, context, { stopOnFailure });
    await ts.init_working_directory();

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
        await registry.run_all_tests(suiteName);
    } else if ( bench ) {
        await registry.run_all_benches();
    } else {
        await registry.run_all();
    }

    const all = unit && bench;
    if ( all || unit ) ts.printTestResults();
    if ( all || bench ) ts.printBenchmarkResults();

    return ts.packageResults;
}

const main_e = async () => {
    try {
        await main();
    } catch (e) {
        log_error(e);
    }
}

main_e();
