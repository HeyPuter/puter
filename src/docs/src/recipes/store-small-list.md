---
title: Store a Small List
description: "Learn how to keep a list of items, such as todos or notes, inside one key-value entry so you can retrieve data in a single read. It fits a few thousand small items."
tags: [kv, data-modeling]
order: 20
---

Most applications keep a list the user edits later, such as todos, notes, saved
records or a task board. The whole list can live in one key-value entry, so a
screen loads with a single [`puter.kv.get()`](/KV/get/) and there is nothing to
page through.

You can store the list as an object with an item id key. This lets you add,
edit, and delete each item in one call without manually reading the entire list.

## Add an Item

To add an item, use the [`puter.kv.update()`](/KV/update/) method with the id as
the path:

```js
const id = crypto.randomUUID();

await puter.kv.update('todos', {
    [id]: { text: 'Buy milk', done: false, at: Date.now() },
});
```

The id becomes the key you reference later to update or delete that item. Any
unique string works, and
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
is a safe default.

## Show the List

To load the list, use the [`puter.kv.get()`](/KV/get/) method. One read returns
every item:

```js
const todos = await puter.kv.get('todos') ?? {};

const items = Object.entries(todos)
    .map(([id, todo]) => ({ id, ...todo }))
    .sort((a, b) => a.at - b.at);
```

An object has no inherent order, and the stored field order is not preserved on
read, so carry an `at` or `order` field on each item and sort when you render.
At sizes that fit in one entry, sorting in memory costs nothing measurable.

## Edit an Item

To change one field of one item, use the [`puter.kv.update()`](/KV/update/)
method with the item's id and the field you are changing:

```js
await puter.kv.update('todos', { [`${ id }.done`]: true });
```

This updates the specific property of the object with that id, without you
having to manually iterate the whole list and update it.

## Delete an Item

To remove an item, use the [`puter.kv.remove()`](/KV/remove/) method with its
id:

```js
await puter.kv.remove('todos', id);
```

It also takes several paths in one call, so `remove('todos', idA, idB)` deletes
two items at once.

## When to Switch

One entry holds up to [400 KB](/KV/MAX_VALUE_SIZE/), which is a few thousand
small items. If your list holds more than that, or you expect it to, [store a
large collection](/recipes/store-large-collection/) instead, which gives you:

- no ceiling on how many records you keep
- an expiry per record, instead of one for the whole list
- reads a page at a time, instead of the whole list on every render
