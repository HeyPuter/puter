---
title: Append items to a growing list
description: Keep an append-only list such as an event log or a chat history as a real array in one entry, so adding to it is a single write that never reads the list first.
tags: [kv, data-modeling]
order: 10
---

**Use this when** the only operation is append, such as an event log, a chat
transcript, or a history feed. Items are written once and never changed, and the
list is read whole with a single `get()`.

## Store the array

The KV store holds JSON natively, so pass the array itself:

```js
await puter.kv.set('log', [
    { at: 1, event: 'opened' },
    { at: 2, event: 'edited' },
]);

const log = await puter.kv.get('log');
log.length;        // 2 (already an array, no parse step)
```

## Append with add()

[`puter.kv.add()`](/KV/add/) appends without the list ever travelling to your app
and back:

```js
await puter.kv.add('log', [{ at: 3, event: 'saved' }]);
```

One round trip. Two tabs appending at the same moment each add their own entry,
so neither overwrites the other. The read-modify-write version loses one of the
two writes.

`add()` also upserts, so a key that doesn't exist yet is created as an array:

```html
<script src="https://js.puter.com/v2/"></script>
<script>
(async () => {
    // No seeding required. This creates 'log' as an array.
    await puter.kv.add('log', [{ at: Date.now(), event: 'opened' }]);

    // An array argument spreads: this appends two entries, not one nested array.
    await puter.kv.add('log', [
        { at: Date.now(), event: 'edited' },
        { at: Date.now(), event: 'saved' },
    ]);

    const log = await puter.kv.get('log');
    console.log(log.length);   // 3
})();
</script>
```

## Choosing where the values land

The type of the argument decides *where* `add()` appends.

**An array targets the root.** Its elements are appended to the value stored
under the key:

```js
await puter.kv.set('log', [{ event: 'opened' }]);

await puter.kv.add('log', [{ event: 'saved' }]);
// → [ { event: 'opened' }, { event: 'saved' } ]
```

**An object is a path map.** Each key names a path inside the value, and each
value is what to append at that path:

```js
await puter.kv.set('profile', { name: 'Puter', tags: ['alpha'] });

await puter.kv.add('profile', { tags: ['beta', 'gamma'] });
// → { name: 'Puter', tags: ['alpha', 'beta', 'gamma'] }
```

Paths use dot notation, so `{ 'settings.labels': ['urgent'] }` appends to
`settings.labels` and leaves the rest of the object alone.

So an object is never appended as an item. It selects a target. That is why a
single object is wrapped in an array, which reads as "append this one thing at
the root":

```js
await puter.kv.add('log', [{ at: Date.now(), event: 'closed' }]);
```

Passing that object bare would read `at` and `event` as paths. Neither exists on
an array, so the call rejects with *"The document path provided in the update
expression is invalid for update"* and the stored value is left unchanged.

## Notes

- Counters use [`puter.kv.incr()`](/KV/incr/); `add()` is the append operation.
- Array elements are not path-addressable, so there is no `log.0` to target. If you
  find yourself needing to change or remove one item, store the items
  [keyed by id](/recipes/kv-edit-items-by-id/) instead.
- A value is capped at **400 KB**. For a list that grows indefinitely, cap it,
  roll over to a new key, or move to [one key per
  item](/recipes/kv-prefix-listing/).
