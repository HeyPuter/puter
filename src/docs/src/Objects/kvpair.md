---
title: KVPair
description: A key and its value, as puter.kv.list() returns them.
---

A key and its value, as [`puter.kv.list()`](/KV/list/) returns them when `returnValues` is `true`.

## Attributes

#### `key` (String)

The key. Through a share's `handle`, it's relative to the shared prefix.

#### `value` (Any)

The value stored at the key, of any type that [`puter.kv.set()`](/KV/set/) stores.
