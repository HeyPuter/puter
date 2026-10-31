---
title: Share a List With Someone
description: "Learn how to let users share a list in your app with another Puter user, so both of them can add, change and check off items."
tags: [kv, perms]
order: 17
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

[`puter.kv`](/KV/) keeps each user's data in their own Puter account, where only
they can reach it. A shared grocery list or to-do list needs two people working
on the same data. With [`puter.kv.share()`](/KV/share/), a user can give another
Puter user access to the keys under a prefix. The keys stay in the owner's
account, and the other person reads and writes them from their own.

In this recipe, Dan makes a grocery list in your app and shares it with Alice,
and then both of them edit it.

## Give the List Its Own Prefix

A share covers every key that starts with its prefix. Build each list's prefix
from an id, like `list:<uuid>:`. A share stays on the prefix it was made for, so
a prefix made from the list's name would stop matching when the user renames
the list.

```js
const user = await puter.auth.getUser();
const prefix = `list:${crypto.randomUUID()}:`;

await puter.kv.set(`${prefix}meta`, { title: 'Groceries', from: user.username });
await puter.kv.set(`${prefix}item:${crypto.randomUUID()}`, { text: 'Milk', done: false });
```

Each item gets its own key, so when Dan and Alice add items at the same time,
both items are kept. With all the items in one key, the last write would
replace the other person's change.

The person you share with isn't told who shared it or what its prefix is, so
the `meta` key is where their app finds a title to show.

## Ask Once for Permission to Share

Your app needs the user's permission to share their data. Ask for it with
[`puter.perms.request()`](/Perms/request/), naming the `list:` prefix so one
approval covers every list the user makes:

```js
const allowed = await puter.perms.request('kvShare', { prefix: 'list:', access: 'write' });
document.querySelector('#share-button').hidden = !allowed;
```

The user sees a prompt the first time, and the call resolves to `true` once they
allow it. Later calls resolve to `true` without asking again.
[Share Data From Your Backend](/recipes/share-data-from-your-backend/#ask-for-permission-once)
explains what the permission covers.

## Share the List

Pass the prefix, the other person's username and the access level to
[`puter.kv.share()`](/KV/share/):

```js
const share = await puter.kv.share({
    prefix,
    recipient: 'alice',
    access: 'write',
    label: 'Groceries from Dan',
    notify: true,
});
```

With write access, Alice can add, change and delete any key under the prefix,
`meta` included. The label is plain text Alice sees with the share. With
`notify: true`, Alice's app is told about the share as soon as it's made, and
Dan and Alice can [notify each other](/Notifications/notify/#notify-the-other-side-of-a-share)
through it.

The share is of your app's data, so Alice uses it in your app, and her other
apps can't see it. Each of them pays for their own reads and writes, including
the ones Alice makes through the share.

## Find the Lists Shared With You

On Alice's side, [`puter.kv.listShared()`](/KV/listShared/) lists the shares
made with her in your app. Each one has a `handle`, which she passes to the
other [`puter.kv`](/KV/) methods to use that share. This shows each list by the
title in its `meta`:

```js
const addList = async (handle, label) => {
    const meta = await puter.kv.get('meta', { handle });
    const row = document.createElement('li');
    row.textContent = meta?.title ?? label ?? 'Shared list';
    row.dataset.handle = handle;
    document.querySelector('#lists').append(row);
};

const { items } = await puter.kv.listShared();
for (const { handle, label } of items) await addList(handle, label);
```

Setting `textContent` shows a title or label as plain text, never as HTML.
Anyone with write access can change `meta`, so use it only for display. What
each person can do comes from the share's `access`.

A share made while Alice has your app open also arrives as a
[`kv.share.received` notification](/KV/share/#what-the-holder-sees), which
[`puter.events.onLocal()`](/Events/onLocal/) receives on the `notif:app-user`
subject:

```js
await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.type === 'kv.share.received') {
        addList(event.notification.handle, event.notification.label);
    }
});
```

## Read and Write Through the Handle

Alice passes a list's `handle` with every call, and uses keys relative to the
shared prefix. She writes `item:<id>`, and it's stored as
`list:<uuid>:item:<id>` in Dan's account:

```js
const options = { handle };

await puter.kv.set(`item:${crypto.randomUUID()}`, { text: 'Eggs', done: false }, options);
const entries = await puter.kv.list('item:*', true, options);
```

The keys that [`puter.kv.list()`](/KV/list/) returns are relative too, like
`item:<id>`.

## Use One Helper for Both Sides

Dan uses full keys and no handle, while Alice uses relative keys and a handle.
This helper hides the difference, so the rest of your app works the same for
both of them:

```js
const openList = ({ prefix = '', handle }) => {
    const options = handle ? { handle } : {};
    const relative = (key) => key?.slice(prefix.length);
    return {
        get: (key) => puter.kv.get(prefix + key, options),
        set: (key, value) => puter.kv.set(prefix + key, value, options),
        del: (key) => puter.kv.del(prefix + key, options),
        list: async (pattern) => (await puter.kv.list(prefix + pattern, true, options))
            .map(({ key, value }) => ({ key: relative(key), value })),
        watch: (pattern, onChange) => puter.events.onLocal(
            `kv:${handle ?? puter.appID}:${prefix}${pattern}`,
            ({ event }) => onChange({ ...event, key: relative(event.key) }),
            { includeValue: true },
        ),
    };
};

const dansList = openList({ prefix });     // Dan, who owns the list
const alicesList = openList({ handle });   // Alice, through the share

await alicesList.set(`item:${crypto.randomUUID()}`, { text: 'Bread', done: false });
const items = await dansList.list('item:*');
```

Dan uses the prefix rather than a handle, so his code keeps working after he
stops sharing the list.

## Watch for Changes

The helper's `watch()` calls [`puter.events.onLocal()`](/Events/onLocal/), so
each person sees the other's changes while the list is open:

```js
await alicesList.watch('item:*', (event) => {
    if (event.op === 'gap') return reloadList();
    if (event.self && !event.viaWorker) return;
    if (event.op === 'del') removeItem(event.key);
    else showItem(event.key, event.value);
});
```

The `self` check skips the user's own writes, which your app already shows, but
not changes a worker made as them, which have `viaWorker` set. A `gap` event
means some changes weren't delivered, for example during a reconnect, so reload
the list. [The event](/Events/subjects/#the-event) lists every field.

For Dan, `watch()` puts your app's id from [`puter.appID`](/Utils/appID/) in the
subject, since a `kv:` subject for a key that contains `:` needs it, as
[Key-value data](/Events/subjects/#key-value-data) describes. When Dan and Alice
change the same item at about the same time, the last write wins.

## Next Steps

- To keep some entries in the prefix private, see
  [Share Only Part of the Data](/recipes/let-someone-view-your-data/#share-only-part-of-the-data).
- To let each person change only their own items, give each one a part of the
  list, as in [Let Members Change Only Their Own Messages](/recipes/build-a-group-chat/#let-members-change-only-their-own-messages).
- To see who has access to a list, or to stop sharing it, see
  [Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/).
