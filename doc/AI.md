# KV List API

The KV List API is used to retrieve a list of items stored in the KV store. The list is returned in a sorted manner.

## Overview
The KV list API returns a list of items in the KV store, sorted lexicographically by key.

## Example
```bash
curl https://api.puter.com/kv/list
```
This will return a list of items in the KV store, sorted by key. For instance, if you have items with keys 'apple', 'banana', and 'cherry', the response will be sorted as ['apple', 'banana', 'cherry'].

## Sorting
The KV list API returns results sorted lexicographically by key. For more information on sorting, see the [KV guide](https://developer.puter.com/tutorials/kv-guide/#sorting).

## Playground
Try out the KV list API in the [playground](https://playground.puter.com).