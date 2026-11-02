---
title: Store a Small List
description: "Learn how to store a list of up to a few thousand small items with Puter.js, so your app loads it in one read and edits any item in place."
tags: [kv, data-modeling]
order: 10
---

Most apps keep a list the user adds to and edits, such as todos, notes or an
activity log. With [`puter.kv`](/KV/), the whole list can live in one key as an
array, so a single read loads all of it without pagination.

## Add an Item

To add an item to the end of the list, use the [`puter.kv.add()`](/KV/add/)
method with the item wrapped in an array:

```js
await puter.kv.add('todos', [{ text: 'Buy milk', done: false }]);
```

The first call creates the list. The append is atomic, so two tabs adding at
the same moment both add their item. The array is needed because
[`puter.kv.add()`](/KV/add/) reads a plain object as a map of paths, and would
add each field as a path instead of appending the object.

To add several items, put them all in the array. Each one is appended as a
separate item:

```js
await puter.kv.add('todos', [
    { text: 'Walk the dog', done: false },
    { text: 'Call mom', done: false },
]);
```

## Show the List

To load the list, use the [`puter.kv.get()`](/KV/get/) method. Items come back
in the order they were added. A list that was never written comes back as
`null`, so default it to an empty array:

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

The index is the item's position in the array from
[`puter.kv.get()`](/KV/get/). To edit an item you know by a field value, find
its index first:

```js
const index = todos.findIndex((todo) => todo.text === 'Buy milk');

await puter.kv.update('todos', { [`[${ index }].done`]: true });
```

To replace the whole item, use the index on its own:

```js
await puter.kv.update('todos', { [`[${ index }]`]: { text: 'Buy oat milk', done: false } });
```

## Delete an Item

To remove an item, use the [`puter.kv.remove()`](/KV/remove/) method with its
index in brackets. Every item after it moves down by one index:

```js
await puter.kv.remove('todos', `[${ index }]`);
```

To delete several items in one call, pass their indexes from highest to lowest:

```js
await puter.kv.remove('todos', '[3]', '[0]');
```

Since indexes shift, a list edited from two tabs or devices at once can go
wrong. After one tab deletes an item, the other tab still has the old indexes
and can change the wrong item. When that can happen, [store items by
ID](/recipes/store-items-by-id/) instead, so each item keeps a fixed ID.

## When to Switch

One key has a [size limit](/KV/MAX_VALUE_SIZE/) that fits a few thousand small
items. A list that can grow past that goes in [one key per
item](/recipes/store-large-collection/), which also lets each item expire on its
own and loads the list a page at a time.
