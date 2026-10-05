---
title: Add a Backend to Your Website
description: "Learn how to add server-side endpoints to a website hosted on Puter by putting a worker file inside the site, with no separate worker to deploy."
tags: [workers, hosting]
order: 44
---

A [serverless worker](/Workers/) usually lives apart from the website that calls
it. You deploy it on its own, it gets its own `*.puter.work` URL, and you keep
the site and the worker in step by hand.

If your site is [hosted on Puter](/deployments/#deploy-to-puter), you can put
the backend inside the site instead. A [dynamic worker](/Workers/dynamic/) is a
file in the site's `__workers` folder. It goes online with the site, and it
answers on the site's own domain.

## Add the Worker File

Make a folder named `__workers` next to your `index.html`, and put a file in it
whose name ends in `.worker.js`:

```
my-site/
  index.html
  app.js
  __workers/
    api.worker.js
```

Write the file with the same [`router`](/Workers/router/) API as any other
worker:

```js
// __workers/api.worker.js
router.get('/health', async () => {
    return { ok: true };
});

router.post('/scores', async ({ request, user }) => {
    if (!user) {
        return new Response('sign in required', { status: 401 });
    }

    const { uuid, username } = await user.puter.getUser();
    const { score } = await request.json();
    if (typeof score !== 'number') {
        return new Response('score must be a number', { status: 400 });
    }

    await me.puter.kv.set(`api:scores:${uuid}`, { username, score });
    return { username, score };
});
```

`me.puter` is your own account as the site's owner, and `user.puter` is the
visitor who called it, the same as in a regular worker.

The name before `.worker.js` can use lowercase letters, numbers, `-` and `_`.
Only files directly inside `__workers` are workers. A file in a subfolder, or
one with any other name, is ignored.

Publish the site the way you already do, and the worker goes online with it.

## Call It From the Site

The worker answers at `/__workers/<name>/` on your site. That prefix is removed
before the request reaches your routes, so `/__workers/api/health` runs the
`/health` route.

Because the worker is on the same domain as the page, the app can use a path
instead of a full URL:

```js
const res = await puter.workers.exec('/__workers/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score: 120 }),
});
await res.json();    // { username: 'grace', score: 120 }
```

[`puter.workers.exec()`](/Workers/exec/) sends the visitor's session, which is
what gives the route `user`. Routes that do not need a user, such as
`/health`, can be called with a plain `fetch()`.

The path is the same on every site, so the code that calls the worker does
not change if you publish the site under another name.

## Update the Code

To change the worker, save the new code to its file in the site's folder, for
example by deploying the site again. Shortly after, requests run the new code.

A dynamic worker is started when a request needs it, such as the first request
after a change, so that request can take a few seconds longer than the ones
after it.

## Keep Secrets in the Worker

Nothing under `__workers` is ever served as a file. A visitor who opens
`/__workers/api.worker.js` gets a `404`, and so does a visitor who asks for any
other file in that folder. Only the worker's routes answer.

That makes the worker file a safe place for code and values the browser should
not see, such as an API key. See
[Keep an API key secret](/recipes/keep-api-key-secret/).

## Use More Than One Worker

Each `.worker.js` file is a worker of its own, with its own path:

```
__workers/
  api.worker.js           -> /__workers/api/...
  matchmaking.worker.js   -> /__workers/matchmaking/...
```

All the workers in one site share the same key-value store and files through
`me.puter`, so they can work together on the same data. That also means one
can overwrite another's keys, so start each worker's keys with its own name,
such as `api:` and `matchmaking:`.

This data belongs to the site's address. If you publish the same files under a
different subdomain, the workers there start with an empty store, and the data
written under the old address stays with it.

## Handle a Worker That Did Not Start

Besides the answers your routes return, a dynamic worker can answer with:

| Status | Meaning |
| --- | --- |
| `404` | There is no worker file with that name directly under `__workers`. |
| `503` | The file exists, but the worker could not be started this time. |

A `503` can pass, so it is worth trying again. A small helper retries a few
times before giving up:

```js
async function callWorker(path, options, attempts = 3) {
    for (let i = 1; ; i++) {
        const res = await puter.workers.exec(path, options);
        if (res.status !== 503 || i === attempts) return res;
        await new Promise(resolve => setTimeout(resolve, 1000 * i));
    }
}

const res = await callWorker('/__workers/api/health');
```

Only retry requests that are safe to repeat, such as reads, or writes that set
a value rather than add to one.

## Know the Limits

- Dynamic workers answer on `*.puter.site` addresses only, not on custom
  domains.
- They do not appear in [`puter.workers.list()`](/Workers/list/) or the
  Developer Center, because there is no separate worker to list.

When you need either of these, deploy a regular worker instead. See
[Build an API with a worker](/recipes/build-an-api/).
