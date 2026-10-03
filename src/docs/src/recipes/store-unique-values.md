---
title: Store a Set of Unique Values
description: "Learn how to keep a set of unique values, such as liked posts, tags or bookmarks, in one Puter.js key-value entry, so each value is stored once however often it is added."
tags: [kv, data-modeling]
order: 25
---

Some lists should never hold the same value twice: the posts a user liked, the
tags on a note, the pages they bookmarked. In JavaScript you would use a
[`Set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set)
for this, and databases such as Redis have a set type with commands like `SADD`
and `SREM`.

[`puter.kv`](/KV/), the key-value database in Puter.js, has no set type, but an
object works as one. Each value in the set becomes a field name, with `true` as
the field's value:

```js
{
    'post-81': true,
    'post-102': true,
}
```

An object can't have the same field name twice, so the set never holds
duplicates. An array with [`puter.kv.add()`](/KV/add/) doesn't work for this,
since it appends whatever you give it, including a value that is already there.

## Add a Value

To add a value, use the [`puter.kv.update()`](/KV/update/) method with the value
as the field name:

```js
await puter.kv.update('likedPosts', { [postId]: true });
```

If the key doesn't exist yet, it is created. Adding a value that is already in
the set changes nothing, so a double click, or the same call from two tabs, is
safe. A call you can repeat without changing the result is called idempotent.

The method returns the whole set after the change, so you don't need another
read to show it:

```js
const liked = await puter.kv.update('likedPosts', { [postId]: true });
// { 'post-81': true, 'post-102': true }
```

To add several values, put them all in one object. They are saved in a single
write:

```js
await puter.kv.update('likedPosts', { 'post-7': true, 'post-9': true });
```

## Store Values with Dots or Quotes

The field name you pass to [`puter.kv.update()`](/KV/update/) is read as a path,
the same as in [Store a Small List](/recipes/store-small-list/). A dot means "go
into a nested object", so a URL or a tag such as `v1.2` would be split at its
dots. To store the value as one field name, wrap it in brackets and quotes, and
put a backslash before any quote or backslash inside it. This small helper does
that:

```js
const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

await puter.kv.update('bookmarks', { [member('https://example.com/a.html')]: true });
// { 'https://example.com/a.html': true }
```

Use `member()` for any value a user typed or that comes from outside your app.
IDs made with
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
contain no dots, so they work without it, as in [Store Items by
ID](/recipes/store-items-by-id/).

## Remove a Value

To take a value out, use the [`puter.kv.remove()`](/KV/remove/) method:

```js
await puter.kv.remove('bookmarks', member(url));
```

Removing a value that isn't in the set does nothing, and doesn't throw. Like
[`puter.kv.update()`](/KV/update/), the method returns the set after the change.

To remove several values, pass each one as its own argument. A call that names
the same value twice is rejected with `bad_request`, so remove duplicates
first:

```js
await puter.kv.remove('tags', ...[ ...new Set(tagsToRemove) ].map(member));
```

## Check and List the Values

To read the set, use the [`puter.kv.get()`](/KV/get/) method. A set that was
never written reads as `null`, and a set whose values were all removed reads as
`{}`, so default it to an empty object:

```js
const bookmarks = await puter.kv.get('bookmarks') ?? {};

const isSaved = bookmarks[url] === true;
const urls = Object.keys(bookmarks);
const count = urls.length;
```

## Build a Like Button

A like button switches between liked and not liked. Send the state the user
chose, instead of reading the stored value and writing the opposite:

```js
async function setLiked (postId, liked) {
    if ( liked ) {
        await puter.kv.update('likedPosts', { [member(postId)]: true });
    } else {
        await puter.kv.remove('likedPosts', member(postId));
    }
}

likeButton.addEventListener('click', async () => {
    const liked = likeButton.classList.toggle('liked');
    await setLiked(postId, liked);
});
```

Reading and then writing the opposite takes two calls, and another tab can
change the value in between, so the two tabs can undo each other. Sending the
state takes one call, and sending it twice gives the same result.

## Keep the Order Values Were Added

The order of an object's fields isn't kept when it is stored. To show values
newest first, such as recent searches, store the time instead of `true` and
sort when you read:

```js
await puter.kv.update('recentSearches', { [member(query)]: Date.now() });

const searches = await puter.kv.get('recentSearches') ?? {};
const newestFirst = Object.entries(searches)
    .sort((a, b) => b[1] - a[1])
    .map(([ query ]) => query);
```

Searching for the same thing again moves it to the top instead of adding a
second copy. To keep only the last 20, remove the rest:

```js
const old = newestFirst.slice(20);

if ( old.length > 0 ) {
    await puter.kv.remove('recentSearches', ...old.map(member));
}
```

## When to Switch

One entry holds up to [400 KB](/KV/MAX_VALUE_SIZE/), which is a few thousand
short values. For a set that can grow past that, such as every post a user has
ever liked, give each value its own key instead. Keys are unique too, so it is
still a set:

```js
await puter.kv.set(`liked:${ postId }`, true);                      // add
await puter.kv.del(`liked:${ postId }`);                            // remove
const isLiked = await puter.kv.get(`liked:${ postId }`) !== null;   // check
```

To list the values, read the keys that start with `liked:`, as shown in [Store
a Large Collection](/recipes/store-large-collection/).

## Notes

- The empty string, `__proto__`, `constructor` and `prototype` can't be field
  names, and a call that uses one is rejected with `bad_request`. If users can
  type any value, put a fixed prefix in front of it, such as `member('tag:' +
  value)`.
- One call to [`puter.kv.update()`](/KV/update/) or
  [`puter.kv.remove()`](/KV/remove/) fits about 140 short values. Split larger
  changes across several calls.
- Like everything in `puter.kv`, the set belongs to the signed-in user and your
  app. Each user has their own set.
