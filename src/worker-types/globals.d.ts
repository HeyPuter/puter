// Ambient declarations for the Puter Workers runtime.
//
// When this file is loaded (via `"types": ["@heyputer/worker-types"]` in
// tsconfig.json or `/// <reference types="@heyputer/worker-types" />` at the
// top of a .js/.ts file), the worker globals — `router`, `me`, `my`,
// `myself`, `puter_auth`, `puter_endpoint` — are visible everywhere with no
// imports required, matching how the runtime actually injects them.

import type { Puter } from '@heyputer/puter.js';
import type { Router } from './types/router.d.ts';
import type { PuterContext } from './types/event.d.ts';

declare global {
    /** The deployer's Puter context, authenticated with the worker's own credentials. */
    const me: PuterContext;
    /** @deprecated Alias for {@link me}. Will be removed at a future date. */
    const my: PuterContext;
    /** @deprecated Alias for {@link me}. Will be removed at a future date. */
    const myself: PuterContext;

    /** The router used to register HTTP route handlers. */
    const router: Router;

    /** @deprecated The deployer's Puter auth token, provided as a Cloudflare secret binding. Will be removed at a future date. Use me.puter.authToken */
    const puter_auth: string;

    /** @deprecated The Puter API endpoint, provided as a Cloudflare plaintext binding. Defaults to `https://api.puter.com`. Will be removed at a future date. use me.puter.APIOrigin */
    const puter_endpoint: string;
}

export type { Puter, Router, PuterContext };
