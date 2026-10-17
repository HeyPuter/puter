---
title: Build an RSS Reader
description: "Learn how to fetch an RSS feed, cache its headlines in the user's key-value store and show links in your app with Puter.js."
tags: [net, kv]
order: 70
---

An RSS reader fetches a feed and shows links to its latest articles. Use
[`puter.net.fetch()`](/Networking/fetch/) to read feeds that do not allow
cross-origin requests, then cache the headlines with
[`puter.kv`](/KV/) so reopening the app does not fetch the same feed again.

This example keeps up to 20 headlines for five minutes and lets the user
refresh them sooner. The cache belongs to the signed-in user, inside your
app's key-value store.

## Read the Feed

Fetch the XML, check the HTTP status, and parse it with the browser's
[DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString).
Read the title and link from each RSS `item`:

```js
async function readFeed(feedUrl) {
    const response = await puter.net.fetch(feedUrl);
    if (!response.ok) {
        throw new Error(`Could not load the feed (HTTP ${response.status}).`);
    }

    const xml = await response.text();
    const feed = new DOMParser().parseFromString(xml, 'application/xml');
    if (feed.querySelector('parsererror') || feed.documentElement.localName !== 'rss') {
        throw new Error('Expected a valid RSS feed.');
    }

    const articles = [];
    for (const item of feed.querySelectorAll('channel > item')) {
        const link = item.querySelector('link')?.textContent.trim();
        if (!link) continue;

        let url;
        try {
            url = new URL(link, response.url || feedUrl);
        } catch {
            continue;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;

        articles.push({
            title: (item.querySelector('title')?.textContent.trim() || 'Untitled').slice(0, 200),
            url: url.href,
        });
        if (articles.length === 20) break;
    }

    return articles;
}
```

The function returns plain objects that can go straight into KV. Items
without a valid HTTP or HTTPS link are left out. Relative links are resolved
against the feed's URL.

## Cache the Headlines

Use [`puter.kv.get()`](/KV/get/) to look for a cached result before fetching.
Pass an expiry to [`puter.kv.set()`](/KV/set/) so it goes away after five
minutes. The expiry is a Unix timestamp in seconds:

```js
async function loadFeed(feedUrl, refresh = false) {
    const key = `rss:cache:${feedUrl}`;
    if (!refresh) {
        const cached = await puter.kv.get(key);
        if (cached !== null) return cached;
    }

    const articles = await readFeed(feedUrl);
    const inFiveMinutes = Math.floor(Date.now() / 1000) + 5 * 60;
    await puter.kv.set(key, articles, inFiveMinutes);
    return articles;
}
```

A missing or expired key returns `null`. An empty feed returns an empty
array, which is cached too. Passing `true` for `refresh` fetches a new copy
and replaces the cache after the feed has been read successfully.

## Show the Headlines

Add these elements to a page that loads Puter.js:

```html
<script src="https://js.puter.com/v2/"></script>
<button id="refresh-feed" type="button">Refresh</button>
<p id="feed-status" role="status"></p>
<ul id="headlines"></ul>
```

Put the two functions above and this code in the same script, after the
elements. It loads a BBC News feed on opening and fetches a fresh copy when
the user clicks Refresh:

```js
const feedUrl = 'https://feeds.bbci.co.uk/news/rss.xml';
const refreshButton = document.getElementById('refresh-feed');
const status = document.getElementById('feed-status');
const list = document.getElementById('headlines');

async function showFeed(refresh = false) {
    refreshButton.disabled = true;
    status.textContent = 'Loading...';

    try {
        const articles = await loadFeed(feedUrl, refresh);
        const rows = articles.map((article) => {
            const row = document.createElement('li');
            const link = document.createElement('a');
            link.textContent = article.title;
            link.href = article.url;
            row.append(link);
            return row;
        });

        list.replaceChildren(...rows);
        status.textContent = articles.length ? 'Headlines loaded.' : 'No articles in this feed.';
    } catch (error) {
        const message = error?.message ?? error?.error?.message ?? error;
        status.textContent = `Could not load the headlines: ${message}`;
    } finally {
        refreshButton.disabled = false;
    }
}

refreshButton.addEventListener('click', () => showFeed(true));
showFeed();
```

Titles are assigned through `textContent`, so markup in a feed stays text.
If a refresh fails, the current headlines stay on the page and the status
shows the error.

## Notes

- This parser reads RSS feeds with `channel` and `item` elements. Atom feeds
  use a different format and need a different parser.
- `DOMParser` is a browser API, so these examples run in your app's page.
- Only titles and links are cached. For larger feed data, see
  [store files](/recipes/store-files/) and the [KV value size
  limit](/KV/MAX_VALUE_SIZE/).
- The cache expires even when the app is closed. It fetches a new copy the
  next time it loads the feed after expiry.
