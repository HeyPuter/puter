---
title: Serverless Workers
description: Run and manage serverless JavaScript funcitons in the cloud.
---

Serverless Workers are serverless functions that run JavaScript code in the cloud.

## Router

Workers use a router-based system to handle HTTP requests and can integrate with Puter's cloud services like file storage, key-value databases, and AI APIs. Workers are perfect for building backend services, REST APIs, webhooks, and data processing pipelines.

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

Once your worker is ready, you can put it online on a free `*.puter.work` subdomain. You can publish it manually in a few clicks, or automatically from your GitHub repository.

### Publish from puter.com

The quickest way to publish a worker is to create it on [puter.com](https://puter.com) and publish it.

1. Create a `.js` file containing your worker code.

<figure style="margin: 30px 0;">
    <img src="https://developer.puter.com/assets/img/workers/code.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
</figure>

2. Right-click the file and choose **Publish as Worker**.

<figure style="margin: 30px 0;">
    <img src="https://developer.puter.com/assets/img/workers/publish-workers.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
</figure>

3. Pick a name and click **Publish**. Your worker is live at `https://your-worker.puter.work`.

<figure style="margin: 30px 0;">
    <img src="https://developer.puter.com/assets/img/workers/published.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
</figure>

<!-- ### Automate with GitHub Actions

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
        uses: HeyPuter/puter-worker-deploy-action@v1
        with:
          worker_name: my-api             # publishes to my-api.puter.work
          source_path: worker             # the folder containing your worker
          entry_file: index.js            # the worker's entry file
          puter_path: ~/workers/my-api    # where to store the files on Puter
          puter_token: ${{ secrets.PUTER_TOKEN }}
```

<div class="info">Store your Puter auth token as a GitHub Actions secret named <code>PUTER_TOKEN</code>. See the <a href="https://github.com/HeyPuter/puter-worker-deploy-action">action's README</a> for how to obtain a token and for the full list of options.</div> -->
