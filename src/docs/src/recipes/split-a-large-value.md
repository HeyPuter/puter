---
title: Split a Large Value Across Keys
description: "Learn how to split a value that keeps growing, such as a chat history or an activity log, across several Puter.js key-value entries, and why large entries cost more to read and write."
tags: [kv, data-modeling, performance]
order: 32
---

A chat history or an activity log can live in one key while it is small, with
each new message added by [`puter.kv.add()`](/KV/add/). But it keeps growing,
and one entry holds at most [400 KB](/KV/MAX_VALUE_SIZE/). Long before it hits
that limit, it also gets expensive, because every read and write is billed by
the size of the whole entry.

The fix is to split the value across several keys, often called shards or
pages. Each new message goes into a small, recent shard instead of one big entry.

## What a Large Entry Costs

Reads are billed for every 4 KB of the entry, and writes for every 1 KB. So
compared with a small entry:

- **Reading** a full 400 KB entry costs about **100 times** as much.
- **Writing** a full 400 KB entry costs about **400 times** as much.

The cost depends on the size of the whole entry, not on how much you change:

- [`puter.kv.add()`](/KV/add/), [`puter.kv.update()`](/KV/update/),
  [`puter.kv.incr()`](/KV/incr/) and [`puter.kv.remove()`](/KV/remove/) are
  billed as a write of the whole entry, even when they change one field.
  Appending a 200-byte message to a 300 KB history costs as much as writing
  300 KB.
- [`puter.kv.list()`](/KV/list/) reads the entries behind the keys it returns,
  even when you ask only for keys. Listing large entries costs about as much as
  reading them.

Say each message takes about 200 bytes, and a chat reaches 1,000 messages:

| | One key | Shards of 50 messages |
| --- | --- | --- |
| Size of the entry that changes | ~200 KB | ~10 KB at most |
| Adding one message | ~200 small writes | ~10 small writes |
| Showing the latest messages | ~50 small reads | ~3 small reads |
| Reading the whole chat | ~50 small reads | ~50 small reads |

Splitting makes adding and reading recent messages much cheaper. Reading
everything costs the same either way, since it's the same amount of data.

## Split a History into Shards

Give each message a number with [`puter.kv.incr()`](/KV/incr/), and let the
number pick its shard. With 50 messages per shard, messages 1 to 50 go in shard
0, 51 to 100 in shard 1, and so on:

```js
const PER_SHARD = 50;

const shardKey = (chatId, shard) =>
    `chat:${ chatId }:shard:${ String(shard).padStart(6, '0') }`;

async function addMessage (chatId, text) {
    const number = await puter.kv.incr(`chat:${ chatId }:count`);
    const shard = Math.floor((number - 1) / PER_SHARD);

    await puter.kv.add(shardKey(chatId, shard), [{ number, text, at: Date.now() }]);
}
```

[`puter.kv.incr()`](/KV/incr/) gives every message its own number, even when
two tabs send at the same moment, so no shard ever gets more than 50 messages.
[Run Code Only Once](/recipes/run-code-once/#hand-out-numbers-in-order) explains
why. The zeros in front of the shard number keep the keys in order when listed.

Messages that arrive at the same moment can land in a shard out of order. Each
one carries its `number`, so sort by it when reading.

## Read the Latest Messages

The counter says which shard is the newest, so showing the latest messages
takes two small reads:

```js
async function latestShard (chatId) {
    const count = await puter.kv.get(`chat:${ chatId }:count`) ?? 0;
    return Math.floor((count - 1) / PER_SHARD);   // -1 when there are no messages
}

async function readShard (chatId, shard) {
    const messages = await puter.kv.get(shardKey(chatId, shard)) ?? [];
    return messages.sort((a, b) => a.number - b.number);
}

const newest = await latestShard(chatId);
const messages = newest >= 0 ? await readShard(chatId, newest) : [];
```

For a "Load older messages" button, read the shard before the one you showed
last: `readShard(chatId, shard - 1)`. When the newest shard has only just
started, read the one before it too, so the screen isn't nearly empty.

Use the counter to find the newest shard, not [`puter.kv.list()`](/KV/list/).
Listing the shards reads all of them, which costs as much as reading the whole
chat.

## Read the Whole History

To read everything, such as for an export, list the shards with their values a
page at a time:

```js
const all = [];

for await ( const page of puter.kv.list({ pattern: `chat:${ chatId }:shard:`, returnValues: true, stream: true }) ) {
    for ( const { value } of page.items ) {
        all.push(...value);
    }
}
all.sort((a, b) => a.number - b.number);
```

## Let Old Shards Expire

To keep only recent history, give each shard an expiry when its first message
is added, the same way [Add Counters](/recipes/add-counters/#count-per-day)
expires daily counts:

```js
const key = shardKey(chatId, shard);
await puter.kv.add(key, [{ number, text, at: Date.now() }]);

if ( number % PER_SHARD === 1 ) {
    await puter.kv.expire(key, 60 * 60 * 24 * 90);   // 90 days after the shard started
}
```

Later messages don't change the expiry, so a whole shard expires 90 days after
its first message. To delete a chat outright, see [Export or Delete
Data](/recipes/export-or-delete-data/#delete-everything-of-one-kind).

## Notes

- Pick shards small enough that the entry you write to stays cheap. Around 10 to
  50 KB is a good target. Limit how long a message can be, so 50 messages can't
  add up to more than you planned.
- Keep `PER_SHARD` the same once you have data. Changing it changes which shard
  each message number belongs to, and older messages would be looked up in the
  wrong place.
- One large document that is read and saved as a whole, such as a long text, is
  better stored as a file with [`puter.fs`](/recipes/store-files/), which has no
  400 KB limit.
