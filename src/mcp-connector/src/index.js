import initS2w from './s2w-router.js';
import registerMcpRoutes from './mcp.js';
import registerOAuthRoutes from './oauth.js';

// Bring up the (forked) Puter worker router, then register the routes on it.
initS2w();
registerMcpRoutes(globalThis.router);
// OAuth bridge — lets clients obtain the caller's Puter token via "Sign in with
// Puter" instead of pasting it. The Authorization: Bearer path is unchanged.
registerOAuthRoutes(globalThis.router);
