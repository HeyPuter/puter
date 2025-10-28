## Table of Contents

- [Summary](#summary)
- [How to use](#how-to-use)
  - [Initialize the Client Config](#initialize-the-client-config)
  - [Run API-Tester (test http API)](#run-api-tester-test-http-api)
  - [Run Playwright (test puter-js API with browser environment)](#run-playwright-test-puter-js-api-with-browser-environment)
  - [Run Vitest (test puter-js API with node environment)](#run-vitest-test-puter-js-api-with-node-environment)

## Summary

End-to-end tests for puter-js and http API.

## How to use

### Initialize the Client Config

1. Start a backend server: 

    ```bash
    npm start
    ```

2. Copy `example-client-config.yaml` and edit the `auth_token` field. (`auth_token` can be obtained by logging in on the webpage and typing `puter.authToken` in Developer Tools's console)

    ```bash
    cp ./tests/example-client-config.yaml ./tests/client-config.yaml
    ```

### Run API-Tester (test http API)

```bash
node ./tests/api-tester/apitest.js --unit --stop-on-failure
```

### Run Playwright (test puter-js API with browser environment)

```bash
cd ./tests/playwright
npm install
npx playwright install --with-deps
npx playwright test
```

### Run Vitest (test puter-js API with node environment)

```bash
npm run test:puterjs-api
```