---
title: Managing a list of objects inside a key-value entry
description: Store items such as todos, tasks or saved records as an object keyed by id in one entry, so changing or removing one of them is a single write instead of rewriting the whole value.
tags: [kv, data-modeling]
order: 20
---

**Use this when** items are edited or deleted after they are written, such as a
todo list, a task board, saved records, or a set of settings. Keying by id is
what makes a single item addressable; editing and deleting both fall out of that.
The whole value is still read with a single `get()`.

## Key the items by id

Store the items as an **object keyed by id**, not as an array. Object paths
are addressable, so every operation becomes a single round trip that never reads
the list first:

```js
// Add
await puter.kv.update('todos', {
    [id]: { text: 'Buy milk', done: false, at: Date.now() },
});

// Mark done, changing one field of one item
await puter.kv.update('todos', { [`${id}.done`]: true });

// Delete
await puter.kv.remove('todos', id);

// Show
const todos = Object.values(await puter.kv.get('todos') ?? {});
```

Each of those is one call with no read-modify-write, which is what an array
cannot give you: array elements are not path-addressable, so changing one entry
means reading the whole list, editing it in memory, and writing it back.

That also makes concurrent edits safe. Two tabs marking different todos done
write disjoint paths, so both land. The read-modify-write version has a genuine
race: both read the list, both write it back, and one of the two updates is
lost.

## A complete todo list

```html
<script src="https://js.puter.com/v2/"></script>
<script>
const KEY = 'todos';

// Ids become dot-separated path segments, so they must not contain dots, and
// numeric-looking ids risk being read as an index. A UUID is safe.
const newId = () => crypto.randomUUID();

async function addTodo(text) {
    const id = newId();
    await puter.kv.update(KEY, { [id]: { text, done: false, at: Date.now() } });
    return id;
}

async function setDone(id, done) {
    await puter.kv.update(KEY, { [`${id}.done`]: done });
}

async function deleteTodo(id) {
    await puter.kv.remove(KEY, id);
}

async function listTodos() {
    const todos = await puter.kv.get(KEY) ?? {};
    // Key order is not guaranteed, so sort on an explicit field.
    return Object.entries(todos)
        .map(([id, todo]) => ({ id, ...todo }))
        .sort((a, b) => a.at - b.at);
}

(async () => {
    const id = await addTodo('Buy milk');
    await addTodo('Water the plants');
    await setDone(id, true);

    console.log(await listTodos());
})();
</script>
```

## Ordering

A map has no inherent order, and the stored field order is not preserved on read.
Carry an explicit `at` (or `order`) field on each item and sort when you render,
as `listTodos()` does above. At sizes that fit in one entry this costs
nothing measurable.

## Notes

- **Keep dots out of ids**, since a dot separates path segments.
  `crypto.randomUUID()` is safe. Avoid numeric-looking ids such as `"1"`, which
  risk being read as an array index.
- `puter.kv.remove(key, ...paths)` takes several paths, so a few items can be
  deleted in one call: `puter.kv.remove('todos', idA, idB)`.
- Removing by array index is the case this shape exists to avoid: `remove(key,
  'items.0')` returns a success payload and silently changes nothing.
- A value is capped at **400 KB**, roughly a few thousand small items. Past that,
  or when items need their own TTL, switch to [one key per
  item](/recipes/kv-prefix-listing/).
