# API Tester

A test framework for testing the puter HTTP API and puterjs API.

## Table of Contents

- [How to use](#how-to-use)
  - [Workflow](#workflow)
  - [Shorthands](#shorthands)
- [Basic Concepts](#basic-concepts)
- [Behaviors](#behaviors)
  - [Working directory (`t.cwd`)](#working-directory-t-cwd)
- [Implementation](#implementation)
- [TODO](#todo)

## How to use

### Workflow

All commands below should be run from the root directory of puter.

1. (Optional) Start a backend server: 

    ```bash
    npm start
    ```

2. Copy `example_config.yml` and add the correct values:

    ```bash
    cp ./tools/api-tester/example_config.yml ./tools/api-tester/config.yml
    ```

    Fields:
    - url: The endpoint of the backend server. (default: http://api.puter.localhost:4100/)
    - username: The username of the user to test. (e.g. `admin`)
    - token: The token of the user. (can be obtained by logging in on the webpage and typing `puter.authToken` in Developer Tools's console)
    - mountpoints: The mountpoints to test. (default config includes 2 mountpoints: `/` for "puter fs provider" and `/admin/tmp` for "memory fs provider")

3. Run tests against the HTTP API (unit tests and benchmarks):

    ```bash
    node ./tools/api-tester/apitest.js
    ```

4. (experimental) Run tests against the puter-js client:

    ```bash
    node ./tools/api-tester/apitest.js --puterjs
    ```

### Shorthands

- Run tests against the HTTP API (unit tests and benchmarks):

    ```bash
    node ./tools/api-tester/apitest.js
    ```

- Run unit tests against the HTTP API:

    ```bash
    node ./tools/api-tester/apitest.js --unit
    ```

- Run benchmarks against the HTTP API:

    ```bash
    node ./tools/api-tester/apitest.js --bench
    ```

- Filter tests by suite name:

    ```bash
    node ./tools/api-tester/apitest.js --unit --suite=mkdir
    ```

- Filter benchmarks by name:

    ```bash
    node ./tools/api-tester/apitest.js --bench --suite=stat_intensive_1
    ```

- Stop on first failure:

    ```bash
    node ./tools/api-tester/apitest.js --unit --stop-on-failure
    ```

- (unimplemented) Filter tests by test name:

    ```bash
    # (wildcard matching) Run tests containing "memoryfs" in the name
    node ./tools/api-tester/apitest.js --unit --test='*memoryfs*'

    # (exact matching) Run the test "mkdir in memoryfs"
    node ./tools/api-tester/apitest.js --unit --test='mkdir in memoryfs'
    ```

- (unimplemented) Rerun failed tests in the last run:

    ```bash
    node ./tools/api-tester/apitest.js --rerun-failed
    ```

## Basic Concepts

A *test case* is a function that tests a specific behavior of the backend API. Test cases can be nested:

```js
await t.case('normal mkdir', async () => {
    const result = await t.mkdir_v2('foo');
    expect(result.name).equal('foo');

    await t.case('can stat the created directory', async () => {
        const stat = await t.stat('foo');
        expect(stat.name).equal('foo');
    });
});
```

A *test suite* is a collection of test cases. A `.js` file should contain exactly one test suite.

```js
module.exports = {
    name: 'mkdir',
    do: async t => {
        await t.case('normal mkdir', async () => {
            ...
        });

        await t.case('recursive mkdir', async () => {
            ...
        });
    }
};
```

## Behaviors

### Working directory (`t.cwd`)

- The working directory is stored in `t.cwd`.
- All filesystem operations are performed relative to the working directory, if the given path is not absolute. (e.g., `t.mkdir('foo')`, `t.cd('foo')`, `t.stat('foo')`, etc.)
- Tests will be run under all mountpoints. The default working directory for a mountpoint is `${mountpoint.path}/{username}/api_test`. (This is subject to change in the future, the reason we include `admin` in the path is to ensure the test user `admin` has write access, see [Permission Documentation](https://github.com/HeyPuter/puter/blob/3290440f4bf7a263f37bc5233565f8fec146f17b/src/backend/doc/A-and-A/permission.md#permission-options) for details.)
- The working directory is reset at the beginning of each test suite, since a test suite usually doesn't want to be affected by other test suites.
- The working directory will be inherited from the cases in the same test suite, since a leaf case might want to share the context with its parent/sibling cases.

```js
module.exports = {
    name: 'readdir',
    do: async t => {
        // t.cwd is reset to /admin/api_test

        await t.case('normal mkdir', async () => {
            // inherits cwd from parent/sibling cases

            await t.case('mkdir in subdir', async () => {
                // inherits cwd from parent/sibling cases
            });
        });
    }
};
```

## Implementation

- Test suites are registered in `tools/api-tester/tests/__entry__.js`.

## TODO

- [ ] Reset `t.cwd` if a test case fails. Currently, `t.cwd` is not reset if a test case fails.
- [ ] Integrate apitest into CI, optionally running it only in specific scenarios (e.g., when backend code changes).
