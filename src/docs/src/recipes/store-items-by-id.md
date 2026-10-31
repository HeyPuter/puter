---
title: Store Items by ID
description: "Learn how to store a list where every item has its own ID with Puter.js, so edits from several tabs or devices never change the wrong item."
tags: [kv, data-modeling]
order: 20
---

[Store a Small List](/recipes/store-small-list/) keeps items in an array and
edits them by index. When the same user edits the list from two tabs or devices,
a delete in one tab shifts the indexes, and the other tab can change the wrong
item.

Storing the list as an object keyed by item ID avoids that, since each item
keeps the same ID. The list is still one [`puter.kv`](/KV/) key, so a single
read loads all of it.

## Add an Item

To add an item, use the [`puter.kv.update()`](/KV/update/) method with the ID as
the path:

```js
const id = crypto.randomUUID();

await puter.kv.update('todos', {
    [id]: { text: 'Buy milk', done: false, at: Date.now() },
});
```

The first call creates the list. The ID is a path, where a dot means "go into a
nested object", so use IDs without dots, such as the ones
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
returns. [Store a Set of Unique
Values](/recipes/store-unique-values/#store-values-with-dots-or-quotes) shows how
to use any string as an ID.

## Show the List

To load the list, use the [`puter.kv.get()`](/KV/get/) method:

```js
const todos = await puter.kv.get('todos') ?? {};

const items = Object.entries(todos)
    .filter(([ , todo ]) => todo.at !== undefined)
    .map(([ id, todo ]) => ({ id, ...todo }))
    .sort((a, b) => a.at - b.at);
```

Stored objects don't keep their field order, so each item carries an `at` field
to sort by. The filter skips leftovers from an edit that reached an item after
another tab deleted it, which brings back only the edited field.

## Edit an Item

To change one field of one item, use the [`puter.kv.update()`](/KV/update/)
method with the item's ID and the field name:

```js
await puter.kv.update('todos', { [`${ id }.done`]: true });
```

The rest of the list stays as it was.

## Delete an Item

To remove an item, use the [`puter.kv.remove()`](/KV/remove/) method with its
ID:

```js
await puter.kv.remove('todos', id);
```

To delete several items, pass each ID as a separate argument. This clears every
completed todo:

```js
const doneIds = items.filter((item) => item.done).map((item) => item.id);

if ( doneIds.length > 0 ) {
    await puter.kv.remove('todos', ...doneIds);
}
```

## When to Switch

One key has a [size limit](/KV/MAX_VALUE_SIZE/) that fits a few thousand small
items. A list that can grow past that goes in [one key per
item](/recipes/store-large-collection/), which also lets each item expire on its
own and loads the list a page at a time.
