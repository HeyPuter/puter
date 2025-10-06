Puter workers use a router-based system to handle HTTP requests. The `router` object is automatically available in your worker code and provides methods to define API endpoints.

<br>


## Syntax
```js
router.post('/my-endpoint', async ({ request, user, params }) => {
    return { message: 'Hello, World!' };
});
```

## Handler Parameters

Route handlers receive structured parameters:

- `request` - The incoming [HTTP request](https://developer.mozilla.org/en-US/docs/Web/API/Request).
- `user` - The user object, contains `user.puter` (available when called via [`puter.workers.exec()`](/Workers/exec/))
  - `user.puter` - The user's Puter resources (KV, FS, AI, etc.)
- `params` - URL parameters (for dynamic routes)
- `me` - The deployer's Puter object (your own Puter resources for KV, FS, AI, etc.)



## Available Global Objects

When writing worker code, you have access to several global objects:

- `router` - The router object for defining API endpoints
- `me.puter` - The deployer's Puter object (your own Puter resources for KV, FS, AI, etc.)

**Note**: `me.puter` refers to the deployer's (your) Puter resources, while `user.puter` refers to the user's resources when they execute your worker with their own token.

## Router Basics

The router object supports standard HTTP methods and provides a clean way to organize your API endpoints.

### Available HTTP Methods

- `router.get(path, handler)` - Handle GET requests
- `router.post(path, handler)` - Handle POST requests  
- `router.put(path, handler)` - Handle PUT requests
- `router.delete(path, handler)` - Handle DELETE requests
- `router.options(path, handler)` - Handle OPTIONS requests

## Basic Router Structure

```js
// Simple GET endpoint
router.get('/api/hello', async ({ request }) => {
    return { message: 'Hello, World!' };
});
```

The example above is a simple GET endpoint that returns a JSON object with a message.


### Accessing Request Data

You can access the request data in the handler function. A request can be a JSON body, form data, URL parameters, or headers.

<strong class="example-title">JSON Body</strong>
```js
router.post('/api/user', async ({ request }) => {
    // Get JSON body
    const body = await request.json();
    return { processed: true };
});
```

<strong class="example-title">Form Data</strong>
```js
router.post('/api/user', async ({ request }) => {
    // Get form data
    const formData = await request.formData();
    return { processed: true };
});
```

<strong class="example-title">URL Parameters</strong>
```js
router.post('/api/user*tag', async ({ request }) => {
    // Get URL parameters
    const url = new URL(request.url);
    const queryParam = url.searchParams.get('param');
    return { processed: true };
});
```

<strong class="example-title">Headers</strong>
```js
router.post('/api/user', async ({ request }) => {
    // Get headers
    const contentType = request.headers.get('content-type');
    return { processed: true };
});
```

## URL Parameters

Use `:paramName` in your route path to capture dynamic segments:

```js
// Dynamic route with parameters
router.get('/api/posts/:category/:id', async ({request, params }) => {
    const { category, id } = params;
    return { category, id };
});
```

## Response Types


<strong class="example-title">JSON</strong>
```js
router.get('/api/simple', async ({ request }) => {
    return { status: 'ok' }; // Automatically converted to JSON
});
```

<strong class="example-title">Plain Text</strong>
```js
router.get('/api/text', async ({ request }) => {
    return 'Hello World'; // Returns plain text
});
```

<strong class="example-title">Blob</strong>
```js
router.get('/api/blob', async ({ request }) => {
    return new Blob(['Hello World'], { type: 'text/plain' });
});
```

<strong class="example-title">Uint8Array</strong>
```js
router.get('/api/uint8array', async ({ request }) => {
    return new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
});
```

<strong class="example-title">Binary stream</strong>
```js
router.get('/api/binary-stream', async ({ request }) => {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]));
            controller.close();
        }
    });
});
```

<strong class="example-title">Custom Response Objects</strong>
```js
router.get('/api/custom', async ({ request }) => {
    return new Response(JSON.stringify({ data: 'custom' }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Custom-Header': 'value'
        }
    });
});
```

### Returning custom error responses

You can also return custom error responses. To do so, you can use the `Response` object and set the status code and headers.

```js
router.post('/api/risky-operation', async ({ request }) => {
    try {
        const body = await request.json();
        const result = await someRiskyOperation(body);
        return { success: true, result };
    } catch (error) {
        return new Response(JSON.stringify({ 
            error: 'Operation failed',
            message: error.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});
```

## Integration with Puter Services

<strong class="example-title">File System Operations</strong>
```js
router.post('/api/upload', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
        return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const fileName = `upload-${Date.now()}-${file.name}`;
    await me.puter.fs.write(fileName, file);
    
    return {
        uploaded: true,
        fileName,
        originalName: file.name,
        size: file.size
    };
});
```

<strong class="example-title">Key-Value Store (NoSQL Database)</strong>

```js
router.post('/api/kv/set', async ({ request }) => {
    const { key, value } = await request.json();
    
    if (!key || value === undefined) {
        return new Response(JSON.stringify({ error: 'Key and value required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    await me.puter.kv.set("myscope_" + key, value); // add a mandatory prefix so this wont blindly read the KV of the user's other data
    return { saved: true, key };
});

router.get('/api/kv/get/:key', async ({ request, params }) => {
    const key = params.key;
    const value = await me.puter.kv.get("myscope_" + key); // use the same prefix
    
    if (!value) {
        return new Response(JSON.stringify({ error: 'Key not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    return { key, value: value };
});
```

<strong class="example-title">AI</strong>

```js
router.post('/api/chat', async ({ request, user }) => {
    const { message } = await request.json();
    
    if (!message) {
        return new Response(JSON.stringify({ error: 'Message required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Require user authentication to prevent abuse
    if (!user || !user.puter) {
        return new Response(JSON.stringify({ 
            error: 'Authentication required',
            message: 'This endpoint requires user authentication. Call this worker via puter.workers.exec() with your user token to use your own AI resources.'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        // Use user's AI resources
        const aiResponse = await user.puter.ai.chat(message);
        
        // Store chat history in developer's KV for analytics
        const chatHistory = {
            userId: user.id || 'unknown',
            message,
            response: aiResponse,
            timestamp: new Date().toISOString(),
            usedUserAI: true
        };
        await me.puter.kv.set(`chat_${Date.now()}`, (chatHistory));
        
        return {
            originalMessage: message,
            aiResponse,
            usedUserAI: true
        };
    } catch (error) {
        return new Response(JSON.stringify({ 
            error: 'AI service error',
            message: error.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});
```

## User Resources Integration

The `user` object is available when the worker is executed via `puter.workers.exec()` in the frontend and contains the user's own Puter resources. This allows you to use the user's resources (KV, FS, AI, etc.) instead of your own.


## 404 Handler

Always include a catch-all route for unmatched paths:

```js
router.get('/*page', async ({ request, params }) => {
    const requestedPath = params.page;
    
    return new Response(JSON.stringify({
        error: 'Not found',
        path: requestedPath,
        message: 'The requested endpoint does not exist',
        availableEndpoints: [
            '/api/hello',
            '/api/data',
            '/api/upload'
        ]
    }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
});
```

## Complete Example

Here's a complete worker with multiple endpoints demonstrating various router patterns:

```js
// Health check
router.get('/health', async () => {
    return {
        status: 'ok',
        timestamp: new Date().toISOString()
    };
});

// User management API
router.post('/api/users', async ({ request, user }) => {
    const userInfo = await user.puter.getUser();
    
    // Store user data
    const userId = `user_${Date.now()}`;
    await me.puter.kv.set(userId, {email: userInfo.email, name: userInfo.username});
    
    return { userId, user: {email: userInfo.email, username: userInfo.username, uuid: userInfo.uuid} };
});

router.get('/api/users/:id', async ({ params }) => {
    const userId = params.id;
    if (!userId.startsWith("user_")) // security check
        return new Response("Invalid userID!")
    const userData = await me.puter.kv.get(userId);
    
    if (!userData) {
        return new Response(JSON.stringify({ 
            error: 'User not found' 
        }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    return { userId, user: userData };
});

// File operations
router.post('/api/files/upload', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
        return new Response(JSON.stringify({ 
            error: 'No file provided' 
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const fileName = `upload-${Date.now()}-${file.name}`;
    await me.puter.fs.write(fileName, file);
    
    return {
        uploaded: true,
        fileName,
        originalName: file.name,
        size: file.size
    };
});

// 404 handler
router.get('/*tag', async ({ params }) => {
    return new Response(JSON.stringify({
        error: 'Not found',
        path: params.tag,
        availableEndpoints: ['/health', '/api/users', '/api/files/upload']
    }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
});
```

## Testing Your Router

After deploying your worker, test your endpoints:

```js
// Test your worker endpoints
const workerUrl = 'https://your-worker.puter.work';

// Test GET endpoint
const response = await puter.workers.exec(`${workerUrl}/api/hello`);
const data = await response.json();
console.log(data);

// Test POST endpoint
const postResponse = await puter.workers.exec(`${workerUrl}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'test', value: 'hello' })
});
const postData = await postResponse.json();
console.log(postData);
```
