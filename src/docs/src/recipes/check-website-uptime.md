---
title: Check Website Uptime
description: "Learn how to check a website, save each result in the user's key-value store and show recent checks with Puter.js."
tags: [net, kv]
order: 71
---

To see whether a website is responding, make a request with
[`puter.net.fetch()`](/Networking/fetch/) and save the result with
[`puter.kv.set()`](/KV/set/). This gives your app a history of successful
checks, HTTP errors and connection failures.

This example checks a site when the user clicks a button, keeps each result
for seven days, and shows the latest 20 checks. Each user's history lives in
their own account.

## Check the Site

Use a `HEAD` request to read the site's status without downloading its page.
Check `response.ok` to tell whether it returned a status from `200` to `299`,
and catch request failures so they can be saved too:

```js
async function checkWebsite(url) {
    const started = performance.now();
    const result = {
        at: Date.now(),
        up: false,
        status: null,
        durationMs: 0,
        error: null,
    };

    try {
        const response = await puter.net.fetch(url, { method: 'HEAD' });
        result.up = response.ok;
        result.status = response.status;
    } catch (error) {
        result.error = String(error?.message ?? error?.error?.message ?? error);
    }
    result.durationMs = Math.round(performance.now() - started);

    const prefix = `uptime:${encodeURIComponent(url)}:`;
    const key = `${prefix}${new Date(result.at).toISOString()}:${crypto.randomUUID()}`;
    const inSevenDays = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    await puter.kv.set(key, result, inSevenDays);
    return result;
}
```

An HTTP error has a status, such as `503`. A request that fails before getting
a response has `status: null` and an error message. A failed KV write still
rejects, so the app can tell the user when a result could not be saved.

Each check has its own key. The timestamp sorts checks by time, and the UUID
keeps two checks made in the same millisecond from replacing each other.
The third argument to `set()` is an expiry timestamp in seconds.

## Read Recent Checks

List the site's keys with [`puter.kv.list()`](/KV/list/). Pass `reverse: true`
to put the newest first and `limit: 20` to read one page of history:

```js
async function getHistory(url) {
    const page = await puter.kv.list({
        pattern: `uptime:${encodeURIComponent(url)}:*`,
        returnValues: true,
        reverse: true,
        limit: 20,
        fetchUntilFull: true,
    });

    return page.items.map((entry) => entry.value);
}
```

With `limit`, `list()` returns a page object whose `items` hold the key-value
pairs. `fetchUntilFull` fills the page when possible, even if expired keys
are skipped. A site with no saved checks returns an empty list.

## Show the History

Add a button, a status message and a place for the history to a page that
loads Puter.js:

```html
<script src="https://js.puter.com/v2/"></script>
<button id="check-site" type="button">Check now</button>
<p id="check-status" role="status"></p>
<pre id="check-history"></pre>
```

Put the two functions above and this code in the same script, after the
elements. Change `targetUrl` to the site or health endpoint you want to check:

```js
const targetUrl = 'https://example.com/';
const checkButton = document.getElementById('check-site');
const status = document.getElementById('check-status');
const history = document.getElementById('check-history');

async function showHistory() {
    const checks = await getHistory(targetUrl);
    history.textContent = checks.length ? checks.map((check) => {
        const time = new Date(check.at).toLocaleString();
        const outcome = check.up ? 'Up' : 'Down';
        const detail = check.status === null ? check.error : `HTTP ${check.status}`;
        return `${time} - ${outcome} - ${detail} - ${check.durationMs} ms`;
    }).join('\n') : 'No checks yet.';
}

checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    status.textContent = 'Checking...';

    try {
        const result = await checkWebsite(targetUrl);
        status.textContent = result.up ? 'The site responded successfully.' : 'The check failed.';
        await showHistory();
    } catch (error) {
        const message = error?.message ?? error?.error?.message ?? error;
        status.textContent = `Could not save or load the results: ${message}`;
    } finally {
        checkButton.disabled = false;
    }
});

showHistory().catch((error) => {
    const message = error?.message ?? error?.error?.message ?? error;
    status.textContent = `Could not load the history: ${message}`;
});
```

The button stays disabled until the check and history refresh finish. A
connection failure is saved as a failed check, and its message appears in
the history.

## Notes

- Use an endpoint that accepts `HEAD`. A site that rejects it can return
  `405` even when its pages work. For a `GET` check, cancel the response body
  with `await response.body?.cancel()` after reading the status.
- This example treats every non-2xx status as down. Change that rule if your
  endpoint uses another status for a successful check.
- The elapsed time includes connection setup and the network path from the
  user's browser. Each result is one sample of the site's availability.
- Checks run when the user clicks the button. Closing the page stops them.
- To show older results, keep the page's `cursor` and request the next page,
  as in [store a large collection](/recipes/store-large-collection/).
