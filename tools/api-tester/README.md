# API Tester

A test framework for testing the backend API of puter.

## Table of Contents

- [API Tester](#api-tester)
- [How to use](#how-to-use)
  - [Workflow](#workflow)
  - [Shorthands](#shorthands)
- [Basic Concepts](#basic-concepts)
- [Behaviors](#behaviors)
  - [Isolation of `t.cwd`](#isolation-of-t-cwd)
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
    - username: The username of the admin user. (e.g. admin)
    - token: The token of the user. (can be obtained by typing `puter.authToken` in Developer Tools's console)

3. Run the tests:

    ```bash
    node ./tools/api-tester/apitest.js --config=./tools/api-tester/config.yml
    ```

### Shorthands

- Run unit tests only:

    ```bash
    node ./tools/api-tester/apitest.js --config=./tools/api-tester/config.yml --unit
    ```

- Filter tests by suite name:

    ```bash
    node ./tools/api-tester/apitest.js --config=./tools/api-tester/config.yml --unit --suite=mkdir
    ```

- Rerun failed tests in the last run:

    ```bash
    node ./tools/api-tester/apitest.js --config=./tools/api-tester/config.yml --rerun-failed
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

### Isolation of `t.cwd`

- `t.cwd` is reset at the beginning of each test suite, since a test suite usually doesn't want to be affected by other test suites.
- `t.cwd` will be inherited from the cases in the same test suite, since a leaf case might want to share the context with its parent/sibling cases.

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

- [ ] Update usage of apitest.js. (Is it possible to generate the usage automatically?)
- [ ] Integrate it into CI, optionally running it only in specific scenarios (e.g., when backend code changes).
