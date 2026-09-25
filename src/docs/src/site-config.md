---
title: Site Configuration
description: Configure custom error pages and single-page-app routing for a website hosted on Puter, using a .puter_site_config file.
---

A website hosted on Puter can customize how the server responds to it by placing a `.puter_site_config` file at the root of the site's directory. Today the file controls one thing: **which page is served when a request doesn't match a file** — which is also how you make client-side routing work for a single-page app.

The file is optional. Without it, a request for a path that doesn't exist gets Puter's default 404 page.

## Where the file goes

At the top level of the directory you published, next to your `index.html`. If you published `~/Desktop/my-site`, the file belongs at `~/Desktop/my-site/.puter_site_config`.

It is never served to visitors — a request for `/.puter_site_config` returns a 404 like any other path that isn't there.

## Single-page apps

If your app uses client-side routing (React Router, Vue Router, or similar), a visitor who loads `/dashboard` directly asks the server for a file at `/dashboard`, which doesn't exist. You want `index.html` to answer instead, with a normal `200`, and let your router take it from there:

```json
{
  "errors": {
    "404": {
      "file": "/index.html",
      "status": 200
    }
  }
}
```

Deploy that alongside your build output and deep links, refreshes, and shared URLs all work.

## Custom 404 page

Same idea, but you want a real error. Leave `status` out and the response keeps the `404` status, which is what you want for a genuine not-found page:

```json
{
  "errors": {
    "404": { "file": "/404.html" }
  }
}
```

## Reference

```json
{
  "errors": {
    "<status code>": {
      "file": "/path/to/page.html",
      "status": 200
    }
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `errors` | object | yes | Maps an HTTP status code to the page served for it. The only top-level key. |
| `errors.<code>` | object | — | The status code being handled, as a string key. Must be between `400` and `599`. Currently only `404` takes effect. |
| `errors.<code>.file` | string | yes | Path to the page to serve, starting with `/` and relative to your site's root. |
| `errors.<code>.status` | number | no | The status code sent with the response, `200`–`599`. **Defaults to the code being handled** — so a rule for `404` returns `404` unless you say otherwise. Set it to `200` for single-page-app fallback. |

<div class="info">Codes other than <code>404</code> are accepted and validated, but are not yet used to serve a page. Write them if you like — they'll start working when support lands — but don't depend on them today.</div>

## Things to know

**Changes take up to a minute.** Site configs are cached for 60 seconds. After you edit or upload the file, give it a minute before concluding it didn't work.

**A broken config is ignored, not fatal.** If the file has a JSON syntax error, is larger than 64 KB, or doesn't match the shape above, Puter serves your site as though the file weren't there. Your site never goes down because of a bad config — but a typo also fails quietly, so check that the behavior actually changed rather than assuming it did.

**A missing error page falls back.** If `file` points at a page that isn't there, the visitor gets Puter's default 404. There's no redirect loop.

**Paths can't escape your site.** `file` is resolved inside your site's root directory. `..` segments are stripped, so a config can't reach anything you didn't publish.

## What isn't supported

`.puter_site_config` does not do redirects, URL rewrites, custom response headers, clean URLs, cache-control rules, or directory listings. If you're porting a `_redirects` or `vercel.json` file from another host, only the error-page part has an equivalent here.

Two rewrites always happen and need no configuration: a request for `/` or for any folder path is served that folder's `index.html`.

## Publishing

For how to get your site onto Puter in the first place — from puter.com, the CLI, or GitHub Actions — see [Deployments](/deployments). To create and manage sites programmatically, see the [Hosting API](/Hosting).
