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
worker's URL only runs its routes and never returns the file, so callers cannot
see the key. Keep the key out of anything you publish yourself, such as a public
Git repository.

## Deploy the Worker

Deploy the worker to get its URL, such as `https://forecast-proxy.puter.work`.
The [Workers deployment guide](/Workers/#deployment) covers each way to deploy.

## Call It From Your App

Call the worker's URL with `fetch()`, the same way you would call the API
directly:

```js
const API = 'https://forecast-proxy.puter.work';

const res = await fetch(`${API}/forecast?city=${encodeURIComponent('Paris')}`);
const forecast = await res.json();
```

Your app's code now has no key in it, and every call to the API goes through
the worker.

## Check What the Caller Sends

The caller only chooses `city`. The API's address and the key are written in
the worker, so a caller cannot use your key to call anything else.

To let the caller choose more, such as the units, read the value and check it
before you add it to the request:

```js
const UNITS = ['metric', 'imperial'];

router.get('/forecast', async ({ request }) => {
    const params = new URL(request.url).searchParams;

    const city = params.get('city');
    if (!city) {
        return new Response('city is required', { status: 400 });
    }

    const units = params.get('units') ?? 'metric';
    if (!UNITS.includes(units)) {
        return new Response('units must be metric or imperial', { status: 400 });
    }

    const url = new URL('https://api.example.com/v1/forecast');
    url.searchParams.set('city', city);
    url.searchParams.set('units', units);

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
    });

    return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
    });
});
```

## Limit How Often the Key Is Used

Anyone who knows the worker's URL can call it, and each call spends your key.
You can limit calls per visitor or per signed-in user.

To limit each visitor without asking them to sign in, count calls by IP address.
[Add a contact form](/recipes/add-contact-form/#limit-how-often-a-visitor-can-send)
shows a complete worker that does this.

To limit each user, have your users sign in with their Puter account. Call the
worker with [`puter.workers.exec()`](/Workers/exec/) instead of `fetch()`. If the
user is not signed in yet, Puter.js opens the Puter sign-in window first. The
request then carries the user's session, and the route gets a `user` for them.
The route can answer `401` to callers without a `user`, and count each user's
calls.

Here is the complete worker with a limit of 100 calls per user per day. The
count is kept in your own [key-value store](/KV/) with `me.puter`, which is
Puter.js signed in to your account as the worker's owner, so users cannot reset
it:

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

The `getCaller()` helper looks the user up, because a request with a made-up
token still gets a `user` and only fails once it is used. Each user gets one
counter per day. The [`incr()`](/KV/incr/) method starts a missing counter at 0,
and [`expire()`](/KV/expire/) deletes it two days later, so your store only
keeps recent counters.

In your app, call the worker with [`puter.workers.exec()`](/Workers/exec/) and
show the message when the limit is reached:

```js
const res = await puter.workers.exec(`${API}/forecast?city=${encodeURIComponent('Paris')}`);

if (res.ok) {
    const forecast = await res.json();
} else {
    alert(await res.text());    // 'daily limit reached, try again tomorrow'
}
```
