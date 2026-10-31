---
title: Send Live Updates to Other Users
description: "Learn how to send live updates from your app to other people, like the score of a game they follow, the moment it changes."
tags: [kv, events]
order: 19
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

A scoreboard app keeps the score of a game in the scorekeeper's Puter account.
Fans want to see each change as it happens. With a read share, another Puter
user gets an [event](/Events/) each time a key under a prefix changes, with the
new value in it, and can load the keys at any time. They can't change them.

| You want to… | Use |
| --- | --- |
| Send changes to people you pick, as they happen | A read share, as in this recipe |
| Tell them that something changed, without the data | A watch share. Its events name the key and leave out the value. |
| Show data to anyone, signed in or not | [Hosting](/Hosting/) or a [worker](/Workers/). A share is for one Puter user. |

## Share the Game

Keep each game under its own prefix, and share it with
[`puter.kv.share()`](/KV/share/) at `'read'` access. Your app first asks the
user once for permission to share the `game:` prefix with
[`puter.perms.request()`](/Perms/request/):

```js
const prefix = `game:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}score`, { home: 0, away: 0 });

await puter.perms.request('kvShare', { prefix: 'game:', access: 'read' });

const share = await puter.kv.share({
    prefix,
    recipient: 'alice',
    access: 'read',
    label: 'Lions vs Bears',
});
```

Share with each fan the same way. Every fan is a separate share.

## Update the Score

The scorekeeper writes the score like any other key. Each write sends an event
to every fan:

```js
await puter.kv.set(`${prefix}score`, { home: 1, away: 0 });
```

## Watch as a Fan

The fan finds the share with [`puter.kv.listShared()`](/KV/listShared/) and
subscribes to `kv:<handle>:*` with [`puter.events.onLocal()`](/Events/onLocal/).
The fan only needs updates while their page is open, so nothing has to run in
the background. Pass [`includeValue: true`](/Events/subjects/#getting-the-new-value) to get the new value with each event:

```js
const { items } = await puter.kv.listShared();
const { handle, label } = items[0];

await puter.events.onLocal(`kv:${handle}:*`, ({ event }) => {
    if (event.op === 'set') showScore(label, event.value);
}, { includeValue: true });
```

The `key` in each event is relative to the shared prefix, so it's `score` here.
Writes to the same key within 250 ms arrive as one event with the latest value.
A fan who follows several games has one share for each, and subscribes to each
one the same way.

## When Fans Need to Catch Up

A fan who opens your app between two changes sees nothing until the next one.
When the connection drops, the fan gets an event with `op: 'gap'` for the
changes they missed. A read share also lets the fan load the score with
[`puter.kv.get()`](/KV/get/), passing the handle, so load it when the app opens
and again after a gap:

```js
const showLatest = async () => showScore(label, await puter.kv.get('score', { handle }));

await showLatest();
await puter.events.onLocal(`kv:${handle}:*`, async ({ event }) => {
    if (event.op === 'gap') return showLatest();
    if (event.op === 'set') showScore(label, event.value);
}, { includeValue: true });
```

## Limits

- A value over 16 KB arrives without `value`, and so does a change that reaches
  more subscriptions than the limit for values. The fan can load the value with
  [`puter.kv.get()`](/KV/get/).
- Entries saved with [`disableSharing: true`](/KV/set/) are never sent through a share.
- Each fan takes one of the scorekeeper's shares, and an account can hold a
  limited number of them.

[Rate Limits and Quotas](/rate-limits-and-quotas/#events) has the numbers for
each of these.
