const YAML = require('yaml');

const TestSDK = require('./lib/TestSDK');
const log_error = require('./lib/log_error');
const TestRegistry = require('./lib/TestRegistry');

const fs = require('node:fs');
const { parseArgs } = require('node:util');

const args = process.argv.slice(2);

let config, report, suiteName, onlycase, bench, unit, stopOnFailure, id, puterjs;

try {
    const parsed = parseArgs({
        options: {
            config: {
                type: 'string',
                default: './tests/client-config.yaml',
            },
            report: {
                type: 'string',
            },
            onlycase: { type: 'string' },
            bench: { type: 'boolean' },
            unit: { type: 'boolean' },
            suite: { type: 'string' },
            'stop-on-failure': { type: 'boolean' },
            puterjs: { type: 'boolean' },
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
        puterjs,
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
        '  --puterjs         (optional)  Run tests against the puter-js client\n' +
        '  --report=<path>  (optional)  Output file for full test results\n' +
        '  --suite=<name>   (optional)  Run only tests with matching suite name\n' +
        '  --stop-on-failure (optional)  Stop execution on first test failure\n' +
        ''
    );
    process.exit(1);
}

const conf = YAML.parse(fs.readFileSync(config).toString());


const main = async () => {
    if (puterjs) {
        const context = {
            mountpoint: {
                path: '/',
            }
        };

        const ts = new TestSDK(conf, context, {});
        const registry = new TestRegistry(ts);

        await require('./puter_js/__entry__.js')(registry);

        await registry.run_all_tests();

        // await run(conf);
        ts.printTestResults();
        ts.printBenchmarkResults();
        process.exit(0);
        return;
    }

    const unit_test_results = [];
    const benchmark_results = [];
    for (const mountpoint of conf.mountpoints) {
        const { unit_test_results: results, benchmark_results: benchs } = await test({ mountpoint });
        unit_test_results.push(...results);
        benchmark_results.push(...benchs);
    }

    // hard-coded identifier for ci script
    console.log("==================== nightly build results begin ====================")

    // print unit test results
    let tbl = {};
    for ( const result of unit_test_results ) {
        tbl[result.name + ' - ' + result.settings] = {
            passed: result.caseCount - result.failCount,
            failed: result.failCount,
            total: result.caseCount,
            'duration (s)': result.duration ? result.duration.toFixed(2) : 'N/A',
        }
    }
    console.table(tbl);

    // print benchmark results
    if (benchmark_results.length > 0) {
        tbl = {};
        for ( const result of benchmark_results ) {
            const fs_provider = result.fs_provider || 'unknown';
            tbl[result.name + ' - ' + fs_provider] = {
                'duration (s)': result.duration ? (result.duration / 1000).toFixed(2) : 'N/A',
            }
        }
        console.table(tbl);

        // print description of each benchmark since it's too long to fit in the table
        const seen = new Set();
        for ( const result of benchmark_results ) {
            if ( seen.has(result.name) ) continue;
            seen.add(result.name);

            if ( result.description ) {
                console.log(result.name + ': ' + result.description);
            }
        }
    }

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
        options: {
            onlycase,
            suite: suiteName,
        }
    };
    const ts = new TestSDK(conf, context);
    try {
        await ts.delete('api_test', { recursive: true });
    } catch (e) {
    }

    // hard-coded identifier for ci script
    console.log("==================== nightly build results begin ====================")

    // print unit test results
    let tbl = {};
    for ( const result of unit_test_results ) {
        tbl[result.name + ' - ' + result.settings] = {
            passed: result.caseCount - result.failCount,
            failed: result.failCount,
            total: result.caseCount,
            'duration (s)': result.duration ? result.duration.toFixed(2) : 'N/A',
        }
    }
    console.table(tbl);

    // print benchmark results
    if (benchmark_results.length > 0) {
        tbl = {};
        for ( const result of benchmark_results ) {
            const fs_provider = result.fs_provider || 'unknown';
            tbl[result.name + ' - ' + fs_provider] = {
                'duration (s)': result.duration ? (result.duration / 1000).toFixed(2) : 'N/A',
            }
        }
        console.table(tbl);

        // print description of each benchmark since it's too long to fit in the table
        const seen = new Set();
        for ( const result of benchmark_results ) {
            if ( seen.has(result.name) ) continue;
            seen.add(result.name);

            if ( result.description ) {
                console.log(result.name + ': ' + result.description);
            }
        }
    }

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

    // TODO: merge it into the entry point
    require('./benches/simple.js')(registry);

    require('./tests/__entry__.js')(registry);
    require('./benches/__entry__.js')(registry);

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
        await registry.run_all_benches(suiteName);
    } else {
        await registry.run_all();
    }

    if ( unit ) ts.printTestResults();
    if ( bench ) ts.printBenchmarkResults();

    return {
        unit_test_results: ts.packageResults,
        benchmark_results: ts.benchmarkResults,
    };
}

const main_e = async () => {
    try {
        await main();
    } catch (e) {
        log_error(e);
    }
}

main_e();
