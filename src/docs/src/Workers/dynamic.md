---
title: Dynamic Workers
description: Deploy shared server-side code from inside a hosted website by dropping a .worker.js file into a __workers folder, with no deploy step and no worker to register.
platforms: [workers]
---

If you already [deploy your site to Puter](/deployments/#deploy-to-puter), dynamic workers let you add backend endpoints to it without managing workers separately.

A dynamic worker is server-side code that lives inside your hosted site and deploys itself on demand. Drop a file at `__workers/api.worker.js` next to your `index.html`, publish the site as you normally would, and `https://your-site.puter.site/__workers/api/...` starts serving it. There is no deploy step of its own, no worker name to register, and nothing to keep in sync between the site and its backend.

<div class="info">Dynamic workers are routed on <code>*.puter.site</code> only, and they don't appear in <code>puter.workers.list()</code> or the Developer Center. Read <a href="#limitations">Limitations</a> before you build on them.</div>

## Comparison

A regular [Serverless Worker](/Workers/) is a separate thing from the site that uses it: you deploy the worker, it gets its own `*.puter.work` subdomain, and from then on you keep the site and the worker in sync by hand — matching versions, updating URLs, remembering which worker belongs to which site.

With a dynamic worker, the code is just a file in the site, so:

- the site and its backend version together — same folder, same deploy, same backup;
- the URL is derived from where the file lives, so there is nothing to wire up;
- there is no worker record to create, rename, or clean up.

The tradeoff is that there are fewer tools for working with them: they don't show up in [`puter.workers.list()`](/Workers/list/) or the Developer Center. See [Limitations](#limitations).

## File Layout

Inside the directory your site is hosted from, create a folder named `__workers`. Every file directly inside it whose name ends in `.worker.js` is a dynamic worker.

```
my-site/
  index.html
  style.css
  __workers/
    api.worker.js           -> /__workers/api/...
    matchmaking.worker.js   -> /__workers/matchmaking/...
```

Two rules apply to the files:

- **Top level only.** `__workers/nested/thing.worker.js` is never deployed. The URL has room for one worker name, so there would be no way to point at a file inside a subfolder.
- **Allowed names.** The part before `.worker.js` must match `[a-z0-9_-]+` — lowercase letters, digits, underscore, hyphen. The name is also the URL path segment, so sticking to those characters keeps capitalization and URL encoding from getting in the way.

Anything else under `__workers/` — a README, a nested folder, a `helpers.js` — is ignored. It is not deployed, and it is not served either.

## Syntax

Dynamic workers are written exactly like regular workers, with the same [`router`](/Workers/router/) API and the same globals:

```js
// __workers/api.worker.js
router.get("/health", async () => {
  return { ok: true };
});

router.post("/scores/:game", async ({ request, params }) => {
  const body = await request.json();
  await me.puter.kv.set(`score:${params.game}:${body.player}`, body.score);
  return { saved: true };
});
```

Everything in the [`router`](/Workers/router/) documentation applies unchanged: [route parameters](/Workers/router/#route-parameters), [wildcards](/Workers/router/#wildcard-routes), [`me.puter` and `user.puter`](/Workers/router/#integration-with-puter-js), [CORS](/Workers/router/#cors), and returning objects vs. a `Response`.

## URLs and Path Mapping

```
https://<site>.puter.site/__workers/<worker>/<path>
```

The `/__workers/<worker>` prefix is stripped before the request reaches your code; the worker sees the remainder:

| Request | Worker sees |
| --- | --- |
| `/__workers/api` | `/` |
| `/__workers/api/` | `/` |
| `/__workers/api/health` | `/health` |
| `/__workers/api/scores/chess?top=10` | `/scores/chess?top=10` |

Details worth knowing:

- The worker segment is read from the **URL-decoded** path and lowercased, so `/__workers/API/x` and `/__workers/%61pi/x` both reach `api`.
- The rest of the path keeps its original encoding — an encoded slash in your path stays encoded rather than becoming a real separator.
- Query strings are preserved. Fragments never leave the browser.

## Response Codes

| Code | Meaning |
| --- | --- |
| `404` | No such worker file under the site's `__workers/`, or the file is in a subfolder or misnamed. |
| `503` | The file exists but the worker could not be started. Worth retrying — it never means the worker isn't there. |
| Your own | Anything your handler returns. |

## Limitations

**`puter.site` only.** Dynamic workers are routed on the primary hosting domain. The alternate hosting domain and `puter.app` (private apps) are not routed yet, and custom domains aren't supported.

**Not listed by the Workers API.** [`puter.workers.list()`](/Workers/list/) and the Developer Center's Workers view do not show dynamic workers. They have no worker record by design: that's what saves you from keeping one in sync, and it's also why there's nothing to list.

**One sandbox per site.** All of a site's workers share the same KV and AppData namespace, so they can read and write each other's data. That's intentional — it's how two workers in one site cooperate — but it means you can't keep one worker's data private from another in the same site.
