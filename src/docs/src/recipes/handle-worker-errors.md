---
title: Handle Errors in a Worker
description: "Learn how to handle errors in a Puter.js serverless worker, so your app can show users what went wrong."
tags: [workers]
order: 41
---

Some requests to your [serverless worker](/Workers/) will fail. A user sends an
empty form, their session has expired, or a service the worker calls is down.
Your app needs to know which of these happened, so it can show the user the
right message.

A worker tells the caller what went wrong with the HTTP status code and the
response body. It answers `400` for bad input, `401` when the user is not signed
in, and `404` when the thing they asked for does not exist. The sections below
show how to return these errors from a worker, and how to read them in your app.

## What Happens When a Handler Throws

If a handler throws, or a promise it awaits rejects, the worker catches it and
answers `500`. The body of that response is the error as text, such as
`SyntaxError: Unexpected end of JSON input`.

That has two problems. The caller cannot tell a bad request apart from a bug in
your code, because both are `500`. And the error text can show details of your
code, or of a service the worker calls, to anyone calling the URL.

The most common cause is reading the body. The `request.json()` method throws
when the body is empty or is not valid JSON:

```js
router.post('/notes', async ({ request }) => {
    const { text } = await request.json();    // throws on a bad body: 500
    return { text };
});
```

## Return Your Own Errors

Give every error the same shape, so your app only has to read it one way. A
small helper builds the response:

```js
function error(status, message) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
```

Read the body in a `try` block, then check each field before you use it:

```js
router.post('/notes', async ({ request, user }) => {
    if (!user) {
        return error(401, 'sign in required');
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return error(400, 'body must be JSON');
    }

    const { text } = body;
    if (typeof text !== 'string' || text.trim().length === 0) {
        return error(400, 'text is required');
    }
    if (text.length > 1000) {
        return error(400, 'text must be at most 1000 characters');
    }

    const note = { id: crypto.randomUUID(), text, at: Date.now() };
    await user.puter.kv.set(`notes:${note.id}`, note);
    return note;
});
```

Check the type as well as the value. A body like `{ "text": 42 }` or
`{ "text": ["a"] }` is valid JSON, but `text.trim()` would throw on it.

## Check the User's Session

When your app calls the worker with [`puter.workers.exec()`](/Workers/exec/),
the request carries the user's Puter session, and the route gets a `user`. The
route gets a `user` even when the session is wrong or expired, because the
session is not checked until you use it. The first call made with it rejects.

To answer `401` in that case too, look up the user in a `try` block:

```js
async function getCaller(user) {
    if (!user) return null;
    try {
        return await user.puter.getUser();
    } catch {
        return null;
    }
}

router.get('/me', async ({ user }) => {
    const caller = await getCaller(user);
    if (!caller) {
        return error(401, 'sign in required');
    }

    return { username: caller.username };
});
```

## Catch Errors From Other Services

A call to another service can fail in ways you cannot check up front. Wrap that
call in a `try` block and send the caller a short message instead of the raw
error:

```js
router.post('/summary', async ({ request, user }) => {
    const caller = await getCaller(user);
    if (!caller) {
        return error(401, 'sign in required');
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return error(400, 'body must be JSON');
    }
    if (typeof body.text !== 'string' || body.text.length === 0) {
        return error(400, 'text is required');
    }

    try {
        const reply = await user.puter.ai.chat(`Summarize: ${body.text}`);
        return { summary: reply.message.content };
    } catch {
        return error(502, 'could not summarize right now, try again');
    }
});
```

A `502` tells the caller that the worker is fine but a service it depends on is
not, so trying again later may work.

## Return JSON for Unknown Paths

A request to a path that no route matches gets a `404` with a plain-text body,
and so does a request with a method that has no route. To return the same JSON
shape for these too, add a wildcard route for each method you use, at the end of
the file after every other route:

```js
router.get('/*path', async () => error(404, 'not found'));
router.post('/*path', async () => error(404, 'not found'));
```

Routes are tried in the order you register them, so a wildcard registered first
would answer every request.

## Read the Error in Your App

The [`puter.workers.exec()`](/Workers/exec/) method works like `fetch()`. It
resolves for every status code, so a `400` is not thrown. Check `res.ok` and
read the message:

```js
const res = await puter.workers.exec('https://notes-api.puter.work/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' }),
});

if (!res.ok) {
    const { error } = await res.json();    // 'text is required'
    alert(error);
} else {
    const note = await res.json();
}
```

It only rejects when there is no response to read, such as when the user is
offline or closes the sign-in window, so keep a `try` block around it for those
cases.
