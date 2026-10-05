---
title: Keep an API Key Secret
description: "Learn how to call a third-party API from your app without exposing its API key, by keeping the key in a Puter.js serverless worker."
tags: [workers, kv, auth]
order: 43
---

Many APIs, such as a weather, maps or payments service, give you a secret key
and bill you for every request made with it. If that key is in your app's code,
anyone can open the browser's developer tools, copy it and use it on your bill.

With a [serverless worker](/Workers/), the key stays on the server. Your app
calls the worker, the worker adds the key and calls the API, and only the answer
goes back to the browser.

## Write the Worker

Put the key in the worker file and make one route that calls the API with it.
Replace `api.example.com` and its query parameters with the API you use:

```js
const API_KEY = 'sk_live_your_key_here';

router.get('/forecast', async ({ request }) => {
    const city = new URL(request.url).searchParams.get('city');
    if (!city) {
        return new Response('city is required', { status: 400 });
    }

    const url = new URL('https://api.example.com/v1/forecast');
    url.searchParams.set('city', city);

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
    });

    return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
    });
});
```

The worker's source file stays private in your Puter account. Calling the
worker's URL only runs its routes and never returns the file, so the key is not
visible to callers. Keep it out of anything you publish, though, such as a
public Git repository or a response the worker sends.

## Return a New Response

The route above builds a new `Response` from the API's answer instead of
returning `res` itself. The worker adds a CORS header to every response so your
app can read it, and the headers of a response from `fetch()` cannot be changed.
Unless the API already sent a CORS header, returning `res` as it is makes the
route fail with a `500`.

Copying only the body, the status and the content type also keeps the API's
other headers, such as cookies or account details, away from the browser.

## Only Forward What You Expect

The worker decides which API, which path and which parameters are used. The
caller only fills in `city`. Never take the full URL, the path or the headers
from the request, because the worker would then send your key with any request a
stranger asks for.

If the API takes a fixed set of values, check them before the call:

```js
const UNITS = ['metric', 'imperial'];

const units = new URL(request.url).searchParams.get('units') ?? 'metric';
if (!UNITS.includes(units)) {
    return new Response('units must be metric or imperial', { status: 400 });
}
url.searchParams.set('units', units);
```

## Require Sign-In and Limit Use

Anyone who knows the worker's URL can call it, and each call spends your key.
Calling it with [`puter.workers.exec()`](/Workers/exec/) gives the route a
`user`, so it can turn away callers who are not signed in and count how often
each user calls.

Here is the complete worker with a limit of 100 calls per user per day. The
count is kept in your own [key-value store](/KV/) with `me.puter`, so users
cannot reset it:

```js
const API_KEY = 'sk_live_your_key_here';
const DAILY_LIMIT = 100;

async function getCaller(user) {
    if (!user) return null;
    try {
        return await user.puter.getUser();
    } catch {
        return null;
    }
}

async function isOverLimit(uuid) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `forecast:calls:${uuid}:${day}`;

    const count = await me.puter.kv.incr(key);
    if (count === 1) {
        await me.puter.kv.expire(key, 2 * 24 * 60 * 60);
    }
    return count > DAILY_LIMIT;
}

router.get('/forecast', async ({ request, user }) => {
    const caller = await getCaller(user);
    if (!caller) {
        return new Response('sign in required', { status: 401 });
    }

    const city = new URL(request.url).searchParams.get('city');
    if (!city) {
        return new Response('city is required', { status: 400 });
    }

    if (await isOverLimit(caller.uuid)) {
        return new Response('daily limit reached, try again tomorrow', { status: 429 });
    }

    const url = new URL('https://api.example.com/v1/forecast');
    url.searchParams.set('city', city);

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
    });

    return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
    });
});
```

`getCaller()` looks the user up, because a request with a made-up token still
gets a `user` and only fails once it is used. Each user gets one counter per day.
[`puter.kv.incr()`](/KV/incr/) starts a missing counter at 0, and
[`puter.kv.expire()`](/KV/expire/) removes it two days later so old counters do
not pile up.

## Deploy the Worker

Deploy the worker to get its URL, such as `https://forecast-proxy.puter.work`.
The [Workers deployment guide](/Workers/#deployment) covers each way to deploy.

## Call It From Your App

Call the worker with [`puter.workers.exec()`](/Workers/exec/), so the request
carries the signed-in user:

```js
const API = 'https://forecast-proxy.puter.work';

const res = await puter.workers.exec(`${API}/forecast?city=${encodeURIComponent('Paris')}`);

if (res.ok) {
    const forecast = await res.json();
} else {
    alert(await res.text());    // 'daily limit reached, try again tomorrow'
}
```

Your app's code now has no key in it, and every call to the API goes through
the worker.
