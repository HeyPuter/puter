---
title: Store a Set of Unique Values
description: "Learn how to store a set of unique values, like liked posts or tags, in one Puter.js key-value entry so nothing gets added twice."
tags: [kv, data-modeling]
order: 25
---

Some lists should never contain the same value twice, like the posts a user
liked or the tags on a note. In JavaScript you'd use a
[`Set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set)
for this.

[`puter.kv`](/KV/) doesn't have a set type, but an object works just as well.
Store each value as a field name, with `true` as its value:

```js
{
    'post-81': true,
    'post-102': true,
}
```

An object can't have the same field twice, so there are never duplicates. An
array doesn't work here, because [`puter.kv.add()`](/KV/add/) appends a value
even if it's already in the list.

## Add a Value

To add a value, use the [`puter.kv.update()`](/KV/update/) method with the value
as the field name:

```js
await puter.kv.update('likedPosts', { [postId]: true });
```

If the key doesn't exist yet, it's created. Adding a value that's already there
changes nothing, so a double click or the same call from two tabs is harmless.

The method returns the whole set after the change:

```js
const liked = await puter.kv.update('likedPosts', { [postId]: true });
// { 'post-81': true, 'post-102': true }
```

To add several values at once, put them all in the same object:

```js
await puter.kv.update('likedPosts', { 'post-7': true, 'post-9': true });
```

## Store Values with Dots or Quotes

The field name is read as a path, where a dot means "go into a nested object".
A value like a URL or `v1.2` would get split at its dots. To keep it as one
name, wrap it in brackets and quotes, and escape any quotes or backslashes
inside it. This helper does both:

```js
const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

await puter.kv.update('bookmarks', { [member('https://example.com/a.html')]: true });
// { 'https://example.com/a.html': true }
```

Use `member()` for anything a user typed or that comes from outside your app.
IDs from
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
don't contain dots, so they're fine without it.

## Remove a Value

To remove a value, use the [`puter.kv.remove()`](/KV/remove/) method:

```js
await puter.kv.remove('bookmarks', member(url));
```

Removing a value that isn't in the set does nothing. To remove several at once,
pass each one as a separate argument. Passing the same value twice in one call
is rejected with `bad_request`, so remove duplicates first:

```js
await puter.kv.remove('tags', ...[ ...new Set(tagsToRemove) ].map(member));
```

## Check and List the Values

To read the set, use the [`puter.kv.get()`](/KV/get/) method. It returns `null`
if nothing was ever saved, and `{}` once every value has been removed, so
default it to an empty object:

```js
const bookmarks = await puter.kv.get('bookmarks') ?? {};

const isSaved = bookmarks[url] === true;
const urls = Object.keys(bookmarks);
const count = urls.length;
```

## Build a Like Button

For a like button, save the state the user picked instead of flipping whatever
is stored:

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

If you read the stored value and write the opposite, two tabs clicking at the
same time can cancel each other out. Saving the state directly avoids that.

## Keep the Order Values Were Added

Objects don't keep their field order when they're stored. If you need newest
first, like for recent searches, store a timestamp instead of `true` and sort
when you read:

```js
await puter.kv.update('recentSearches', { [member(query)]: Date.now() });

const searches = await puter.kv.get('recentSearches') ?? {};
const newestFirst = Object.entries(searches)
    .sort((a, b) => b[1] - a[1])
    .map(([ query ]) => query);
```

Searching for something again moves it back to the top instead of adding a
duplicate. To keep only the last 20:

```js
const old = newestFirst.slice(20);

if ( old.length > 0 ) {
    await puter.kv.remove('recentSearches', ...old.map(member));
}
```

## When to Switch

One entry holds up to [400 KB](/KV/MAX_VALUE_SIZE/), which is a few thousand
short values. If the set can get bigger than that, like every post a user has
ever liked, give each value its own key instead:

```js
await puter.kv.set(`liked:${ postId }`, true);                      // add
await puter.kv.del(`liked:${ postId }`);                            // remove
const isLiked = await puter.kv.get(`liked:${ postId }`) !== null;   // check
```

To list them, read every key that starts with `liked:`, as shown in [Store a
Large Collection](/recipes/store-large-collection/).

## Notes

- Empty strings, `__proto__`, `constructor` and `prototype` can't be used as
  field names and are rejected with `bad_request`. If users can type anything,
  add a prefix, like `member('tag:' + value)`.
- One `update()` or `remove()` call can handle about 140 short values. Split
  bigger changes into several calls.
