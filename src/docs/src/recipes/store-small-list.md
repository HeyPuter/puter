---
title: Store a Small List
description: "Learn how to keep a list in one Puter.js key-value entry, so your app loads it with a single read and edits any item in place. It fits a few thousand small items."
tags: [kv, data-modeling]
order: 10
---

Most applications keep a list the user adds to and edits later, such as todos,
notes, saved records or an activity log. The whole list can live in one
key-value entry as an array, so you read all of it with a single
[`puter.kv.get()`](/KV/get/) call, without pagination.

## Add an Item

To add an item to the end of the list, use the [`puter.kv.add()`](/KV/add/)
method and wrap the item in an array:

```js
await puter.kv.add('todos', [{ text: 'Buy milk', done: false }]);
```

If the key does not exist yet, it is created as an array. The append is atomic,
so two concurrent calls both add their item.

To add several items, put them all in the array. Each element is appended as a
separate item:

```js
await puter.kv.add('todos', [
    { text: 'Walk the dog', done: false },
    { text: 'Call mom', done: false },
]);
```

## Show the List

To load the list, use the [`puter.kv.get()`](/KV/get/) method. One read returns
every item in the order it was added, so you don't need an additional field for
sorting. A list that was never written comes back as `null`, so default it to an
empty array:

```js
const todos = await puter.kv.get('todos') ?? [];
```

## Edit an Item

To change one field of one item, use the [`puter.kv.update()`](/KV/update/)
method with a path made of the item's index in brackets, then the field name.
This marks the first todo as done:

```js
await puter.kv.update('todos', { '[0].done': true });
```

The index is the item's position in the array you read with
[`puter.kv.get()`](/KV/get/). To edit an item you know by a field value, find
its index first:

```js
const todos = await puter.kv.get('todos') ?? [];
const index = todos.findIndex((todo) => todo.text === 'Buy milk');

await puter.kv.update('todos', { [`[${ index }].done`]: true });
```

To replace the whole item, use the index on its own:

```js
await puter.kv.update('todos', { [`[${ index }]`]: { text: 'Buy oat milk', done: false } });
```

## Delete an Item

To remove an item, use the [`puter.kv.remove()`](/KV/remove/) method with its
index in brackets:

```js
await puter.kv.remove('todos', `[${ index }]`);
```

Every item after it moves down by one index. To delete several items, pass all
their indexes in one call, such as `remove('todos', '[0]', '[3]')`. The indexes
in one call refer to the list as it was before the call.

Because indexes shift, a list edited from two tabs or devices at once can go
wrong. After one tab deletes an item, the other tab still has the old indexes
and can edit or delete the wrong item. In that case, [store items by
ID](/recipes/store-items-by-id/) instead, where each item has a fixed ID.

## When to Switch

One entry holds up to [400 KB](/KV/MAX_VALUE_SIZE/), which is a few thousand
small items. If your list holds more than that, or you expect it to, [store a
large collection](/recipes/store-large-collection/) instead, which gives you:

- no ceiling on how many records you keep
- an expiry per record, instead of one for the whole list
- reads a page at a time, instead of the whole list on every render
