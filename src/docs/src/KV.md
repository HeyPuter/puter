---
title: Key-Value Store
description: Store and retrieve data using key-value pairs in the user's own cloud store.
---

The Key-Value Store API lets you store and retrieve data using key-value pairs in the cloud.

It supports various operations such as set, get, delete, list keys, increment and decrement values, and flush data. This enables you to build powerful functionality into your app, including persisting application data, caching, storing configuration settings, and much more.

Puter.js handles all the infrastructure for you, so you don't need to set up servers, handle scaling, or manage backups. And thanks to the [User-Pays Model](/user-pays-model/), you don't have to worry about storage, read, or write costs, as users of your application cover their own usage.

<div class="info"><strong>Need to share data across users?</strong> Each user's key-value store lives in their own account. A user can share part of theirs with another user, as described in <a href="#sharing-with-other-users">Sharing with other users</a>. To keep a single, centralized store that every user reads from and writes to, use a <a href="/Workers/">Serverless Worker</a>. Its code can act on the worker owner's resources, giving all users one shared backend.</div>

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="set"><span>Set</span></div>
    <div class="example-group" data-section="get"><span>Get</span></div>
    <div class="example-group" data-section="incr"><span>Increment</span></div>
    <div class="example-group" data-section="decr"><span>Decrement</span></div>
    <div class="example-group" data-section="del"><span>Delete</span></div>
    <div class="example-group" data-section="list"><span>List Keys</span></div>
    <div class="example-group" data-section="flush"><span>Flush Data</span></div>
</div>

<div class="example-content" data-section="set" style="display:block;">

#### Create a new key-value pair

```html;kv-set
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.set('name', 'Puter Smith').then((success) => {
            puter.print(`Key-value pair created/updated: ${success}`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="get">

#### Retrieve the value of key 'name'

```html;kv-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // (2) Retrieve the value of key 'name'
            const name = await puter.kv.get('name');
            puter.print(`Name is: ${name}`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="incr">

#### Increment the value of a key

```html;kv-incr
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.incr('testIncrKey').then((newValue) => {
            puter.print(`New value: ${newValue}`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="decr">

#### Decrement the value of a key

```html;kv-decr
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.decr('testDecrKey').then((newValue) => {
            puter.print(`New value: ${newValue}`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="del">

#### Delete the key 'name'

```html;kv-del
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // delete the key 'name'
            await puter.kv.del('name');
            puter.print("Key-value pair 'name' deleted<br>");

            // try to retrieve the value of key 'name'
            const name = await puter.kv.get('name');
            puter.print(`Name is now: ${name}`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="list">

#### Retrieve all keys in the user's key-value store for the current app

```html;kv-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a number of key-value pairs
            await puter.kv.set('name', 'Puter Smith');
            await puter.kv.set('age', 21);
            await puter.kv.set('isCool', true);
            puter.print("Key-value pairs created/updated<br><br>");

            // (2) Retrieve all keys
            const keys = await puter.kv.list();
            puter.print(`Keys are: ${keys}<br><br>`);

            // (3) Retrieve all keys and values
            const key_vals = await puter.kv.list(true);
            puter.print(`Keys and values are: ${(key_vals).map((key_val) => key_val.key + ' => ' + key_val.value)}<br><br>`);

            // (4) Match keys with a pattern
            const keys_matching_pattern = await puter.kv.list('is*');
            puter.print(`Keys matching pattern are: ${keys_matching_pattern}<br>`);

            // (5) Delete all keys (cleanup)
            await puter.kv.del('name');
            await puter.kv.del('age');
            await puter.kv.del('isCool');
        })();
    </script>
</body>
```

</div>

<div class="example-content" data-section="flush">

#### Remove all key-value pairs from the user's key-value store for the current app

```html;kv-flush
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a number of key-value pairs
            await puter.kv.set('name', 'Puter Smith');
            await puter.kv.set('age', 21);
            await puter.kv.set('isCool', true);
            puter.print("Key-value pairs created/updated<br>");

            // (2) Rretrieve all keys
            const keys = await puter.kv.list();
            puter.print(`Keys are: ${keys}<br>`);

            // (3) Flush the key-value store
            await puter.kv.flush();
            puter.print('Key-value store flushed<br>');

            // (4) Retrieve all keys again, should be empty
            const keys2 = await puter.kv.list();
            puter.print(`Keys are now: ${keys2}<br>`);
        })();
    </script>
</body>
```

</div>

## Functions

These Key-Value Store features are supported out of the box when using Puter.js:

- **[`puter.kv.set()`](/KV/set/)** - Set a key-value pair
- **[`puter.kv.get()`](/KV/get/)** - Get a value by key
- **[`puter.kv.incr()`](/KV/incr/)** - Increment a numeric value
- **[`puter.kv.decr()`](/KV/decr/)** - Decrement a numeric value
- **[`puter.kv.add()`](/KV/add/)** - Add values to an existing key
- **[`puter.kv.remove()`](/KV/remove/)** - Remove values by path
- **[`puter.kv.update()`](/KV/update/)** - Update values by path
- **[`puter.kv.del()`](/KV/del/)** - Delete a key-value pair
- **[`puter.kv.expire()`](/KV/expire/)** - Set key expiration in seconds
- **[`puter.kv.expireAt()`](/KV/expireAt/)** - Set key expiration timestamp
- **[`puter.kv.list()`](/KV/list/)** - List keys in ascending or descending order
- **[`puter.kv.flush()`](/KV/flush/)** - Clear all data
- **[`puter.kv.share()`](/KV/share/)** - Share the keys under a prefix with another user
- **[`puter.kv.unshare()`](/KV/unshare/)** - Stop a share, as its owner or its holder
- **[`puter.kv.listShared()`](/KV/listShared/)** - List the shares other users made with you
- **[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/)** - List the shares you made
- **[`puter.kv.MAX_KEY_SIZE`](/KV/MAX_KEY_SIZE/)** - Maximum key size in bytes
- **[`puter.kv.MAX_VALUE_SIZE`](/KV/MAX_VALUE_SIZE/)** - Maximum value size in bytes

## Sharing with other users

A user can share the keys under a prefix with another Puter user. The user who shares is the share's owner, and the user it's shared with is its holder. The keys stay in the owner's store.

Pick the tool by what you want to do:

| You want to… | Use |
| --- | --- |
| Let another user see or change part of your app's data | [`puter.kv.share()`](/KV/share/) |
| Let another app of the same user use your data | [`puter.perms.request('appData', …)`](/Perms/appData/) |
| Share files | [`puter.fs.share()`](/FS/share/) |
| Show data to anyone, signed in or not | [Hosting](/Hosting/) or a [worker](/Workers/). A share is for one user, who needs a Puter account. |
| Enforce rules per writer, such as letting each user edit only their own posts | A prefix per writer, each shared separately, or a [worker](/Workers/) that checks each write |

A share has one of three levels, and each includes the ones before it:

- **`watch`**: the holder gets [events](/Events/subjects/#sharing-key-value-data-with-another-user) when keys under the prefix change.
- **`read`**: the holder can also [`get()`](/KV/get/) and [`list()`](/KV/list/) keys.
- **`write`**: the holder can also change keys with every other method. Write includes delete, so every holder with write access can change or remove any key under the prefix.

An app shares its user's data only with that user's consent, asked once with [`puter.perms.request('kvShare', …)`](/Perms/request/) at the level it will share or higher. Without it, [`puter.kv.share()`](/KV/share/) fails with `events_kv_handle_not_delegated`.

The holder finds the share with [`puter.kv.listShared()`](/KV/listShared/), and passes its `handle` to the other methods. Keys are relative to the shared prefix. Here the owner writes `list:<id>:meta`, and the holder reads the same key as `meta`:

```js
// The owner, once per app: let this app share `list:` keys with write access
await puter.perms.request('kvShare', { prefix: 'list:', access: 'write' });

const prefix = `list:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}meta`, { title: 'Groceries' });
await puter.kv.share(prefix, 'alice', 'write');

// Alice, in the same app
const { items } = await puter.kv.listShared();
const { handle } = items[0];
const meta = await puter.kv.get('meta', { handle });
await puter.kv.set(`item:${crypto.randomUUID()}`, { text: 'milk' }, { handle });
const entries = await puter.kv.list('item:*', true, { handle });
```

- **What the holder knows.** A share tells the holder its level, its app, and an optional label. It never says who shared it or what the prefix is. The label is plain text the owner sets with [`puter.kv.share()`](/KV/share/). Render it with `textContent`, never as HTML.
- **Notification.** When a user shares an app's data, the holder gets a `kv.share.received` notification in that app, on [`notif:app-user`](/Events/subjects/#notifications). It carries the `handle`, `access`, `label`, and `createdAt`. Listen for it with [`puter.events.onLocal()`](/Events/onLocal/), or read missed ones with [`puter.events.fetch()`](/Events/fetch/). The Puter desktop doesn't show it, so your app is where the holder finds out about the share. The live notification needs notifications to be turned on for events on the deployment. Calling [`puter.kv.listShared()`](/KV/listShared/) when your app opens finds new shares in every case.
- **Blocks.** A user who blocked the owner, or who doesn't accept shares from anyone, can't be shared with, and [`puter.kv.share()`](/KV/share/) fails with `recipient_not_accepting_shares`.
- **Account.** Sharing needs a confirmed email address where the deployment requires one, and no phone number, card, or paid plan.
- **Private entries.** Entries written with `disableSharing` aren't readable or listed through a share. Writing to one through a share is refused, so a holder with write access can learn that a private key exists, but never its value. Keep private entries outside the prefixes you share.
- **Writes from several users.** When two users write the same key at about the same time, the last write wins. For a log of changes, write each change to its own key, such as `chg:<timestamp>-<random>`, instead of updating one shared counter.
- **Cost.** Each user pays for their own reads and writes, including the ones they make through a share.

Either side ends a share with [`puter.kv.unshare()`](/KV/unshare/). See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for how many shares an account can make and hold.

These recipes show sharing in a full app:

- [Share a List With Someone](/recipes/share-a-list-with-someone/)
- [Let Someone View Your Data](/recipes/let-someone-view-your-data/)
- [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/)
- [Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/)
- [Build a Group Chat](/recipes/build-a-group-chat/)
- [Share Data From Your Backend](/recipes/share-data-from-your-backend/)

## Examples

You can see various Puter.js Key-Value Store features in action from the following examples:

- [Set](/playground/kv-set/)
- [Get](/playground/kv-get/)
- [Increment](/playground/kv-incr/)
- [Decrement](/playground/kv-decr/)
- [Delete](/playground/kv-del/)
- [List](/playground/kv-list/)
- [Querying with Prefix Patterns](/playground/kv-prefix-patterns/)
- [Flush](/playground/kv-flush/)
- [Expire](/playground/kv-expire/)
- [Expire At](/playground/kv-expireAt/)
- [What's your name?](/playground/kv-name/)

## Tutorials

- [Add Key-Value Store to Your App: A Free Alternative to DynamoDB](https://developer.puter.com/tutorials/add-a-cloud-key-value-store-to-your-app-a-free-alternative-to-dynamodb/)
