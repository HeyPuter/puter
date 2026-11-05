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

A watch share sends the same events without the values, for when the other
person only needs to know that something changed. A share is for one Puter
user, so to show data to anyone, signed in or not, use [Hosting](/Hosting/) or a
[worker](/Workers/).

## Share the Game

Keep each game under its own prefix, and share it at `'read'` access with
[`puter.kv.share()`](/KV/share/). Your app first asks the user once for
permission to share the `game:` prefix with
[`puter.perms.request()`](/Perms/request/):

```js
const prefix = `game:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}score`, { home: 0, away: 0 });

await puter.perms.request('kvShare', { prefix: 'game:', access: 'read' });

const shares = await puter.kv.share({
    prefix,
    recipients: ['alice', 'bob'],
    access: 'read',
    label: 'Lions vs Bears',
});
```

Each fan gets their own share. To add a fan later, share the same prefix with
them.

## Update the Score

The scorekeeper writes the score like any other key. Each write sends an event
to every fan who's watching:

```js
await puter.kv.set(`${prefix}score`, { home: 1, away: 0 });
```

## Watch as a Fan

The fan finds the share with [`puter.kv.listShared()`](/KV/listShared/), loads
the score with [`puter.kv.get()`](/KV/get/), and subscribes to the `score` key
with [`puter.events.onLocal()`](/Events/onLocal/). The fan only needs updates
while their page is open, so nothing has to run in the background:

```js
const { items } = await puter.kv.listShared();
const { handle, label } = items[0];

const showLatest = async () => showScore(label, await puter.kv.get('score', { handle }));
await showLatest();

await puter.events.onLocal(`kv:${handle}:score`, ({ event }) => {
    if (event.op === 'set' && 'value' in event) showScore(label, event.value);
    else showLatest();
}, { includeValue: true });
```

With [`includeValue: true`](/Events/subjects/#getting-the-new-value), each event
carries the new score as `value`, and its `key` is relative to the shared
prefix. An event leaves out the value when the value is large or the change
reaches many fans, as [Getting the new value](/Events/subjects/#getting-the-new-value)
describes, so the handler loads the score itself then. It does the same for a
`gap` event, which stands in for changes the fan missed, for example during a
reconnect.

A fan who follows several games has one share for each, and subscribes to each
one the same way. To alert fans after they close your app, see
[Alert Users When Shared Data Changes](/recipes/alert-users-when-shared-data-changes/).
