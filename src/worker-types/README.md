# @heyputer/worker-types

TypeScript type definitions for the [Puter Workers](https://docs.puter.com/Workers/router) runtime.

Adds type-checking and autocomplete for the globals the runtime injects into every worker — `router`, `me`, `my`, `myself`, `puter_auth`, `puter_endpoint` — plus typed route handlers with **automatic `params` inference** from path literals.

## Install

```sh
npm install --save-dev @heyputer/worker-types
```

## Setup

The recommended convention is to name worker files `*.worker.js` or `*.worker.ts` and opt them in to the global types either per-file or via a worker-only tsconfig. Globals don't leak into the rest of your project this way.

### File-scoped (works for any project)

Add a triple-slash reference at the top of each `*.worker.js` / `*.worker.ts` file:

```js
/// <reference types="@heyputer/worker-types" />

router.get('/api/hello', ({ request }) => {
    return { msg: 'hello' };
});
```

This is the line that the **New > Worker** action in the Puter GUI now adds automatically (the file is created as `New Worker.worker.js`).

### Project-wide for worker files only

If you have many workers and don't want to repeat the directive, add a worker-only `tsconfig.workers.json` that targets the `*.worker.ts` files:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@heyputer/worker-types"]
  },
  "include": ["**/*.worker.ts"]
}
```

Then exclude those same files from your main `tsconfig.json` so the worker globals don't bleed into the rest of your code:

```json
{
  "exclude": ["**/*.worker.ts"]
}
```

Run both with `tsc -p tsconfig.json && tsc -p tsconfig.workers.json`, or use TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html).

### Named imports (optional)

For users who prefer being explicit, the same types are exported by name. Importing anything pulls the globals into that file, so you don't also need the triple-slash reference:

```ts
import type { Handler, Router, WorkerEvent } from '@heyputer/worker-types';

const getPost: Handler<{ id: string }> = ({ params }) => ({ id: params.id });
router.get('/posts/:id', getPost);
```

## What you get

| Global | Type | Description |
|---|---|---|
| `router` | `Router` | Register handlers via `get`/`post`/`put`/`delete`/`options`/`custom`. |
| `me` | `{ puter: Puter }` | Deployer's Puter context (FS, KV, AI, auth, etc). |
| `my`, `myself` | `{ puter: Puter }` | Aliases for `me`. |
| `puter_auth` | `string` | Deployer's auth token (Cloudflare secret binding). |
| `puter_endpoint` | `string` | Puter API endpoint. |

The `event` object passed to a handler exposes:

- `request` — standard `Request`
- `params` — route params, **inferred from the path literal** (`'/posts/:id'` -> `{ id: string }`)
- `user` / `requestor` — caller's Puter context, present only when the worker is invoked with a `puter-auth` header (e.g. via `puter.workers.exec()`)

Handlers can return a `Response`, a string, a `Blob`/`ArrayBuffer`/`Uint8Array`/`ReadableStream`, or any JSON-serialisable value — the router wraps it for you.

## Param inference

Path literals are parsed at the type level, so destructuring `params` in a handler gives you exact keys:

```ts
router.get('/posts/:postId/comments/:commentId', ({ params }) => {
    params.postId;    // string
    params.commentId; // string
    // @ts-expect-error - 'foo' is not a param
    params.foo;
});

router.get('/files/*path', ({ params }) => {
    params.path; // string (wildcard captures the remainder)
});
```
