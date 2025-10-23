## Summary

Playwright test the puter-js API in browser environment.

## Motivation

Some features of the puter-js/puter-GUI only work in the browser environment:

- file system
    - naive-cache
    - client-replica (WIP)
    - wspush

## Setup

Install dependencies:

```sh
cd ./tests/playwright
npm install
npx playwright install --with-deps
```

Initialize the client config (working directory: `./tests/playwright`):

1. `cp ../example-client-config.yaml ../client-config.yaml`
2. Edit the `client-config.yaml` to set the `auth_token`

## Run tests

### CLI

Working directory: `./tests/playwright`

```sh
# run all tests
npx playwright test

# run a test by name
# e.g: npx playwright test -g "mkdir in root directory is prohibited"
npx playwright test -g "mkdir in root directory is prohibited"

# run the tests that failed in the last test run
npx playwright test --last-failed

# open the report of the last test run in the browser
npx playwright show-report
```

### VSCode/Cursor

1. Install the "Playwright Test for VSCode" extension.
2. Go to "Testing" tab in the sidebar.
3. Click buttons to run tests.
