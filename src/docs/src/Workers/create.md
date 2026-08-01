---
title: puter.workers.create()
description: Create and deploy workers from JavaScript files.
platforms: [websites, apps, nodejs, workers]
---

Creates and deploys a new worker from a JavaScript file containing [router](../router) code.

A worker is tied to its **name**: you create it **once** and keep that name. To deploy changes, don't call `create()` again with a new name — instead overwrite the worker's source file (see [Updating a worker](#updating-a-worker) below). Recreating under a different name leaves the old worker live at its old URL while your callers end up pointing at an orphaned one.

<div class="info">To create a worker, you'll need a <a href="https://puter.com/">Puter account</a> with a verified email address. After a worker is created or updated, full propagation may take between 5 and 30 seconds to take effect across all edge servers.</div>

## Syntax

```js
puter.workers.create(workerName, filePath)
puter.workers.create(workerName, filePath, appName)
puter.workers.create(workerName, filePath, options)
```

## Parameters

<div class="info">Workers cannot be larger than <strong>10MB</strong>.</div>

#### `workerName` (String)(Required)
The name for the worker. It can contain letters, numbers, hyphens, and underscores.

#### `filePath` (String)(Required)
The path to a JavaScript file in your Puter account that contains your [router](../router) code.

#### `appName` (String)(Optional)
The name of an existing app in your account to bind the worker to. The worker then runs as that app, and no sandbox app is created.

When your code is itself running as a Puter app, you may only name an app that **your app created** — apps you didn't create are rejected with a `403`. Deploying from the GUI or with a user token, you may name any app in your account.

#### `options` (Object)(Optional)
An alternative to `appName` for controlling the worker's sandbox.

- `sandbox` (Boolean)(Optional) - Whether to give the worker its own isolated sandbox app. When `true`, a dedicated `sandbox-<workerName>` app is created (or reused) to own the worker. The default depends on how you're authenticated:
  - **Deploying as an app** (your code runs inside a Puter app): defaults to `false`. The worker runs as your app.
  - **Deploying with a user token** (the GUI, a root access token): defaults to `true`. Most people deploying workers this way never need to think about it.

## Worker identity and shared state

Every worker runs as some app, and that identity decides which [`puter.kv`](/KV/) namespace and which `AppData` directory the worker reaches. Two workers running as the same app read and write **the same** KV keys and the same files.

<div class="info"><strong>Without a sandbox, workers share state.</strong> When an app deploys several workers without <code>sandbox: true</code>, all of them run as that app — so they share one KV namespace and one AppData directory with each other <em>and</em> with the app's own frontend. A key one worker writes is a key every other worker can read and overwrite. If your workers are meant to be independent (for example, one per project your app generates), deploy them with <code>sandbox: true</code> or bind each to its own app with <code>appName</code>.</div>

Sandboxing is the way to keep them apart:

```js
// Each of these gets its own app identity, so their KV and AppData
// are completely separate from each other and from the deploying app.
await puter.workers.create('project-alpha-api', 'api.js', { sandbox: true });
await puter.workers.create('project-beta-api', 'api.js', { sandbox: true });
```

Two identities are in play inside a worker, and only the first is affected by this setting:

- `puter.*` (also `me.puter`) — the **worker's own** identity, set by the binding above.
- `user.puter.*` — the identity of **whoever called the worker** via [`puter.workers.exec()`](/Workers/exec/). If an app calls a worker, this is that calling app's namespace, regardless of which app the worker itself runs as.

Changing a worker's binding does not migrate its data. A worker redeployed with a different `sandbox` setting or `appName` starts against a different namespace, and anything it wrote under the old identity stays where it was.

## Return Value

A `Promise` that resolves to a [`WorkerDeployment`](/Objects/workerdeployment) object on success.

On failure, throws an `Error` with the reason.

## Examples

<strong class="example-title">Basic Syntax</strong>

```js
// Create a new worker from a file in your Puter account
puter.workers.create('my-api', 'api-server.js')
    .then(result => {
        console.log(`Worker deployed at: ${result.url}`);
    })
    .catch(error => {
        console.error('Deployment failed:', error.message);
    });
```

<strong class="example-title">Complete Example</strong>

```html;workers-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // 1. Create a worker file in your Puter account.
        puter.print('→ Writing the worker code to my-worker.js<br>');
        const workerCode = `
        // A router for /api/hello
        router.get('/api/hello', async (event) => {
            return 'Hello from worker!';
        });
        `;

        // Save the worker code to my-worker.js in your Puter account
        await puter.fs.write('my-worker.js', workerCode);

        // 2. Deploy the worker using the file path
        const workerName = puter.randName();
        puter.print(`→ Deploying ${workerName} worker. May take up to 10 seconds to deploy.<br>`);
        const deployment = await puter.workers.create(workerName, 'my-worker.js');
        
        // 3. Test the worker
        puter.print(`→ Wait 5 seconds before testing the worker to make sure it's propagated.<br>`);

        setTimeout(async ()=>{
            const response = await fetch(`${deployment.url}/api/hello`);
            puter.print('→ Test response: ', await response.text());
        }, 5000);
    })();
    </script>
</body>
</html>
```

## Updating a worker

A worker keeps the same name and URL for its whole lifetime. You create it once with `create()`; after that, you **update it by overwriting its source file**, not by creating a new worker.

[`puter.workers.get()`](/Workers/get/) returns the worker's [`file_path`](/Objects/workerinfo), so you can write your new code back to it:

```js
// Look up the deployed worker's source file
const info = await puter.workers.get('my-api');

// Overwrite it with your new code — this redeploys the worker
// at the same name and URL
await puter.fs.write(info.file_path, updatedWorkerCode);
```

The worker redeploys from that file, so `https://my-api.puter.work` keeps serving — now running your updated code. Anything already calling the worker keeps working without changes.