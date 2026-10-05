---
title: Return Clear Errors from a Worker
description: "Learn how to check the input to a Puter.js serverless worker and answer with the right status code, so your app knows what went wrong."
tags: [workers]
order: 41
---

When something goes wrong in a [serverless worker](/Workers/), the caller should
learn what happened from the response: a `400` when the input is bad, a `401`
when nobody is signed in, a `404` when the thing they asked for is not there.
Your app can then show a useful message instead of a generic failure.

A worker only does part of this on its own. This recipe covers what the
[`router`](/Workers/router/) does when a handler fails, and how to answer with
your own errors instead.

## What Happens When a Handler Throws

If a handler throws, or a promise it awaits rejects, the worker catches it and
answers `500`. The body of that response is the error as text, such as
`SyntaxError: Unexpected end of JSON input`.

That has two problems. The caller cannot tell a bad request apart from a bug in
your code, because both are `500`. And the error text can show details of your
code, or of a service the worker calls, to anyone calling the URL.

The most common cause is reading the body. `request.json()` throws when the body
is empty or is not valid JSON:

```js
router.post('/notes', async ({ request }) => {
    const { text } = await request.json();    // throws on a bad body: 500
    return { text };
});
```

## Answer With Your Own Errors

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

`user` is set whenever the request has a `puter-auth` header, and the header is
not checked until you use it. A request with a wrong or expired token still gets
a `user`, and the first call made with it rejects.

To answer `401` for that case, look up the user in a `try` block:

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

## Catch What You Did Not Expect

A call to another service can still fail in ways you cannot check up front. Wrap
that part and send the caller a short message instead of the raw error:

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

`502` tells the caller the worker itself is fine but something it depends on is
not, so trying again later may work.

## Answer Paths You Do Not Serve

A request to a path no route matches gets a `404` with a plain-text body, and so
does a request with a method you registered no route for. To keep the JSON shape
for these too, add a wildcard route for each method you use, at the end of the
file after every other route:

```js
router.get('/*path', async () => error(404, 'not found'));
router.post('/*path', async () => error(404, 'not found'));
```

Routes are tried in the order you register them, so a wildcard registered first
would answer every request.

## Read the Error in Your App

[`puter.workers.exec()`](/Workers/exec/) works like `fetch()`: it resolves for
every status code, so a `400` is not thrown. Check `res.ok` and read the message:

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
