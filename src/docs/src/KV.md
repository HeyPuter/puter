---
title: Key-Value Store
description: Store and retrieve data using key-value pairs in the user's own cloud store.
---

The Key-Value Store API lets you store and retrieve data as key-value pairs in the cloud. Each app gets its own store in each user's account.

You can set, get, and delete keys, list them by prefix, increment and decrement numbers, change parts of a stored object, and set keys to expire. Apps use it to persist app data, cache results, and store settings.

Puter.js runs the infrastructure, so there are no servers to set up, scale, or back up. With the [User-Pays Model](/user-pays-model/), each user covers their own storage, read, and write costs.

<div class="info"><strong>Need to share data across users?</strong> Each user's key-value store lives in their own account. A user can share part of theirs with another user, as described in <a href="#sharing-with-other-users">Sharing with other users</a>. For one central store that every user reads and writes, use a <a href="/Workers/">Serverless Worker</a>. Its code acts on the worker owner's resources, so all users share one backend.</div>

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
</html>
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

            // (2) Retrieve all keys
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
</html>
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

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

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

- **`watch`**: the holder gets [events](/Events/subjects/#sharing-key-value-data-with-another-user) when keys under the prefix change, and can list the keys without their values.
- **`read`**: the holder can also read values.
- **`write`**: the holder can also change and delete any key under the prefix.

An app shares its user's data only with that user's consent, which it asks for once with [`puter.perms.request('kvShare', …)`](/Perms/request/).

The holder finds the share with [`puter.kv.listShared()`](/KV/listShared/) and passes its `handle` to the other [`puter.kv`](/KV/) methods, in the same app or outside any app. Keys are relative to the shared prefix. Here the owner writes `list:<id>:meta`, and the holder reads the same key as `meta`:

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

- **What the holder sees.** A share tells the holder its level, its app, and an optional label the owner sets, but not who shared it or what the prefix is.
- **Notifications.** A share made with `notify: true` lets the owner and the holder send each other notifications through its handle with [`puter.notifications.notify()`](/Notifications/notify/), and tells the holder about the share inside your app. See [What the holder sees](/KV/share/#what-the-holder-sees).
- **Private entries.** Entries written with [`disableSharing`](/KV/set/#private-entries) can't be read or listed through a share. Keep them outside the prefixes you share.
- **Writes from several users.** When two users write the same key at about the same time, the last write wins. For a log of changes, write each change to its own key, such as `chg:<timestamp>-<random>`, instead of updating one shared counter.
- **Cost.** Each user pays for their own reads and writes, including the ones they make through a share.

Either side ends a share with [`puter.kv.unshare()`](/KV/unshare/). See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for how many shares an account can make and hold.

These recipes show sharing in a full app:

- [Share a List With Someone](/recipes/share-a-list-with-someone/)
- [Let Someone View Your Data](/recipes/let-someone-view-your-data/)
- [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/)
- [Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/)
- [Build a Group Chat](/recipes/build-a-group-chat/)
- [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/)
- [Alert Users When Shared Data Changes](/recipes/alert-users-when-shared-data-changes/)
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
