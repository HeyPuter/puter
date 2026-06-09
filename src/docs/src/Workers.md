---
title: Serverless Workers
description: Run and manage serverless JavaScript funcitons in the cloud.
---

Serverless Workers are serverless functions that run JavaScript code in the cloud.

Workers run server-side, which makes them a good fit for centralized application data and backend logic. See [Integration with Puter.js](/Workers/router/#integration-with-puter-js) for how worker code accesses Puter resources.

## Router

Workers use a router-based system to handle HTTP requests and can integrate with Puter's cloud services like file storage, key-value databases, and AI APIs. Workers are perfect for building backend services, REST APIs, webhooks, shared data stores, and data processing pipelines.

### Examples

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="hello"><span>Hello World</span></div>
    <div class="example-group" data-section="json"><span>POST request</span></div>
    <div class="example-group" data-section="url-params"><span>URL Parameters</span></div>
    <div class="example-group" data-section="json-resp"><span>JSON Response</span></div>
    <div class="example-group" data-section="integration"><span>Puter.js API Integration</span></div>
</div>

<div class="example-content" data-section="hello" style="display:block;">

#### Simple GET endpoint

```js
// Simple GET endpoint
router.get("/api/hello", async ({ request }) => {
  return { message: "Hello, World!" };
});
```

</div>

<div class="example-content" data-section="json">

#### Handle POST request and get JSON body

```js
router.post("/api/user", async ({ request }) => {
  // Get JSON body
  const body = await request.json();
  return { processed: true };
});
```

</div>

<div class="example-content" data-section="url-params">

#### Using `:paramName` in route path to capture dynamic segments

```js
// Dynamic route with parameters
router.get("/api/posts/:category/:id", async ({ request, params }) => {
  const { category, id } = params;
  return { category, id };
});
```

</div>

<div class="example-content" data-section="json-resp">

#### Return JSON response

```js
router.get("/api/simple", async ({ request }) => {
  return { status: "ok" }; // Automatically converted to JSON
});
```

</div>

<div class="example-content" data-section="integration">

#### Integrate with any Puter.js API

```js
router.post("/api/kv/set", async ({ request }) => {
  const { key, value } = await request.json();

  if (!key || value === undefined) {
    return new Response(JSON.stringify({ error: "Key and value required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await me.puter.kv.set("myscope_" + key, value); // add a mandatory prefix so this wont blindly read the KV of the user's other data
  return { saved: true, key };
});

router.get("/api/kv/get/:key", async ({ request, params }) => {
  const key = params.key;
  const value = await me.puter.kv.get("myscope_" + key); // use the same prefix

  if (!value) {
    return new Response(JSON.stringify({ error: "Key not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { key, value: value };
});
```

</div>

### Object

- **[`router`](/Workers/router/)** - The router object for handling HTTP requests

### Tutorials

- [How to Run Serverless Functions on Puter](https://developer.puter.com/tutorials/serverless-functions-on-puter/)

## Workers API

In addition, the Puter.js Workers API lets you create, manage, and execute these workers programmatically. The API provides comprehensive management features including create, delete, list, get, and execute worker.

### Functions

These workers management features are supported out of the box when using Puter.js:

- **[`puter.workers.create()`](/Workers/create/)** - Create a new worker
- **[`puter.workers.delete()`](/Workers/delete/)** - Delete a worker
- **[`puter.workers.list()`](/Workers/list/)** - List all workers
- **[`puter.workers.get()`](/Workers/get/)** - Get information about a specific worker
- **[`puter.workers.exec()`](/Workers/exec/)** - Execute a worker

### Examples

You can see various Puter.js workers management features in action from the following examples:

- [Create a worker](/playground/workers-create/)
- [List workers](/playground/workers-list/)
- [Get a worker](/playground/workers-get/)
- [Workers Management](/playground/workers-management/)
- [Authenticated Worker Requests](/playground/workers-exec/)

## Deployment

Once your worker is ready, you can put it online on a free `*.puter.work` subdomain.

<div class="info">A worker is created once and keeps its name and URL. To ship changes, overwrite its source file rather than creating a new worker — see <a href="/Workers/create/#updating-a-worker">Updating a worker</a>.</div>

### Publish from puter.com

The quickest way to publish a worker is to create it on [puter.com](https://puter.com) and publish it.

<ol>
    <li>
        Create a <code>.js</code> file containing your worker code.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/workers/code.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
    <li>
        Right-click the file and choose <strong>Publish as Worker</strong>.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/workers/publish-workers.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
    <li>
        Pick a name and click <strong>Publish</strong>. Your worker is live at <code>https://your-worker.puter.work</code>.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/workers/published.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
</ol>

### Deploy with the Puter CLI

You can also deploy straight from the terminal with the [Puter CLI](https://www.npmjs.com/package/@heyputer/cli).

Install it globally:

```
npm install -g @heyputer/cli
```

Then deploy your worker's JavaScript file to a `*.puter.work` subdomain:

```
puter worker deploy [file] [name]
```

Both arguments are optional — run `puter worker deploy` with no arguments and the CLI prompts you for the file and worker name.

<div class="info">The Puter CLI is currently in beta (0.x), so commands and behavior may change.</div>

### Automate with GitHub Actions

If your worker's code lives on GitHub, you can redeploy it automatically on every push using the [Puter Worker Deploy Action](https://github.com/HeyPuter/puter-worker-deploy-action).

Add a workflow file at `.github/workflows/deploy-worker.yml`:

```yaml
name: Deploy Worker to Puter

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy worker
        uses: HeyPuter/puter-worker-deploy-action@v1.0.1
        with:
          worker_name: my-api             # publishes to my-api.puter.work
          puter_path: ~/Workers/my-api/   # where to store the files on Puter
          source_path: worker             # the folder containing your worker
          entry_file: index.js            # the worker's entry file
          puter_token: ${{ secrets.PUTER_TOKEN }}
```

<div class="info">Create a new repository secret named <code>PUTER_TOKEN</code> and set its value to your Puter auth token (see <a href="https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository">creating secrets for a repository</a>). To get your auth token, follow the <a href="https://developer.puter.com/tutorials/puter-auth-token/">Puter auth token tutorial</a>.</div>
