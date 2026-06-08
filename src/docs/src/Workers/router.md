---
title: router
description: Handle HTTP requests with the router object with Puter Serverless Workers.
platforms: [workers]
---

Puter workers use a router-based system to handle HTTP requests. The `router` object is automatically available in your worker code and provides methods to define API endpoints.

## Syntax

```js
router.post("/my-endpoint", async ({ request, user, params }) => {
  return { message: "Hello, World!" };
});
```

## Router Basics

The router object supports standard HTTP methods and provides a clean way to organize your API endpoints.

### HTTP Methods

- `router.get(path, handler)` - Handle GET requests
- `router.post(path, handler)` - Handle POST requests
- `router.put(path, handler)` - Handle PUT requests
- `router.delete(path, handler)` - Handle DELETE requests
- `router.options(path, handler)` - Handle OPTIONS requests

### Handler Parameters

Route handlers receive a single object as their parameter, which can be destructured into the following properties:

- `request` - The incoming [HTTP request](https://developer.mozilla.org/en-US/docs/Web/API/Request).
- `user` - An object representing the user who made the request to this worker. It has a `puter` property (`user.puter`) that gives you access to that user's own Puter resources — KV, FS, AI, etc. Only available when the worker is called via [`puter.workers.exec()`](/Workers/exec/).
- `params` - Route parameters captured from the path (see [Route Parameters](#route-parameters))

## Global Objects

When writing worker code, you have access to these global objects:

- `router` - The router object for defining API endpoints
- `me` - An object representing you, the worker's owner. It has a `puter` property (`me.puter`) that gives you access to your own Puter resources — KV, FS, AI, etc.

## Integration with Puter.js

Just like in apps or websites, you can use Puter.js in workers to access AI, cloud storage, key-value stores, and databases.

The difference is *whose* resources you use. A worker gives you two `.puter` objects to work with, and operations are billed to whichever one you call:

- **`me.puter`** is the **worker context** — your own resources, as the owner. Use this for shared application data, server-side logic, and centralized resources you control. Operations run against your account and are billed to you.
- **`user.puter`** is the **user context** — the resources of the user who called the worker (available when it's executed via [`puter.workers.exec()`](/Workers/exec/), which runs it with their token). This keeps the default [User-Pays model](/user-pays-model/): each user's data stays in their own storage, billed to them, while your logic still runs server-side.

So you can mix and match within the same codebase — some endpoints reading and writing your own data (`me.puter`), others acting on the calling user's data (`user.puter`).

## Route Parameters

Sometimes part of a path isn't fixed — like a post ID or a username. You can capture these segments by prefixing them with a colon (`:`) in the route path. Each captured segment becomes a property on the `params` object, keyed by the name you gave it.

```js
router.get("/api/posts/:category/:id", async ({ params }) => {
  const { category, id } = params;
  return { category, id };
});
```

A request to `/api/posts/tech/42` matches this route and gives you:

- `params.category` → `"tech"`
- `params.id` → `"42"`

You can use as many route parameters as you need. Captured values are always strings, so convert them yourself if you expect a number.

## Wildcard Routes

While a route parameter (`:name`) matches a single segment, a **wildcard** (`*name`) matches the rest of the path — any number of segments. Like a route parameter, the matched value is available on `params`, keyed by the name after the `*`.

```js
router.get("/files/*path", async ({ params }) => {
  // A request to /files/images/avatars/me.png gives:
  // params.path === "images/avatars/me.png"
  return { path: params.path };
});
```

A wildcard **must be named** — write `*path` (or any name you like), not a bare `*`. A pattern like `/files/*` won't act as a wildcard: with no name after it, the `*` is treated as a literal character, so the route only matches the exact path `/files/*`. The name is what gives the router a key to expose the captured value on `params`.

A common use is a catch-all route for unmatched paths — define it last so it only runs when nothing else matched (see the [404 Handler](#examples) example below).

## CORS

Every response from your worker automatically includes `Access-Control-Allow-Origin: *`, so **simple cross-origin requests work out of the box** — a basic `GET` or `POST` from another origin just works, no extra code.

Some requests need a **CORS preflight** first: the browser sends an `OPTIONS` request and waits for the allowed methods and headers before sending the real one. This happens when the request uses a method like `PUT` or `DELETE`, or carries custom headers (e.g. `Authorization`).

To handle this, you can add an `OPTIONS` handler that returns the methods and headers you want to allow:

```js
router.options("/*path", async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, puter-auth",
    },
  });
});
```

This answers the preflight for any path with the CORS headers the browser expects, so your other routes work cross-origin.

<div class="info">The <code>puter-auth</code> header is important: when you call your worker with <a href="/Workers/exec/"><code>puter.workers.exec()</code></a>, it attaches the user's Puter token in a <code>puter-auth</code> header so the worker can act on the calling user's behalf (this is what populates <code>user.puter</code>). Because that's a custom header, the browser runs a preflight first — so <code>puter-auth</code> must be listed in <code>Access-Control-Allow-Headers</code>, otherwise the preflight fails and the request never reaches your worker.</div>

If you need different CORS rules per endpoint — for example, restricting the allowed methods or headers on a specific route — define an `OPTIONS` handler on that individual path instead of using the wildcard.

## Examples

<strong class="example-title">Basic Router Structure</strong>

The example above is a simple GET endpoint that returns a JSON object with a message.

```js
router.get("/api/hello", async ({ request }) => {
  // Simple GET endpoint
  return { message: "Hello, World!" };
});
```

<strong class="example-title">Accessing Request JSON Body</strong>

```js
router.post("/api/user", async ({ request }) => {
  // Get JSON body
  const body = await request.json();
  return { processed: true };
});
```

<strong class="example-title">Accessing Request Form Data</strong>

```js
router.post("/api/user", async ({ request }) => {
  // Get form data
  const formData = await request.formData();
  return { processed: true };
});
```

<strong class="example-title">Query Parameters</strong>

```js
router.get("/api/search", async ({ request }) => {
  // Read query string parameters from the URL
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  return { query };
});
```

<strong class="example-title">Accessing Request Headers</strong>

```js
router.post("/api/user", async ({ request }) => {
  // Get headers
  const contentType = request.headers.get("content-type");
  return { processed: true };
});
```

<strong class="example-title">Route Parameters</strong>

Use `:name` in your route path to capture route parameters:

```js
router.get("/api/posts/:category/:id", async ({ request, params }) => {
  const { category, id } = params;
  return { category, id };
});
```

<strong class="example-title">JSON Response</strong>

```js
router.get("/api/simple", async ({ request }) => {
  return { status: "ok" }; // Automatically converted to JSON
});
```

<strong class="example-title">Plain Text Response</strong>

```js
router.get("/api/text", async ({ request }) => {
  return "Hello World"; // Returns plain text
});
```

<strong class="example-title">Blob Response</strong>

```js
router.get("/api/blob", async ({ request }) => {
  return new Blob(["Hello World"], { type: "text/plain" });
});
```

<strong class="example-title">Uint8Array Response</strong>

```js
router.get("/api/uint8array", async ({ request }) => {
  return new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
});
```

<strong class="example-title">Binary Stream Response</strong>

```js
router.get("/api/binary-stream", async ({ request }) => {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])
      );
      controller.close();
    },
  });
});
```

<strong class="example-title">Custom Response Objects</strong>

```js
router.get("/api/custom", async ({ request }) => {
  return new Response(JSON.stringify({ data: "custom" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Custom-Header": "value",
    },
  });
});
```

<strong class="example-title">Returning Custom Error Responses</strong>

You can also return custom error responses. To do so, you can use the `Response` object and set the status code and headers.

```js
router.post("/api/risky-operation", async ({ request }) => {
  try {
    const body = await request.json();
    const result = await someRiskyOperation(body);
    return { success: true, result };
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Operation failed",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
```

<strong class="example-title">Worker Context vs User Context</strong>

The same operation can run against either Puter account. Here, one endpoint reads from the calling user's KV store (`user.puter`), the other from your own (`me.puter`).

```js
// Read from the calling user's KV store (user context)
router.get("/api/kv/user/get", async ({ request, user }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const value = await user.puter.kv.get(key);
  return { value };
});

// Read from the worker owner's KV store (worker context)
router.get("/api/kv/worker/get", async ({ request }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const value = await me.puter.kv.get(key);
  return { value };
});
```

<strong class="example-title">File System Integration</strong>

```js
router.post("/api/upload", async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileName = `upload-${Date.now()}-${file.name}`;
  await me.puter.fs.write(fileName, file);

  return {
    uploaded: true,
    fileName,
    originalName: file.name,
    size: file.size,
  };
});
```

<strong class="example-title">Key-Value Store (NoSQL Database) Integration</strong>

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

<strong class="example-title">AI Integration</strong>

```js
router.post("/api/chat", async ({ request, user }) => {
  const { message } = await request.json();

  if (!message) {
    return new Response(JSON.stringify({ error: "Message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Require user authentication to prevent abuse
  if (!user || !user.puter) {
    return new Response(
      JSON.stringify({
        error: "Authentication required",
        message:
          "This endpoint requires user authentication. Call this worker via puter.workers.exec() with your user token to use your own AI resources.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Use user's AI resources
    const aiResponse = await user.puter.ai.chat(message);

    // Store chat history in developer's KV for analytics
    const chatHistory = {
      userId: user.id || "unknown",
      message,
      response: aiResponse,
      timestamp: new Date().toISOString(),
      usedUserAI: true,
    };
    await me.puter.kv.set(`chat_${Date.now()}`, chatHistory);

    return {
      originalMessage: message,
      aiResponse,
      usedUserAI: true,
    };
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "AI service error",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
```

<strong class="example-title">404 Handler</strong>

Always include a catch-all route for unmatched paths:

```js
router.get("/*page", async ({ request, params }) => {
  const requestedPath = params.page;

  return new Response(
    JSON.stringify({
      error: "Not found",
      path: requestedPath,
      message: "The requested endpoint does not exist",
      availableEndpoints: ["/api/hello", "/api/data", "/api/upload"],
    }),
    {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }
  );
});
```

## Complete Example

Here's a complete worker with multiple endpoints demonstrating various router patterns:

```js
// Health check
router.get("/health", async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
});

// User management API
router.post("/api/users", async ({ request, user }) => {
  const userInfo = await user.puter.getUser();

  // Store user data
  const userId = `user_${Date.now()}`;
  await me.puter.kv.set(userId, {
    email: userInfo.email,
    name: userInfo.username,
  });

  return {
    userId,
    user: {
      email: userInfo.email,
      username: userInfo.username,
      uuid: userInfo.uuid,
    },
  };
});

router.get("/api/users/:id", async ({ params }) => {
  const userId = params.id;
  if (!userId.startsWith("user_"))
    // security check
    return new Response("Invalid userID!");
  const userData = await me.puter.kv.get(userId);

  if (!userData) {
    return new Response(
      JSON.stringify({
        error: "User not found",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return { userId, user: userData };
});

// File operations
router.post("/api/files/upload", async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return new Response(
      JSON.stringify({
        error: "No file provided",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const fileName = `upload-${Date.now()}-${file.name}`;
  await me.puter.fs.write(fileName, file);

  return {
    uploaded: true,
    fileName,
    originalName: file.name,
    size: file.size,
  };
});

// 404 handler
router.get("/*tag", async ({ params }) => {
  return new Response(
    JSON.stringify({
      error: "Not found",
      path: params.tag,
      availableEndpoints: ["/health", "/api/users", "/api/files/upload"],
    }),
    {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }
  );
});
```

## Testing Your Router

After deploying your worker, test your endpoints:

```js
// Test your worker endpoints
const workerUrl = "https://your-worker.puter.work";

// Test GET endpoint
const response = await puter.workers.exec(`${workerUrl}/api/hello`);
const data = await response.json();
console.log(data);

// Test POST endpoint
const postResponse = await puter.workers.exec(`${workerUrl}/api/data`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "test", value: "hello" }),
});
const postData = await postResponse.json();
console.log(postData);
```
