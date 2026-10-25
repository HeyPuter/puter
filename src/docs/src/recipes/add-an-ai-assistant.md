---
title: Add an AI Assistant
description: "Learn how to add an AI chat assistant to your app with Puter.js, with its instructions kept in a serverless worker and each user's chats saved to their own account."
tags: [workers, ai, kv, auth]
order: 63
---

An AI assistant in your app is mostly instructions. A system prompt tells the
model what your app is, what to answer and what to refuse. If that prompt lives
in the browser, anyone can read it, change it, and use your assistant for
something else.

A [serverless worker](/Workers/) keeps the prompt on the server. The browser
only sends the user's message. The worker adds the instructions and the earlier
messages, asks the model, and saves the conversation.

The model call goes through `user.puter`, the Puter account of the user who is
chatting, so each user pays for their own messages under the
[User-Pays model](/user-pays-model/). Their chats are saved in their own
[key-value store](/KV/), not yours.

## Keep the Instructions in the Worker

Put the system prompt and the model settings at the top of the worker file. None
of it is sent to the browser:

```js
// assistant.js
const SYSTEM = `You are the help assistant for Acme Notes, a note-taking app.
Only answer questions about using Acme Notes. Keep answers under 120 words.`;

const MODEL = 'gpt-5.5';
const MAX_MESSAGES = 20;     // how much earlier conversation the model sees
const MAX_LENGTH = 2000;     // longest message a user may send

function error(status, message) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
```

To change how the assistant behaves, edit this file. Every user gets the new
instructions on their next message, with no app update.

## Read the Message

The route needs a signed-in user, because the model call is billed to them. Your
app calls it with [`puter.workers.exec()`](/Workers/exec/), which sends the
user's session along as `user`:

```js
router.post('/chat', async ({ request, user }) => {
    if (!user) {
        return error(401, 'sign in required');
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return error(400, 'body must be JSON');
    }

    const { message } = body;
    if (typeof message !== 'string' || message.trim().length === 0) {
        return error(400, 'message is required');
    }
    if (message.length > MAX_LENGTH) {
        return error(400, `message must be at most ${MAX_LENGTH} characters`);
    }
    const chatId = typeof body.chatId === 'string' ? body.chatId : crypto.randomUUID();

    // ...load the chat and ask the model, shown in the next sections
});
```

A request without a `chatId` starts a new chat. See
[Handle errors in a worker](/recipes/handle-worker-errors/) for the `error()`
helper and the checks.

## Load the Earlier Messages

Each chat is one entry in the user's key-value store, under `assistant:` and the
chat's ID. Read it with `user.puter.kv`:

```js
const key = `assistant:${chatId}`;
const chat = (await user.puter.kv.get(key)) ?? { title: message.slice(0, 60), messages: [] };
```

Because it is `user.puter`, the key is in that user's account. One user can
never load another user's chat, even with the right `chatId`.

## Ask the Model

Send the system prompt first, then the last few messages, then the new one, with
[`puter.ai.chat()`](/AI/chat/):

```js
chat.messages.push({ role: 'user', content: message });

let reply;
try {
    const response = await user.puter.ai.chat(
        [
            { role: 'system', content: SYSTEM },
            ...chat.messages.slice(-MAX_MESSAGES),
        ],
        { model: MODEL, normalize: true },
    );
    reply = response.message.content;
} catch {
    return error(502, 'the assistant could not answer right now, try again');
}
```

`normalize: true` makes `message.content` a plain string whichever model you
pick, so changing `MODEL` later doesn't change this code.

Only the last `MAX_MESSAGES` are sent, so a long chat doesn't make every new
message slower and more expensive. The system prompt is always added on top,
which is why it never falls out of the conversation.

## Save the Chat

Add the reply and write the chat back, then return the reply and the chat's ID:

```js
chat.messages.push({ role: 'assistant', content: reply });
chat.updatedAt = Date.now();
await user.puter.kv.set(key, chat);

return { chatId, reply };
```

Put these last three sections together, in order, inside the `/chat` route.

A key-value entry has a size limit, and a chat grows with every message. For
chats that run to hundreds of messages, see
[Split a large value across keys](/recipes/split-a-large-value/).

## Deploy the Worker

Save `assistant.js` to your Puter account and create the worker once, which
gives it an address such as `https://acme-assistant.puter.work`. See
[deployment](/Workers/#deployment) for the steps.

## Chat From Your App

Call the worker with [`puter.workers.exec()`](/Workers/exec/). It takes the same
arguments as `fetch()`, and asks the user to sign in first if they haven't:

```js
const API = 'https://acme-assistant.puter.work';
let chatId = null;

async function send(message) {
    const res = await puter.workers.exec(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error);
    }

    chatId = data.chatId;   // keep talking in the same chat
    return data.reply;
}

await send('How do I share a note?');
await send('And can I undo that?');   // the model sees the first question too
```

## List Past Chats

When a worker is called from your app, `user.puter.kv` is the same key-value
store your app reads with [`puter.kv`](/KV/). So the app can list the user's
chats directly, without a worker route:

```js
const chats = await puter.kv.list('assistant:', true);

const sidebar = chats
    .map(row => ({ chatId: row.key.slice('assistant:'.length), ...row.value }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
```

Set `chatId` to one of these to carry on that chat, and delete one with
[`puter.kv.del()`](/KV/del/).

## Notes

- Saved chats belong to the user, and they can edit them, for example to change
  what the assistant "said" earlier. That only changes their own chat. The system
  prompt is always added by the worker, so they can't remove it.
- To pay for the model yourself instead, call `me.puter.ai.chat()`. Every
  message is then billed to you, so add a per-user limit like the one in
  [Keep an API key secret](/recipes/keep-api-key-secret/).
