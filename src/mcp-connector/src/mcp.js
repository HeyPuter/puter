// Minimal MCP (Model Context Protocol) server over the Streamable HTTP transport,
// wired onto the forked Puter worker router.
//
// `registerMcpRoutes(router)` attaches:
//   POST /  and  POST /mcp   -> MCP JSON-RPC endpoint
//   GET  /, /mcp, /health    -> discovery / health
//
// Tool handlers run against the caller's REAL puter.js instance, which the
// router builds from the Authorization: Bearer header (event.user.puter).

import { TOOL_MAP, listTools, asText } from './tools.js';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

const SERVER_INFO = {
    name: 'puter-mcp',
    title: 'Puter MCP Server',
    version: '0.1.0',
};

// JSON-RPC error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id ?? null, error };
}

function toolError(message) {
    return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Handle a single JSON-RPC message. Returns a response object, or `null` for
 * notifications (which must not produce a response).
 *
 * @param {object} msg   The parsed JSON-RPC message.
 * @param {object|undefined} userPuter  The caller's puter instance (or undefined if unauthenticated).
 */
async function handleMessage(msg, userPuter) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return rpcError(msg?.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC request');
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined;

    try {
        switch (method) {
            case 'initialize': {
                const requested = params?.protocolVersion;
                const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
                    ? requested
                    : PROTOCOL_VERSION;
                return rpcResult(id, {
                    protocolVersion,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: SERVER_INFO,
                    instructions:
                        'Puter MCP server. Authenticate with your own Puter token via the ' +
                        'Authorization: Bearer <token> header. Provides filesystem tools (fs_*), ' +
                        'static website hosting tools (hosting_*, served at <subdomain>.puter.site), ' +
                        'serverless worker tools (workers_*), app registration tools (apps_*, register a ' +
                        'launchable Puter app pointing at a URL), and puter.js documentation tools ' +
                        '(puter_docs_*). Puter Workers are built WITH puter.js and Puter authentication: ' +
                        'before writing worker code, call puter_docs_get with path "Workers/router".',
                });
            }

            case 'ping':
                return rpcResult(id, {});

            case 'notifications/initialized':
            case 'notifications/cancelled':
            case 'notifications/roots/list_changed':
                return null; // notifications get no response

            case 'tools/list':
                return rpcResult(id, { tools: listTools() });

            case 'tools/call':
                return await handleToolCall(id, params, userPuter);

            default:
                if (isNotification) return null;
                return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    } catch (err) {
        if (isNotification) return null;
        return rpcError(id, INTERNAL_ERROR, err?.message || 'Internal error');
    }
}

async function handleToolCall(id, params, userPuter) {
    const name = params?.name;
    const tool = name && TOOL_MAP.get(name);
    if (!tool) {
        return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    if (!userPuter) {
        // Surface auth problems as a tool error so MCP clients display it inline.
        return rpcResult(id, toolError('Missing Authorization: Bearer <puter-token> header.'));
    }

    const args = params.arguments || {};
    try {
        const value = await tool.handler(userPuter, args);

        // Handlers may return { text } to emit raw text, otherwise we JSON-encode.
        const text = value && typeof value === 'object' && typeof value.text === 'string'
            ? value.text
            : asText(value);
        const result = { content: [{ type: 'text', text }] };
        if (value && typeof value === 'object' && value._meta) result._meta = value._meta;
        return rpcResult(id, result);
    } catch (err) {
        return rpcResult(id, toolError(formatPuterError(err)));
    }
}

// puter.js rejects with various shapes (Error, {error}, {message,code}, string).
function formatPuterError(err) {
    if (!err) return 'Tool execution failed';
    if (typeof err === 'string') return err;
    if (err.message) return err.code ? `${err.message} (${err.code})` : err.message;
    if (err.error) return typeof err.error === 'string' ? err.error : (err.error.message || JSON.stringify(err.error));
    try {
        return JSON.stringify(err);
    } catch {
        return 'Tool execution failed';
    }
}

function jsonResponse(body) {
    return new Response(JSON.stringify(body), {
        status: 200,
        // Per-user MCP results must never be cached by any CDN in front of the
        // worker. (POST isn't cached by default, but be explicit — a misconfigured
        // edge cache that ignores method/query could otherwise leak responses.)
        headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

// MCP Streamable HTTP POST handler (one request object or a batch array).
async function mcpPost(event) {
    const userPuter = event.user && event.user.puter;

    // No bearer token: this is a protected resource, so reply 401 with a
    // WWW-Authenticate pointing at our resource metadata. That's the signal an
    // MCP client (e.g. Claude Code) uses to start the OAuth flow (/authorize).
    // Clients that pass Authorization: Bearer never hit this branch.
    if (!userPuter) {
        const origin = new URL(event.request.url).origin;
        return new Response(
            JSON.stringify(rpcError(null, INVALID_REQUEST, 'Authentication required')),
            {
                status: 401,
                headers: {
                    'content-type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                    'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
                },
            },
        );
    }

    let payload;
    try {
        payload = await event.request.json();
    } catch {
        return jsonResponse(rpcError(null, PARSE_ERROR, 'Invalid JSON body'));
    }

    if (Array.isArray(payload)) {
        if (payload.length === 0) {
            return jsonResponse(rpcError(null, INVALID_REQUEST, 'Empty batch'));
        }
        const responses = (await Promise.all(payload.map((m) => handleMessage(m, userPuter)))).filter(Boolean);
        if (responses.length === 0) return new Response(null, { status: 202 });
        return jsonResponse(responses);
    }

    const response = await handleMessage(payload, userPuter);
    if (response === null) return new Response(null, { status: 202 }); // notification
    return jsonResponse(response);
}

// Discovery / health. This is the ONLY endpoint safe to cache: it's public,
// identical for every caller, and hammered by clients polling for the tool list.
// It's explicitly marked cacheable so a "respect-origin" CDN policy caches this
// and nothing else (every other response sends no-store).
function mcpInfo() {
    const body = {
        name: 'puter-mcp',
        description:
            'MCP server for Puter filesystem, static website hosting, serverless worker, and app registration operations. POST JSON-RPC to ' +
            'this endpoint with your Puter token in the Authorization: Bearer <token> header.',
        transport: 'streamable-http',
        tools: listTools().map((t) => t.name),
    };
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
        },
    });
}

/** Attach the MCP routes to the (already-initialized) router. */
export default function registerMcpRoutes(router) {
    router.post('/', mcpPost);
    router.post('/mcp', mcpPost);
    router.get('/', mcpInfo);
    router.get('/mcp', mcpInfo);
    router.get('/health', mcpInfo);
}
