---
title: Build an API with a Worker
description: "Learn how to build a backend API for your app with Puter.js serverless workers."
tags: [workers, kv, auth]
order: 38
---

Some of your app's code belongs outside the user's browser, such as checking
input before it is saved, receiving a webhook from another service, or calling
another API. That code needs a backend, which usually means running and paying
for a server.

A [serverless worker](/Workers/) gives you that backend with no server to run,
like Cloudflare Workers or AWS Lambda. It is JavaScript that runs in the cloud
and answers HTTP requests at its own URL, such as
`https://notes-api.puter.work`. You write it as a list of routes, each one a
path and the function that handles it.

When your app calls a worker with
[`puter.workers.exec()`](/Workers/exec/), the worker knows which user is calling
and gets that user's Puter account as `user.puter`. A route can then read and
write the user's own [key-value store](/KV/), files and AI, the same way your
app does in the browser. The data stays in the user's account, and the usage is
billed to them under the [User-Pays model](/user-pays-model/), so you get a
backend without paying for its storage.

## Define a Route

The `router` object is available in every worker. Register a route with the
method's name and a path, and return what the caller should get back:

```js
router.get('/me', async ({ user }) => {
    if (!user) {
        return new Response('sign in required', { status: 401 });
    }

    const { username } = await user.puter.getUser();
    return { username };
});
```

There is one method per HTTP verb: `router.get()`, `router.post()`,
`router.put()`, `router.delete()` and `router.options()`.

`user` is only there when the request came through
[`puter.workers.exec()`](/Workers/exec/), so every route that uses it starts by
checking for it.

## Store Data in the User's Account

To save something for the caller, write it with `user.puter.kv`. Read the JSON
body with `request.json()`:

```js
router.post('/notes', async ({ request, user }) => {
    if (!user) {
        return new Response('sign in required', { status: 401 });
    }

    const { text } = await request.json();
    if (typeof text !== 'string' || text.length === 0) {
        return new Response('text is required', { status: 400 });
    }

    const note = { id: crypto.randomUUID(), text, at: Date.now() };
    await user.puter.kv.set(`notes:${note.id}`, note);
    return note;
});
```

Each user's notes land in their own store, so one user can never read or
overwrite another's, whatever the request body says. These are the same keys
your app sees through [`puter.kv`](/KV/) in the browser, so the app can also
read a note directly.

## Read the Request

Each handler receives one object. Its `request` is a standard
[`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request), and its
`params` holds the parts of the path you marked with a colon:

```js
router.get('/notes/:id', async ({ params, user }) => {
    if (!user) {
        return new Response('sign in required', { status: 401 });
    }

    const note = await user.puter.kv.get(`notes:${params.id}`);
    if (!note) {
        return new Response('note not found', { status: 404 });
    }

    return note;
});
```

Captured values are always strings, so convert them yourself when you need a
number.

Query strings are not part of the path. To read one, parse the request URL:

```js
router.get('/notes', async ({ request, user }) => {
    if (!user) {
        return new Response('sign in required', { status: 401 });
    }

    const q = new URL(request.url).searchParams.get('q') ?? '';
    const rows = await user.puter.kv.list('notes:', true);

    return rows
        .map(row => row.value)
        .filter(note => note.text.includes(q));
});
```

## Send a Response

A handler that returns a plain object or array is sent as JSON, and one that
returns a string is sent as text. To choose the status code or the headers,
return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response),
as the `401`, `400` and `404` answers above do.

The worker adds CORS headers to every response, so your app can call it from
any origin without extra setup.

## Handle Unknown Paths

A wildcard route matches the rest of the path. Register one last, so it only
runs when no other route matched, and use it to answer with a `404`:

```js
router.get('/*path', async ({ params }) => {
    return new Response(`no route for /${params.path}`, { status: 404 });
});
```

The wildcard needs a name, such as `*path`. A bare `*` is read as a literal
character and does not match anything else.

## Routes Without a User

A worker is also an ordinary HTTP endpoint, so it can serve callers that have
never heard of Puter. A webhook from another service, a `curl` in a script, or a
page without Puter.js can all call it. These routes never touch `user`.

A route can do its work and answer, with nothing to store:

```js
router.get('/slugify', async ({ request }) => {
    const text = new URL(request.url).searchParams.get('text') ?? '';

    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
});
```

Any HTTP client can call it:

```sh
curl "https://notes-api.puter.work/slugify?text=Hello%20World"
# hello-world
```

To keep what an outside service sends you, store it in your own account with
`me.puter`, which is available to every request whoever made it:

```js
router.post('/webhooks/payments', async ({ request }) => {
    const event = await request.json();

    await me.puter.kv.set(`payments:${event.id}`, event);
    return { received: true };
});
```

A worker can also call other APIs with `fetch()`, which lets it reshape a
third-party response before your app sees it:

```js
router.get('/weather/:city', async ({ params }) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(params.city)}?format=j1`);
    const data = await res.json();

    return { city: params.city, tempC: data.current_condition[0].temp_C };
});
```

Anyone who knows the URL can call a route like these, so keep private data
behind routes that check for `user`.

## Call It From Your App

Once the worker is [deployed](/Workers/#deployment), call it with
[`puter.workers.exec()`](/Workers/exec/). It takes the same arguments as
`fetch()` and adds the signed-in user's session, which is what gives the worker
`user.puter`:

```js
const API = 'https://notes-api.puter.work';

const res = await puter.workers.exec(`${API}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Buy milk' }),
});
const note = await res.json();    // { id: '5f0c…', text: 'Buy milk', at: 1788827048741 }

const notes = await (await puter.workers.exec(`${API}/notes?q=milk`)).json();
```

A plain `fetch()` of the same URL carries no session, so `user` is undefined
and the notes routes answer `401`. It works for
[routes without a user](#routes-without-a-user), which is how
callers without Puter.js reach them.

To keep data that every user reads and writes together, such as a leaderboard,
store it with `me.puter` instead. See
[Store server-side data](/recipes/store-server-side-data/).
