---
title: TypeScript Types
description: Type-checking and autocomplete for Puter Workers via @heyputer/worker-types.
platforms: [workers]
---

The [`@heyputer/worker-types`](https://www.npmjs.com/package/@heyputer/worker-types) package adds TypeScript type definitions for the worker runtime — the `router`, `me`, `my`, `myself`, `puter_auth`, and `puter_endpoint` globals — plus typed route handlers with automatic `params` inference from path literals.

It's purely a development-time aid: it adds nothing to your deployed worker bundle.

## Install

```sh
npm install --save-dev @heyputer/worker-types
```

## Convention: `*.worker.js`

We recommend naming worker files `*.worker.js` (or `*.worker.ts`). This makes the worker-y parts of your project obvious in a file listing and lets you scope the worker globals to just those files — so `router`, `me`, etc. don't leak into the rest of your code.

The Puter GUI's **New > Worker** action creates files as `New Worker.worker.js` and includes the types reference at the top automatically.

## Setup

Pick whichever style fits your project.

### File-scoped (works for any project)

Add a triple-slash reference at the top of each `*.worker.js` / `*.worker.ts` file. This is the line the GUI now adds for you:

```js
/// <reference types="@heyputer/worker-types" />

router.get('/api/hello', ({ request }) => {
    return { msg: 'hello' };
});
```

### Project-wide for worker files only

For projects with many workers, add a worker-only `tsconfig.workers.json` that includes only `*.worker.ts` and pulls in the globals:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@heyputer/worker-types"]
  },
  "include": ["**/*.worker.ts"]
}
```

Then exclude the same files from your main `tsconfig.json`:

```json
{
  "exclude": ["**/*.worker.ts"]
}
```

Build both with `tsc -p tsconfig.json && tsc -p tsconfig.workers.json`, or wire them up with TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html).

### Named imports

For users who prefer being explicit:

```ts
import type { Handler, Router, WorkerEvent } from '@heyputer/worker-types';

const getPost: Handler<{ id: string }> = ({ params }) => ({ id: params.id });
router.get('/posts/:id', getPost);
```

Importing anything from the package also pulls the globals into that file, so you don't also need the triple-slash reference.

## Param inference

Path literals are parsed at the type level, so destructured `params` get exact keys without any annotation:

```ts
router.get('/posts/:postId/comments/:commentId', ({ params }) => {
    params.postId;    // string
    params.commentId; // string
});

router.get('/files/*path', ({ params }) => {
    params.path; // string — wildcard captures the remainder
});
```

## What's typed

| Global | Type | Description |
|---|---|---|
| `router` | `Router` | Register handlers via `get`/`post`/`put`/`delete`/`options`/`custom`. |
| `me` | `{ puter: Puter }` | Deployer's Puter context (FS, KV, AI, auth, etc). |
| `my`, `myself` | `{ puter: Puter }` | Aliases for `me`. |
| `puter_auth` | `string` | Deployer's auth token (Cloudflare secret binding). |
| `puter_endpoint` | `string` | Puter API endpoint. |

Handler events expose:

- `request` — standard [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)
- `params` — route params, inferred from the path literal
- `user` / `requestor` — caller's Puter context, present only when invoked with a `puter-auth` header (e.g. via [`puter.workers.exec()`](/Workers/exec/))
