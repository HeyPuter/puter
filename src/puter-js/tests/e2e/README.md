# puter-js end-to-end tests

See **[../../TESTING.md](../../TESTING.md)** for the full guide: setup, how to set the admin password, how to run the tests, how it all works, and how to add new tests.

## TL;DR

```sh
# one-time setup
cp tests/e2e/.env.example tests/e2e/.env
$EDITOR tests/e2e/.env   # set PUTER_ADMIN_PASSWORD from the npm start banner

# run
npm run test:e2e             # headless
npm run test:e2e:headed      # watch the browser
npm run test:e2e:record      # save video for every test
```
