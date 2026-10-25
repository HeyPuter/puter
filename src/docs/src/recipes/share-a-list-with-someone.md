---
title: Share a List With Someone
description: "Learn how to let users share a list in your app with another Puter user, so both of them can add, change and check off items."
tags: [kv, perms]
order: 17
---

[`puter.kv`](/KV/) keeps each user's data in their own Puter account, where only
they can reach it. A shared grocery list or to-do list needs two people working
on the same data. With [`puter.kv.share()`](/KV/share/), a user can give another
Puter user access to the keys under a prefix. The keys stay in the owner's
account, and the other person reads and writes them from their own.

In this recipe, Dan makes a grocery list in your app and shares it with Alice,
and then both of them edit it.

| You want to… | Use |
| --- | --- |
| Let another user see or change part of your app's data | [`puter.kv.share()`](/KV/share/), as in this recipe |
| Let another app of the same user use your data | [Share Data Between Apps](/recipes/share-data-between-apps/) |
| Share files | [Share a File](/recipes/share-a-file/) |
| Show data to anyone, signed in or not | [Hosting](/Hosting/) or a [worker](/Workers/). A share is for one Puter user. |
| Let each person edit only their own entries | [A part for each member](/recipes/build-a-group-chat/#let-members-change-only-their-own-messages), or a [worker](/Workers/) that checks each write |

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

Each item gets its own key with a random id. When Dan and Alice add items at the
same time, each write goes to a different key, so both items are kept. With all
the items in one key, the last write would replace the other person's change.

The `meta` key describes the list. The person you share with isn't told who
shared it or what its prefix is, so `meta` is where their app finds a title to
show.

## Ask Once for Permission to Share

Your app needs the user's permission to share their data. Ask for it with
[`puter.perms.request()`](/Perms/request/), naming the `list:` prefix so one
approval covers every list the user makes:

```js
const allowed = await puter.perms.request('kvShare', { prefix: 'list:', access: 'write' });
document.querySelector('#share-button').hidden = !allowed;
```

The user sees a prompt asking whether your app may let other Puter users it
picks read and change the `list:` section of its data. The call returns `true`
once they allow it, so the share button only shows then. Later calls return
`true` without asking again.
[Share Data From Your Backend](/recipes/share-data-from-your-backend/)
covers this permission in more detail.

## Share the List

Pass the prefix, the other person's username and the access level to
[`puter.kv.share()`](/KV/share/):

```js
const share = await puter.kv.share({
    prefix,
    recipient: 'alice',
    access: 'write',
    label: 'Groceries from Dan',
});
```

With write access, Alice can add, change and delete any key under the prefix,
`meta` included. The label is plain text Alice is shown with the share, and the
only thing about it you choose to tell her.

The share is of your app's data, so Alice uses it in your app, and her other
apps can't see it. Each of them pays for their own reads and writes, including
the ones Alice makes through the share.

## Find the Lists Shared With You

On Alice's side, [`puter.kv.listShared()`](/KV/listShared/) lists the shares
made with her in your app. Each one has a `handle`, which she passes to the
other `puter.kv` methods to use that share. Read `meta` through each handle to
show the lists:

```js
const { items } = await puter.kv.listShared();

for (const { handle, label } of items) {
    const meta = await puter.kv.get('meta', { handle });
    const row = document.createElement('li');
    row.textContent = meta?.title ?? label ?? 'Shared list';
    row.dataset.handle = handle;
    document.querySelector('#lists').append(row);
}
```

Set the text with `textContent`, so a title or label shows as plain text and is
never read as HTML. Anyone with write access can change `meta`, so use it for
display only. What a person can do comes from the share's `access`.

A share made while Alice has your app open arrives as a
[`kv.share.received` notification](/KV/share/#what-the-holder-sees), in your
app only. It carries the `handle` and `label`:

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

Dan always uses the prefix. A handle stops working when its share stops, so the
owner's code works without one. His subject names your app with [`puter.appID`](/Utils/appID/),
since a `kv:` subject for a key that contains `:` needs the app id in front, as
described in [Key-value data](/Events/subjects/#key-value-data).

## Watch for Changes

The `watch()` part of the helper calls
[`puter.events.onLocal()`](/Events/onLocal/), so each person sees the other's
changes as they happen:

```js
await alicesList.watch('item:*', (event) => {
    if (event.op === 'gap') return reloadList();
    if (event.self && !event.viaWorker) return;
    showItem(event.key, event.value);
});
```

The `self` field is `true` for changes the current user made, so the check skips
their own writes, which your app already shows. The `viaWorker` field is `true`
when a worker made the change as that user, so those changes still show up. A
`gap` event means some changes weren't delivered, for example during a
reconnect, so reload the list.
[The event](/Events/subjects/#the-event) lists every field.

When Dan and Alice change the same item at about the same time, the last write
wins.

## Keep Private Entries Out

Entries saved with [`disableSharing: true`](/KV/set/) are hidden from Alice even inside the
shared prefix. A write to one through the share is refused, which tells Alice
that key exists, but never its value. Keep private entries under a prefix that
isn't shared, such as `private:`.

To see who has access to a list, or to stop sharing it, see
[Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/).
