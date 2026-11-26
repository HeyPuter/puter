---
title: Build a Job Queue
description: "Learn how to hand slow work to a background queue with Puter.js, so it finishes even when the user closes your app, and show its progress while they watch."
tags: [events, kv]
order: 72
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work is too slow or too unreliable to do while the user waits, such as
fetching a web page, converting a file, or calling another service. On other
platforms you'd add a job queue and a worker process that takes jobs from it
one at a time and retries the ones that fail.

In Puter, a job is a key in the user's [key-value store](/KV/). A persistent
subscription with `queue: true` watches the job keys and runs your handler once
for each new one, in an [events worker](/Events/workers/), even when your app
is closed. The handler saves its result to another key, and the page watches
that key to show progress.

This recipe builds on
[Run Code in the Background](/recipes/run-code-in-the-background/), which
covers handlers and persistent subscriptions in more detail. The examples build
a reading list. The user saves a link, and a background job fetches the page's
title. The examples call three functions you'd write yourself. The `showLink()`
function draws one row, `removeLink()` removes it, and `reloadLinks()` draws
the whole list.

## Add a Job

Each saved link has two keys:

| Key | Holds |
| --- | --- |
| `link:<id>` | The URL, the title and a `status`, which your app shows |
| `job:<id>` | The work to do. It expires after a day |

Write both when the user saves a link:

```js
async function addLink (url) {
    const id = crypto.randomUUID();
    const tomorrow = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    await puter.kv.set(`link:${id}`, { url, status: 'queued', queuedAt: Date.now() });
    await puter.kv.set(`job:${id}`, { url }, tomorrow);
    return id;
}

await addLink('https://example.com/');
```

The handler runs for every change to a `job:` key, so it saves its result to
the `link:` key instead. A result written back to a `job:` key would be a new
change, which would run the handler again.

The third argument to [`puter.kv.set()`](/KV/set/) is when the key expires, as
a Unix time in seconds. The job key is deleted on its own a day later, long
after the job is done. Deleting it with [`puter.kv.del()`](/KV/del/) instead
would run the handler once more, for the delete.

## Publish the Handler

The handler is the function that does one job. Publish it once under a name
with [`puter.events.handlers.publish()`](/Events/handlers/), signed in as the
account that owns the app, from a deploy script or your browser console:

```js
const app = await puter.apps.get('reading-list');    // your app's name

async function fetchTitle ({ event, user, fetch }) {
    if (event.op !== 'set') return;

    const linkKey = `link:${event.key.slice('job:'.length)}`;
    const [job, link] = await user.kv.get([event.key, linkKey]);
    if (!job || !link) return;

    const res = await fetch(job.url);
    if (!res.ok) {
        await user.kv.update(linkKey, { status: 'failed' });
        return;
    }

    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() || job.url;
    await user.kv.update(linkKey, { status: 'done', title });
}

await puter.events.handlers.publish('fetchTitle', fetchTitle, { appUid: app.uid });
```

The handler gets one object. Its `event` is the change, with the `key` that
changed and an `op` of `set` for a write. Its `user` is a `puter` object signed
in as the user the job belongs to, and `fetch` makes HTTP requests. Puter saves
the code and runs it later in the events worker, so the handler can't use
anything defined outside it, including `puter`.
[Publish the Handler](/recipes/run-code-in-the-background/#publish-the-handler)
explains the rules, and
[Pass the Handler Inline](/recipes/run-code-in-the-background/#pass-the-handler-inline)
shows how to skip the publish step.

Passing an array of keys to [`puter.kv.get()`](/KV/get/) reads them in one
request. The link is `null` when the user removed it before the job ran, and
the handler then has nothing to do.
[`puter.kv.update()`](/KV/update/) changes only the fields it names, so the
link keeps its `url`.

## Start the Queue

Running code while your app is closed needs the user's permission. Ask for it
with [`puter.perms.request()`](/Perms/request/), then create the subscription
with [`puter.events.onPersistent()`](/Events/onPersistent/) unless the user
already has one:

```js
const options = {
    subject: `kv:${puter.appID}:job:*`,
    handlerName: 'fetchTitle',
    queue: true,
};

async function startQueue () {
    const subs = await puter.events.list();
    const existing = subs.find((s) =>
        s.subject === options.subject && s.handlerName === options.handlerName);
    if (existing && existing.suspendedReason !== 'permission_revoked') return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

if (await puter.perms.request('backgroundEvents')) await startQueue();
```

The subject ends with `*`, so it matches every key that starts with `job:`. The
keys contain `:`, so the subject starts with your app's id from
[`puter.appID`](/Utils/appID/), as
[Watch Several Keys](/recipes/watch-for-changes/#watch-several-keys) explains.

With `queue: true`, Puter hands the handler one job at a time and waits for it
to finish before sending the next. Jobs added while one is running wait in the
subscription, including while your app is closed.

Every [`onPersistent()`](/Events/onPersistent/) call creates a new
subscription, so `startQueue()` looks for an existing one with
[`puter.events.list()`](/Events/list/) first. Two subscriptions would run every
job twice. A subscription paused with `permission_revoked` never resumes, so
the function replaces it.
[Check on Subscriptions](/recipes/run-code-in-the-background/#check-on-subscriptions)
lists the other reasons a subscription can pause.

## Show Progress Live

The page shows each link's status by watching the `link:` keys with
[`puter.events.onLocal()`](/Events/onLocal/):

```js
await puter.events.onLocal(`kv:${puter.appID}:link:*`, async ({ event }) => {
    if (event.op === 'gap') return reloadLinks();
    if (event.op === 'del') return removeLink(event.key);

    const link = 'value' in event ? event.value : await puter.kv.get(event.key);
    if (link) showLink(event.key, link);
}, { includeValue: true });

await reloadLinks();
```

The handler's writes arrive here like any other change, so a row goes from
`queued` to `done` without the page asking. The page's own write in `addLink()`
arrives too, so `addLink()` doesn't need to draw anything. Here `reloadLinks()`
loads every link with [`puter.kv.list('link:', true)`](/KV/list/).

With `includeValue`, the event carries the key's new value. The value is
sometimes left out, so keep the fallback to [`puter.kv.get()`](/KV/get/).
[Watch for Changes](/recipes/watch-for-changes/) covers these subscriptions and
[gaps](/recipes/watch-for-changes/#handle-gaps).

## Retry a Job That Fails

A site can be down for a moment. To have Puter run a job again later, throw an
error with `retry: true` from the handler. This is the whole handler with that
added:

```js
async function fetchTitle ({ event, user, fetch }) {
    if (event.op !== 'set') return;

    const linkKey = `link:${event.key.slice('job:'.length)}`;
    const [job, link] = await user.kv.get([event.key, linkKey]);
    if (!job || !link) return;

    let res = null;
    try {
        res = await fetch(job.url);
    } catch {
        // The site can't be reached. Handled below.
    }

    if (res?.ok) {
        const html = await res.text();
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() || job.url;
        await user.kv.update(linkKey, { status: 'done', title });
        return;
    }

    const attempts = (link.attempts ?? 0) + 1;
    const temporary = !res || res.status === 429 || res.status >= 500;
    if (temporary && attempts < 3) {
        await user.kv.update(linkKey, { status: 'retrying', attempts });
        throw Object.assign(new Error('The site did not answer'), { retry: true });
    }

    await user.kv.update(linkKey, { status: 'failed', attempts });
}
```

An error with `retry: true` keeps the job in the queue, and Puter runs the
handler for it again after a wait that gets longer each time. Any other error
drops the job. A site that can't be reached, or answers `429` or a `5xx`, might
work in a minute, so the handler asks for a retry. A `404` won't change, so the
handler marks the link `failed` and returns.
[What happens when a handler fails](/Events/onPersistent/#what-happens-when-a-handler-fails)
lists the waits and every case.

While a job waits for its retry, the jobs behind it wait too. Each retry also
counts as a failed run, and five failed runs in a row pause the whole
subscription. So the handler counts its tries in the link, and gives up on the
third by returning without an error. The jobs behind it then run as usual.

A retried job has the same `event.id` as the first run, and a run that takes
too long can overlap its own retry. Fetching a title twice is harmless. For
work that must happen only once, such as sending a message, save the
`event.id` after doing it and skip ids you've saved, as in
[Pass Settings to the Handler](/recipes/run-code-in-the-background/#pass-settings-to-the-handler).

To update the published handler, call
[`handlers.list()`](/Events/handlers/) and publish again under the same name,
as in [Update the Handler](/recipes/run-code-in-the-background/#update-the-handler):

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('fetchTitle', fetchTitle, { appUid: app.uid });
```

## Run a Job Again

Writing the job key again is a new change, so the handler runs for it again.
Use that for a "Try again" button on a failed link:

```js
async function retryLink (id) {
    const link = await puter.kv.get(`link:${id}`);
    const tomorrow = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    await puter.kv.update(`link:${id}`, { status: 'queued', attempts: 0, queuedAt: Date.now() });
    await puter.kv.set(`job:${id}`, { url: link.url }, tomorrow);
}
```

A subscription also has a [limit on queued events per minute](/rate-limits-and-quotas/#delivery).
Jobs added faster than that, for example by importing hundreds of bookmarks at
once, are replaced by a gap marker and never reach the handler. When your app
opens, queue the links that are still waiting again:

```js
async function requeueStuck () {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const links = await puter.kv.list('link:', true);

    for (const { key, value } of links) {
        if (value.status === 'queued' && value.queuedAt < fiveMinutesAgo) {
            await retryLink(key.slice('link:'.length));
        }
    }
}

await requeueStuck();
```

For a large import, add the jobs a few at a time instead, and add more as the
links finish.

## Full Code

The recipe has two programs. The publish script runs as the app's developer,
from a deploy script or your browser console:

```js
const app = await puter.apps.get('reading-list');    // your app's name

async function fetchTitle ({ event, user, fetch }) {
    if (event.op !== 'set') return;

    const linkKey = `link:${event.key.slice('job:'.length)}`;
    const [job, link] = await user.kv.get([event.key, linkKey]);
    if (!job || !link) return;

    let res = null;
    try {
        res = await fetch(job.url);
    } catch {
        // The site can't be reached. Handled below.
    }

    if (res?.ok) {
        const html = await res.text();
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() || job.url;
        await user.kv.update(linkKey, { status: 'done', title });
        return;
    }

    const attempts = (link.attempts ?? 0) + 1;
    const temporary = !res || res.status === 429 || res.status >= 500;
    if (temporary && attempts < 3) {
        await user.kv.update(linkKey, { status: 'retrying', attempts });
        throw Object.assign(new Error('The site did not answer'), { retry: true });
    }

    await user.kv.update(linkKey, { status: 'failed', attempts });
}

await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('fetchTitle', fetchTitle, { appUid: app.uid });
```

The app code runs in your app, signed in as the user:

```js
const options = {
    subject: `kv:${puter.appID}:job:*`,
    handlerName: 'fetchTitle',
    queue: true,
};

async function startQueue () {
    const subs = await puter.events.list();
    const existing = subs.find((s) =>
        s.subject === options.subject && s.handlerName === options.handlerName);
    if (existing && existing.suspendedReason !== 'permission_revoked') return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

async function addLink (url) {
    const id = crypto.randomUUID();
    const tomorrow = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    await puter.kv.set(`link:${id}`, { url, status: 'queued', queuedAt: Date.now() });
    await puter.kv.set(`job:${id}`, { url }, tomorrow);
    return id;
}

async function retryLink (id) {
    const link = await puter.kv.get(`link:${id}`);
    const tomorrow = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    await puter.kv.update(`link:${id}`, { status: 'queued', attempts: 0, queuedAt: Date.now() });
    await puter.kv.set(`job:${id}`, { url: link.url }, tomorrow);
}

async function requeueStuck () {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const links = await puter.kv.list('link:', true);

    for (const { key, value } of links) {
        if (value.status === 'queued' && value.queuedAt < fiveMinutesAgo) {
            await retryLink(key.slice('link:'.length));
        }
    }
}

if (await puter.perms.request('backgroundEvents')) await startQueue();

await puter.events.onLocal(`kv:${puter.appID}:link:*`, async ({ event }) => {
    if (event.op === 'gap') return reloadLinks();
    if (event.op === 'del') return removeLink(event.key);

    const link = 'value' in event ? event.value : await puter.kv.get(event.key);
    if (link) showLink(event.key, link);
}, { includeValue: true });

await reloadLinks();
await requeueStuck();
```
