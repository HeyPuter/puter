---
title: Add an AI Assistant
description: "Learn how to add an AI chat assistant with Puter.js, so users can ask about your app and continue their saved conversations."
tags: [workers, ai, kv, auth]
order: 63
---

An assistant uses a system prompt to describe your app and guide its answers.
A [serverless worker](/Workers/) keeps those instructions out of the browser's
source code. The app sends a message, and the worker adds the instructions and
saved context before calling AI.

The worker calls AI through [`user.puter`](/Workers/router/#integration-with-puter-js),
the signed-in caller's Puter.js instance. Each user pays for their own messages
under the [User-Pays model](/user-pays-model/), and their saved context belongs
to them.
For public instructions, call [`puter.ai.chat()`](/AI/chat/) directly from the
browser as in [Keep a Long AI Conversation](/recipes/keep-a-long-ai-conversation/).

## Ask With Private Instructions

Start with a signed-in worker route that adds your system prompt:

```js
router.post('/chat', async ({ request, user }) => {
    if (!user) return new Response('Sign in to Puter.', { status: 401 });
    const { message } = await request.json();
    const response = await user.puter.ai.chat([
        { role: 'system', content: 'Help users of Acme Notes. Keep replies brief.' },
        { role: 'user', content: message },
    ], { model: 'claude-sonnet-4-6', normalize: true, compaction: true });
    return { reply: response.message.content };
});
```

A worker hides the source of instructions. Keep credentials out of prompts,
since a model can repeat instructions in its reply. The route gets input checks
and a caller check in [Check the Request](#check-the-request).

## Keep Context With Compaction

Enable [compaction](/AI/chat/#compaction) on every call. When a response
includes `compaction`, replace the earlier model context with that artifact as
the first content block of its assistant turn, followed by the reply from the
same turn. Send the artifact back unchanged to the same model on the next
request.

This version of the route keeps each chat's context in one entry of the caller's
[key-value store](/KV/). A request without a `chatId` starts a new chat:

```js
const SYSTEM = `You are the help assistant for Acme Notes, a note-taking app.
Answer questions about Acme Notes. Keep answers under 120 words.`;
const MODEL = 'claude-sonnet-4-6';

router.post('/chat', async ({ request, user }) => {
    if (!user) return new Response('Sign in to Puter.', { status: 401 });
    const body = await request.json();
    const message = body.message;
    const chatId = body.chatId ?? crypto.randomUUID();
    const kv = user.puter.kv;
    const key = `assistant:${chatId}`;
    const chat = (await kv.get(key)) ?? { title: message.slice(0, 60), context: [] };
    const messages = [...chat.context, { role: 'user', content: message }];
    const response = await user.puter.ai.chat([
        { role: 'system', content: SYSTEM }, ...messages,
    ], { model: MODEL, normalize: true, compaction: true, max_tokens: 1024 });
    const reply = response.message.content;
    chat.context = response.compaction
        ? [{ ...response.message, content: [
            response.compaction, ...(reply ? [{ type: 'text', text: reply }] : []),
        ] }]
        : [...messages, response.message];
    await kv.set(key, chat);
    return { chatId, reply };
});
```

The text block is left out when the reply has no text.

The worker uses a model with native compaction. Claude models on the
[Anthropic availability list](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold#availability)
and OpenAI Responses models support it. The model catalog doesn't say which
models support compaction. For other models, such as Gemini, use the manual
summary in [Keep a Long AI Conversation](/recipes/keep-a-long-ai-conversation/#summarize-for-another-model).
That recipe also includes a transcript search tool.

Keep the system prompt byte-identical and first on each request, with changing
messages last. Compaction starts only when context reaches the model's
threshold.

## Save the Context in Small Keys

Store active model context in small parts with [`puter.kv.set()`](/KV/set/).
The `saveChat()` function writes the new parts, publishes their keys in one
metadata entry, then deletes the old parts. The split keeps each entry under the
[value size limit](/rate-limits-and-quotas/#key-value-store) and lets the app
list only the small metadata entries.
[Split a Large Value Across Keys](/recipes/split-a-large-value/) explains this
storage pattern.

The function stores a chat's context in at most 100 parts, an application
choice. A larger context fails with the `chat_full` code, and the app then
starts a new chat:

```js
const MAX_PARTS = 100;

async function saveChat(kv, key, chat, oldKeys) {
    const json = JSON.stringify(chat);
    const version = crypto.randomUUID();
    const parts = [];
    for (let start = 0; start < json.length; start += 8000) {
        parts.push(json.slice(start, start + 8000));
    }
    if (parts.length > MAX_PARTS) {
        throw Object.assign(new Error('Chat storage is full. Start a new chat.'), { code: 'chat_full' });
    }
    const items = parts.map((value, index) => ({
        key: `assistant-data:${version}:${index}`, value,
    }));
    await kv.set(items);
    await kv.set(key, {
        title: chat.title, updatedAt: Date.now(), partKeys: items.map(item => item.key),
    });
    try {
        for (const oldKey of oldKeys) await kv.del(oldKey);
    } catch {
        console.error('Old chat parts were not deleted');
    }
}
```

The function deletes the old parts one key at a time, since
[`puter.kv.del()`](/KV/del/) removes one key per call. By then the reply is paid
for and saved, so a failed delete is logged and the request still succeeds. It
only leaves unused parts behind.

The route reads the metadata entry, loads the parts it names with
[`puter.kv.get()`](/KV/get/), and saves through `saveChat()`. An entry without
`partKeys` holds a whole chat in one value, with its context under `context` as
in the previous section, or under `messages`. The route continues that chat and
saves it in parts:

```js
router.post('/chat', async ({ request, user }) => {
    if (!user) return new Response('Sign in to Puter.', { status: 401 });
    const body = await request.json();
    const message = body.message;
    const chatId = body.chatId ?? crypto.randomUUID();
    const kv = user.puter.kv;
    const key = `assistant:${chatId}`;
    const stored = await kv.get(key);
    const oldKeys = stored?.partKeys ?? [];
    let chat = { title: message.slice(0, 60), context: [] };
    if (stored?.partKeys) {
        chat = JSON.parse((await kv.get(oldKeys)).join(''));
    } else if (stored) {
        chat = { title: stored.title, context: stored.context ?? stored.messages ?? [] };
    }
    const messages = [...chat.context, { role: 'user', content: message }];
    const response = await user.puter.ai.chat([
        { role: 'system', content: SYSTEM }, ...messages,
    ], { model: MODEL, normalize: true, compaction: true, max_tokens: 1024 });
    const reply = response.message.content;
    chat.context = response.compaction
        ? [{ ...response.message, content: [
            response.compaction, ...(reply ? [{ type: 'text', text: reply }] : []),
        ] }]
        : [...messages, response.message];
    await saveChat(kv, key, chat, oldKeys);
    return { chatId, reply };
});
```

This building block saves the active context. For a full transcript that stays
available after compaction, use the archive in
[Keep a Long AI Conversation](/recipes/keep-a-long-ai-conversation/). A compacted
context is a model continuation, not a transcript for the user to read.

Send one request at a time per chat. The `send()` function in
[Chat From the App](#chat-from-the-app) prevents overlapping sends in that page.
Independent tabs should create separate chats. The metadata update isn't a
distributed lock, so concurrent writers can replace each other's context.

## Check the Request

The route calls a paid service for the caller, so check the request before the
AI call. Look up the caller with [`user.puter.getUser()`](/Auth/getUser/), which
rejects when the session has expired.
[Handle Errors in a Worker](/recipes/handle-worker-errors/#check-who-is-calling)
explains that check. Limit the message length and the format of `chatId`, and
treat a reply that didn't finish as a failure.

Failures return JSON with a `code` and a `message` through the `error()` helper.
The codes in `actionable` tell the user what to do, so the route passes them to
the app. Any other failure is logged and returned as `assistant_failed`:

```js
const MAX_LENGTH = 2000;

function error(status, code, message) {
    return new Response(JSON.stringify({ code, message }), {
        status, headers: { 'Content-Type': 'application/json' },
    });
}

router.post('/chat', async ({ request, user }) => {
    if (!user) return error(401, 'auth_required', 'Sign in to Puter.');
    let caller;
    try {
        caller = await user.puter.getUser();
    } catch {
        return error(401, 'auth_required', 'Sign in to Puter.');
    }
    if (!caller) return error(401, 'auth_required', 'Sign in to Puter.');
    let body;
    try {
        body = await request.json();
    } catch {
        return error(400, 'invalid_input', 'Body must be JSON.');
    }
    const message = body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_LENGTH) {
        return error(400, 'invalid_input', `Enter 1 to ${MAX_LENGTH} characters.`);
    }
    const chatId = body.chatId ?? crypto.randomUUID();
    if (typeof chatId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(chatId)) {
        return error(400, 'invalid_input', 'Invalid chat ID.');
    }
    try {
        const kv = user.puter.kv;
        const key = `assistant:${chatId}`;
        const stored = await kv.get(key);
        const oldKeys = stored?.partKeys ?? [];
        let chat = { title: message.slice(0, 60), context: [] };
        if (stored?.partKeys) {
            chat = JSON.parse((await kv.get(oldKeys)).join(''));
        } else if (stored) {
            chat = { title: stored.title, context: stored.context ?? stored.messages ?? [] };
        }
        const messages = [...chat.context, { role: 'user', content: message }];
        const response = await user.puter.ai.chat([
            { role: 'system', content: SYSTEM }, ...messages,
        ], { model: MODEL, normalize: true, compaction: true, max_tokens: 1024 });
        const reply = response.message.content;
        if (response.finish_reason !== 'stop' || typeof reply !== 'string') {
            throw new Error(`Reply incomplete: ${response.finish_reason}`);
        }
        chat.context = response.compaction
            ? [{ ...response.message, content: [
                response.compaction, ...(reply ? [{ type: 'text', text: reply }] : []),
            ] }]
            : [...messages, response.message];
        await saveChat(kv, key, chat, oldKeys);
        return { chatId, reply };
    } catch (failure) {
        console.error('Assistant request failed', failure.code ?? 'assistant_failed');
        const actionable = ['auth_required', 'insufficient_funds', 'subscription_required', 'chat_full'];
        if (actionable.includes(failure.code)) {
            return error(400, failure.code, failure.message);
        }
        return error(502, 'assistant_failed', 'The assistant could not complete the request.');
    }
});
```

## Chat From the App

Save the worker as `assistant.js` and deploy it once to get its URL. The
[Workers deployment guide](/Workers/#deployment) covers the deployment steps.

Call the worker with [`puter.workers.exec()`](/Workers/exec/). On a website, it
opens the Puter sign-in window if needed and sends the caller's session to the
worker. Keep `chatId` to continue the saved conversation:

```js
const API = 'https://acme-assistant.puter.work';
let chatId = null;
let sending = false;

async function send(message) {
    if (sending) throw new Error('Wait for the current reply.');
    sending = true;
    try {
        const response = await puter.workers.exec(`${API}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, message }),
        });
        const data = await response.json();
        if (!response.ok) {
            const actions = {
                auth_required: 'Sign in to Puter to continue.',
                insufficient_funds: 'Add funds to your Puter account.',
                subscription_required: 'Choose a paid Puter plan.',
                chat_full: 'This chat is full. Your next message starts a new chat.',
            };
            if (data.code === 'chat_full') chatId = null;
            throw Object.assign(new Error(actions[data.code] ?? data.message), { code: data.code });
        }
        chatId = data.chatId;
        return data.reply;
    } catch (failure) {
        if (typeof failure === 'string') throw new Error(failure);
        throw failure;
    } finally {
        sending = false;
    }
}

console.log(await send('How do I share a note?'));
console.log(await send('And can I undo that?'));
```

Show a rejected `send()` call's message in your UI. Sign-in, funds, and
subscription failures tell the user what to do. Other failures stay visible,
and another billed call requires an explicit user action. A dismissed sign-in
window rejects [`puter.workers.exec()`](/Workers/exec/) with a string, which
`send()` turns into an `Error`.

## List Saved Chats

The app reads the same user-owned store with [`puter.kv.list()`](/KV/list/).
List metadata a page at a time and use a row's chat ID when sending again:

```js
for await (const page of puter.kv.list({
    pattern: 'assistant:', returnValues: true, stream: true, limit: 50,
})) {
    const chats = page.items.map(({ key, value }) => ({
        chatId: key.slice('assistant:'.length),
        title: value.title, updatedAt: value.updatedAt,
    }));
    console.log(chats);
}
```

Users can edit their own saved context. Treat it as conversation data and add
the system prompt in the worker on every call. To pay for calls yourself, use
[`me.puter`](/Workers/router/#integration-with-puter-js) only with a per-user
[`puter.kv.incr()`](/KV/incr/) limit in the owner's store.
[Keep an API Key Secret](/recipes/keep-api-key-secret/#limit-how-often-the-key-is-used)
shows the counter and expiry pattern.

## Full Code

The recipe has two programs. The worker, saved as `assistant.js`:

```js
const SYSTEM = `You are the help assistant for Acme Notes, a note-taking app.
Answer questions about Acme Notes. Keep answers under 120 words.`;
const MODEL = 'claude-sonnet-4-6';
const MAX_LENGTH = 2000;
const MAX_PARTS = 100;

function error(status, code, message) {
    return new Response(JSON.stringify({ code, message }), {
        status, headers: { 'Content-Type': 'application/json' },
    });
}

async function saveChat(kv, key, chat, oldKeys) {
    const json = JSON.stringify(chat);
    const version = crypto.randomUUID();
    const parts = [];
    for (let start = 0; start < json.length; start += 8000) {
        parts.push(json.slice(start, start + 8000));
    }
    if (parts.length > MAX_PARTS) {
        throw Object.assign(new Error('Chat storage is full. Start a new chat.'), { code: 'chat_full' });
    }
    const items = parts.map((value, index) => ({
        key: `assistant-data:${version}:${index}`, value,
    }));
    await kv.set(items);
    await kv.set(key, {
        title: chat.title, updatedAt: Date.now(), partKeys: items.map(item => item.key),
    });
    try {
        for (const oldKey of oldKeys) await kv.del(oldKey);
    } catch {
        console.error('Old chat parts were not deleted');
    }
}

router.post('/chat', async ({ request, user }) => {
    if (!user) return error(401, 'auth_required', 'Sign in to Puter.');
    let caller;
    try {
        caller = await user.puter.getUser();
    } catch {
        return error(401, 'auth_required', 'Sign in to Puter.');
    }
    if (!caller) return error(401, 'auth_required', 'Sign in to Puter.');
    let body;
    try {
        body = await request.json();
    } catch {
        return error(400, 'invalid_input', 'Body must be JSON.');
    }
    const message = body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_LENGTH) {
        return error(400, 'invalid_input', `Enter 1 to ${MAX_LENGTH} characters.`);
    }
    const chatId = body.chatId ?? crypto.randomUUID();
    if (typeof chatId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(chatId)) {
        return error(400, 'invalid_input', 'Invalid chat ID.');
    }
    try {
        const kv = user.puter.kv;
        const key = `assistant:${chatId}`;
        const stored = await kv.get(key);
        const oldKeys = stored?.partKeys ?? [];
        let chat = { title: message.slice(0, 60), context: [] };
        if (stored?.partKeys) {
            chat = JSON.parse((await kv.get(oldKeys)).join(''));
        } else if (stored) {
            chat = { title: stored.title, context: stored.context ?? stored.messages ?? [] };
        }
        const messages = [...chat.context, { role: 'user', content: message }];
        const response = await user.puter.ai.chat([
            { role: 'system', content: SYSTEM }, ...messages,
        ], { model: MODEL, normalize: true, compaction: true, max_tokens: 1024 });
        const reply = response.message.content;
        if (response.finish_reason !== 'stop' || typeof reply !== 'string') {
            throw new Error(`Reply incomplete: ${response.finish_reason}`);
        }
        chat.context = response.compaction
            ? [{ ...response.message, content: [
                response.compaction, ...(reply ? [{ type: 'text', text: reply }] : []),
            ] }]
            : [...messages, response.message];
        await saveChat(kv, key, chat, oldKeys);
        return { chatId, reply };
    } catch (failure) {
        console.error('Assistant request failed', failure.code ?? 'assistant_failed');
        const actionable = ['auth_required', 'insufficient_funds', 'subscription_required', 'chat_full'];
        if (actionable.includes(failure.code)) {
            return error(400, failure.code, failure.message);
        }
        return error(502, 'assistant_failed', 'The assistant could not complete the request.');
    }
});
```

The app code calls the worker and lists the saved chats:

```js
const API = 'https://acme-assistant.puter.work';
let chatId = null;
let sending = false;

async function send(message) {
    if (sending) throw new Error('Wait for the current reply.');
    sending = true;
    try {
        const response = await puter.workers.exec(`${API}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, message }),
        });
        const data = await response.json();
        if (!response.ok) {
            const actions = {
                auth_required: 'Sign in to Puter to continue.',
                insufficient_funds: 'Add funds to your Puter account.',
                subscription_required: 'Choose a paid Puter plan.',
                chat_full: 'This chat is full. Your next message starts a new chat.',
            };
            if (data.code === 'chat_full') chatId = null;
            throw Object.assign(new Error(actions[data.code] ?? data.message), { code: data.code });
        }
        chatId = data.chatId;
        return data.reply;
    } catch (failure) {
        if (typeof failure === 'string') throw new Error(failure);
        throw failure;
    } finally {
        sending = false;
    }
}

console.log(await send('How do I share a note?'));
console.log(await send('And can I undo that?'));

for await (const page of puter.kv.list({
    pattern: 'assistant:', returnValues: true, stream: true, limit: 50,
})) {
    const chats = page.items.map(({ key, value }) => ({
        chatId: key.slice('assistant:'.length),
        title: value.title, updatedAt: value.updatedAt,
    }));
    console.log(chats);
}
```
