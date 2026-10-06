---
title: Add a Backend to Your Website
description: "Learn how to add a backend to a website hosted on Puter, so the site can save data and run code on the server without a separate deploy."
tags: [workers, hosting]
order: 44
---

A static website is a set of files that run in the visitor's browser. Some
features need code that runs on a server instead, such as a visit counter that
every visitor sees, or a call to an API with a secret key. Usually that means
running a server next to your site and deploying the two separately.

If your site is [hosted on Puter](/deployments/#deploy-to-puter), the server
code can be a file inside the site's folder. This file is called a
[dynamic worker](/Workers/dynamic/). It goes online when you publish the site,
and it answers on the site's own address.

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

Write the file with the [`router`](/Workers/router/) API. This worker counts
visits:

```js
// __workers/api.worker.js
router.post('/visits', async () => {
    const visits = await me.puter.kv.incr('visits');
    return { visits };
});
```

The worker runs as you, the owner of the site. Inside it, `me.puter` is
Puter.js signed in to your account, so the count is saved in your
[key-value store](/KV/) and every visitor adds to the same number. The
[`incr()`](/KV/incr/) method adds 1 and returns the new value.

The data belongs to the site's address. If you publish the same files under
another site name, the worker there starts with an empty store.

The name before `.worker.js` can use lowercase letters, numbers, `-` and `_`.
Each `.worker.js` file directly inside `__workers` is a worker of its own, and
all of them share the same key-value store.

Publish the site the way you already do, and the worker goes online with it.

## Call It From the Site

The worker answers at `/__workers/<name>/` on your site. That prefix is removed
before the request reaches your routes, so `/__workers/api/visits` runs the
`/visits` route.

The worker is on the same address as the page, so the page can call it with a
path instead of a full URL:

```js
const res = await fetch('/__workers/api/visits', { method: 'POST' });
const { visits } = await res.json();

document.getElementById('visits').textContent = `${visits} visits`;
```

The path is the same on every site, so this code does not change if you
publish the site under another name.

To know which visitor is calling, call the worker with
[`puter.workers.exec()`](/Workers/exec/) instead of `fetch()`. See
[Build an API with a worker](/recipes/build-an-api/) for how a route uses the
visitor's Puter account.

## Update the Code

To change the worker, save the new code to its file in the site's folder, for
example by publishing the site again. Shortly after, requests run the new code.
The first request after a change can take a few seconds longer than the ones
after it.

## Keep Secrets in the Worker

Files under `__workers` are never served to visitors. A visitor who opens
`/__workers/api.worker.js` gets a `404`, and only the worker's routes answer.

That makes the worker file a safe place for values the browser should not see,
such as an API key. See [Keep an API key secret](/recipes/keep-api-key-secret/).

For the full path rules and what dynamic workers support, see
[Dynamic Workers](/Workers/dynamic/).
