---
title: Split a Large Value Across Keys
description: "Learn how to store a history that keeps growing, such as a chat, with Puter.js, so adding to it and loading the latest part stay fast and cheap."
tags: [kv, data-modeling, performance]
order: 32
---

A chat history or activity log can start out in a single key, with new messages
added by [`puter.kv.add()`](/KV/add/). But it keeps growing, and one key has a
[size limit](/KV/MAX_VALUE_SIZE/). Well before it reaches that, it also gets
expensive, because reads and writes are billed by the size of the whole entry.

The fix is to split it across several smaller keys, often called shards. New
messages go into the latest shard instead of one big entry. For one large
document that's always read and saved as a whole, like a long text, use a
[file](/recipes/store-files/) instead, since files don't have that limit.

## What a Large Entry Costs

Reads are billed per 4 KB of the entry, and writes per 1 KB. Compared to a small
entry, an entry at the size limit costs about 100 times as much to read and
about 400 times as much to write.

What matters is the size of the whole entry, not how much you change:

- [`puter.kv.add()`](/KV/add/), [`puter.kv.update()`](/KV/update/),
  [`puter.kv.incr()`](/KV/incr/) and [`puter.kv.remove()`](/KV/remove/) are
  billed as writing the whole entry, even if they only change one field. Adding
  a 200-byte message to a 300 KB history costs the same as writing 300 KB.
- [`puter.kv.list()`](/KV/list/) reads the entries behind the keys it returns,
  even when you only ask for keys, so listing large entries costs about as much
  as reading them.

For example, with messages of about 200 bytes and a chat with 1,000 messages:

| | One key | Shards of 50 messages |
| --- | --- | --- |
| Size of the entry you write to | ~200 KB | ~10 KB at most |
| Adding one message | ~200 small writes | ~10 small writes |
| Loading the latest messages | ~50 small reads | ~3 small reads |
| Loading the whole chat | ~50 small reads | ~50 small reads |

Splitting makes adding messages and loading recent ones much cheaper. Loading
everything costs about the same either way, since it's the same amount of data.

## Split a History into Shards

Give each message a number with [`puter.kv.incr()`](/KV/incr/), and use the
number to pick its shard. With 50 messages per shard, messages 1 to 50 go in
shard 0, 51 to 100 in shard 1, and so on:

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

[`puter.kv.incr()`](/KV/incr/) gives every message its own number, even if two
tabs send at the same moment, so a shard never gets more than 50 messages. The
zero padding keeps the shard keys in order when they're listed.

Aim for shards of about 10 to 50 KB, and cap how long a message can be, so 50
messages can't grow bigger than you planned. The `PER_SHARD` value decides which
shard each message goes in, so keep it fixed once you have data.

Messages sent at the same moment can land out of order inside a shard. Each one
has its `number`, so sort by that when reading.

## Load the Latest Messages

The counter tells you which shard is the newest, so loading the latest messages
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

For a "Load older messages" button, read the shard before the one you're
showing with `readShard(chatId, shard - 1)`. If the newest shard only has a few
messages, load the one before it too, so the screen isn't mostly empty.

## Load the Whole History

To load everything, for example for an export, list the shards with their values
a page at a time:

```js
async function readAll (chatId) {
    const all = [];

    for await ( const page of puter.kv.list({ pattern: `chat:${ chatId }:shard:`, returnValues: true, stream: true }) ) {
        for ( const { value } of page.items ) {
            all.push(...value);
        }
    }
    return all.sort((a, b) => a.number - b.number);
}
```

## Let Old Shards Expire

To keep only recent history, give each shard a TTL when its first message is
added, the same way [Add Counters](/recipes/add-counters/#count-per-day) expires
daily counts. This is the whole `addMessage()` with that added:

```js
async function addMessage (chatId, text) {
    const number = await puter.kv.incr(`chat:${ chatId }:count`);
    const shard = Math.floor((number - 1) / PER_SHARD);
    const key = shardKey(chatId, shard);

    await puter.kv.add(key, [{ number, text, at: Date.now() }]);

    if ( number % PER_SHARD === 1 ) {
        await puter.kv.expire(key, 60 * 60 * 24 * 90);   // 90 days after the shard started
    }
}
```

Later messages keep the TTL, so a shard is deleted 90 days after its first
message. To delete a whole chat, delete the keys that start with `chat:<id>:`,
as in [Export or Delete Data](/recipes/export-or-delete-data/#delete-everything-of-one-kind).

## Full Code

```js
const PER_SHARD = 50;

const shardKey = (chatId, shard) =>
    `chat:${ chatId }:shard:${ String(shard).padStart(6, '0') }`;

async function addMessage (chatId, text) {
    const number = await puter.kv.incr(`chat:${ chatId }:count`);
    const shard = Math.floor((number - 1) / PER_SHARD);
    const key = shardKey(chatId, shard);

    await puter.kv.add(key, [{ number, text, at: Date.now() }]);

    if ( number % PER_SHARD === 1 ) {
        await puter.kv.expire(key, 60 * 60 * 24 * 90);   // 90 days after the shard started
    }
}

async function latestShard (chatId) {
    const count = await puter.kv.get(`chat:${ chatId }:count`) ?? 0;
    return Math.floor((count - 1) / PER_SHARD);   // -1 when there are no messages
}

async function readShard (chatId, shard) {
    const messages = await puter.kv.get(shardKey(chatId, shard)) ?? [];
    return messages.sort((a, b) => a.number - b.number);
}

async function readAll (chatId) {
    const all = [];

    for await ( const page of puter.kv.list({ pattern: `chat:${ chatId }:shard:`, returnValues: true, stream: true }) ) {
        for ( const { value } of page.items ) {
            all.push(...value);
        }
    }
    return all.sort((a, b) => a.number - b.number);
}
```
