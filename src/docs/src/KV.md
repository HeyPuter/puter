---
title: Key-Value Store
description: Store and retrieve data using key-value pairs in the cloud.
---

The Key-Value Store API lets you store and retrieve data using key-value pairs in the cloud.

It supports various operations such as set, get, delete, list keys, increment and decrement values, and flush data. This enables you to build powerful functionality into your app, including persisting application data, caching, storing configuration settings, and much more.

Puter.js handles all the infrastructure for you, so you don't need to set up servers, handle scaling, or manage backups. And thanks to the [User-Pays Model](/user-pays-model/), you don't have to worry about storage, read, or write costs, as users of your application cover their own usage.

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
- **[`puter.kv.list()`](/KV/list/)** - List all keys
- **[`puter.kv.flush()`](/KV/flush/)** - Clear all data

## Examples

You can see various Puter.js Key-Value Store features in action from the following examples:

- [Set](/playground/kv-set/)
- [Get](/playground/kv-get/)
- [Increment](/playground/kv-incr/)
- [Decrement](/playground/kv-decr/)
- [Delete](/playground/kv-del/)
- [List](/playground/kv-list/)
- [Flush](/playground/kv-flush/)
- [Expire](/playground/kv-expire/)
- [Expire At](/playground/kv-expireAt/)
- [What's your name?](/playground/kv-name/)

## Tutorials

- [Add Key-Value Store to Your App: A Free Alternative to DynamoDB](https://developer.puter.com/tutorials/add-a-cloud-key-value-store-to-your-app-a-free-alternative-to-dynamodb/)
