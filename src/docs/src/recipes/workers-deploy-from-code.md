---
title: Deploy a Worker from Your App
description: "Learn how to create, update, list and delete serverless workers from your own code with Puter.js, instead of publishing them by hand."
tags: [workers]
order: 42
---

You can publish a [serverless worker](/Workers/) by hand from puter.com. You
can also do it from code, with the [Workers API](/Workers/#workers-api). Your
app then creates a worker, updates its code and removes it, the same way it
writes files.

This lets you build tools that ship backends for their users, such as an app
builder that gives each project its own API.

## Create a Worker

A worker is deployed from a JavaScript file in your Puter account. Write the
code with [`puter.fs.write()`](/FS/write/), then pass the file to
[`puter.workers.create()`](/Workers/create/) along with a name:

```js
await puter.fs.write('notes-api.js', `
    router.get('/me', async ({ user }) => {
        const { username } = await user.puter.getUser();
        return { username };
    });
`);

const deployment = await puter.workers.create('notes-api', 'notes-api.js');

deployment.url;    // 'https://notes-api.puter.work'
```

Give it 5 to 30 seconds before the first request, while the worker spreads to
every edge server. Then call it with
[`puter.workers.exec()`](/Workers/exec/), which sends the signed-in user along
so the route can use `user.puter`:

```js
const res = await puter.workers.exec(`${deployment.url}/me`);
await res.json();    // { username: 'grace' }
```

[Build an API with a worker](/recipes/workers-build-an-api/) covers what to put
in the routes.

Worker names are global, like subdomains, and are stored in lowercase. A name
can use letters, numbers, hyphens and underscores. When another account already
has the name, `create()` rejects, so pick another one or use
[`puter.randName()`](/Utils/randName/). The account deploying the worker needs a
verified email address.

## Update Its Code

A worker keeps its name and URL for as long as it exists. To change what it
runs, overwrite its source file. [`puter.workers.get()`](/Workers/get/) tells
you where that file is:

```js
const info = await puter.workers.get('notes-api');

await puter.fs.write(info.file_path, updatedCode);
```

Writing the file redeploys the worker at the same URL, so anything already
calling it keeps working.

Don't create a new worker with a new name to ship a change. The old one stays
online at its old URL, and every caller has to be pointed at the new one.

## Find Your Workers

To show the workers in your account, call
[`puter.workers.list()`](/Workers/list/):

```js
const workers = await puter.workers.list();

for (const worker of workers) {
    console.log(worker.name, worker.url);
}
```

To look up one worker by name, use [`puter.workers.get()`](/Workers/get/). It
resolves to `undefined` when there is no worker with that name, which makes it
a quick existence check before a deploy:

```js
const existing = await puter.workers.get('notes-api');

if (!existing) {
    await puter.workers.create('notes-api', 'notes-api.js');
}
```

## Keep Workers Apart

Inside a worker, [`me.puter`](/Workers/router/#integration-with-puter-js)
reaches the key-value store and files of the app the worker runs as. When your
app creates workers, they run as your app by default, so they all share that
data with each other and with your app.

To give each worker its own data, pass `sandbox: true`:

```js
await puter.workers.create('project-alpha-api', 'alpha.js', { sandbox: true });
await puter.workers.create('project-beta-api', 'beta.js', { sandbox: true });
```

Each worker now runs as its own app, so a key one of them writes is not visible
to the other. Decide this before the worker stores anything, because changing
it later does not move data that was already written.

## Delete a Worker

To take a worker offline, call [`puter.workers.delete()`](/Workers/delete/)
with its name:

```js
await puter.workers.delete('notes-api');
```

Its URL stops answering, and the name is free to use again. The source file
stays in your account.

The link also works the other way. Deleting a worker's source file with
[`puter.fs.delete()`](/FS/delete/) deletes the worker too, so keep the file for
as long as the worker should stay online.
