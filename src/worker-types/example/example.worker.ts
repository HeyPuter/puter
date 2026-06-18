// Smoke-test that exercises every shape the types are supposed to cover.
// This file is type-checked by `npm run typecheck` in this package.
//
// Note: no imports — the globals come from the ambient declarations in
// ../globals.d.ts (wired up via tsconfig.json's `types` field).

import type { Handler, WorkerEvent } from '..';

router.routing = true;
router.handleCors = false;

// Static path: params is `{}`.
router.get('/health', () => ({ ok: true }));

// String return.
router.get('/version', () => 'v1');

// Single :param — inferred as { id: string }.
router.get('/posts/:id', ({ params }) => {
    const _id: string = params.id;
    return { id: _id };
});

// Multiple :params — inferred as { id: string; cid: string }.
router.get('/posts/:id/comments/:cid', ({ params }) => {
    return `${params.id}/${params.cid}`;
});

// Wildcard *param — inferred as { path: string }.
router.get('/files/*path', ({ params }) => {
    return new Response(params.path);
});

// Authenticated handler: `user` is optional, but `user.puter` exposes the
// caller's full Puter SDK surface.
router.post('/echo', async ({ request, user }) => {
    const body = await request.text();
    if (user) {
        const profile = await user.puter.auth.getUser();
        return { from: profile.username, body };
    }
    return { body };
});

// Deployer's own resources via the `me` global.
router.get('/kv/:key', async ({ params }) => {
    const value = await me.puter.kv.get(params.key);
    return { value };
});

// Aliases for `me`.
router.get('/kv-my/:key', async ({ params }) => {
    return { value: await my.puter.kv.get(params.key) };
});
router.get('/kv-myself/:key', async ({ params }) => {
    return { value: await myself.puter.kv.get(params.key) };
});

// Env bindings.
router.get('/env', () => ({
    endpoint: puter_endpoint,
    authPrefix: puter_auth.slice(0, 4),
}));

// `custom` for non-standard methods.
router.custom('PATCH', '/posts/:id', ({ params }) => ({ patched: params.id }));

// Named-type usage — handlers declared outside `router.get(...)`:
const listPosts: Handler = () => [{ id: 1 }, { id: 2 }];
router.get('/posts', listPosts);

const getPost: Handler<{ id: string }> = ({ params }) => ({ id: params.id });
router.get('/posts2/:id', getPost);

// WorkerEvent reference works too.
function logEvent(event: WorkerEvent<{ id: string }>) {
    return event.params.id;
}
router.get('/log/:id', (event) => logEvent(event));
