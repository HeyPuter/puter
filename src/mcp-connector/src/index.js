import initS2w from './s2w-router.js';
import registerMcpRoutes from './mcp.js';

// Bring up the (forked) Puter worker router, then register the MCP routes on it.
initS2w();
registerMcpRoutes(globalThis.router);
