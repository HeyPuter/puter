module.exports = class TestRegistry {
    constructor (t) {
        this.t = t;
        this.sdks = {};
        this.tests = {};
        this.benches = {};
    }

    add_test_sdk (id, instance) {
        this.t.sdks[id] = instance;
    }

    add_test (id, testDefinition) {
        this.tests[id] = testDefinition;
    }

    add_bench (id, benchDefinition) {
        this.benches[id] = benchDefinition;
    }

    async run_all_tests(suiteName) {
        // check if "suiteName" is valid
        if (suiteName && !Object.keys(this.tests).includes(suiteName)) {
            throw new Error(`Suite not found: ${suiteName}, valid suites are: ${Object.keys(this.tests).join(', ')}`);
        }

        for ( const id in this.tests ) {
            if (suiteName && id !== suiteName) {
                continue;
            }

            const testDefinition = this.tests[id];
            await this.t.runTestPackage(testDefinition);
        }
    }

    // copilot was able to write everything below this line
    // and I think that's pretty cool

    async run_all_benches () {
        for ( const id in this.benches ) {
            const benchDefinition = this.benches[id];
            await this.t.runBenchmark(benchDefinition);
        }
    }

    async run_all () {
        await this.run_all_tests();
        await this.run_all_benches();
    }

    async run_test (id) {
        const testDefinition = this.tests[id];
        if ( ! testDefinition ) {
            throw new Error(`Test not found: ${id}`);
        }
        await this.t.runTestPackage(testDefinition);
    }

    async run_bench (id) {
        const benchDefinition = this.benches[id];
        if ( ! benchDefinition ) {
            throw new Error(`Bench not found: ${id}`);
        }
        await this.t.runBenchmark(benchDefinition);
    }

    async run (id) {
        if ( this.tests[id] ) {
            await this.run_test(id);
        } else if ( this.benches[id] ) {
            await this.run_bench(id);
        } else {
            throw new Error(`Test or bench not found: ${id}`);
        }
    }
}
