#!/usr/bin/env node
//
// Puter MCP connector — local stdio <-> remote HTTP proxy.
//
// The Puter MCP server is a REMOTE Cloudflare Worker (Streamable HTTP). MCPB
// extensions, however, launch a LOCAL server process that speaks MCP over
// stdio. This tiny zero-dependency proxy bridges the two: it reads newline-
// delimited JSON-RPC messages from stdin, POSTs each to the Worker with the
// caller's Puter token attached as `Authorization: Bearer <token>`, and writes
// the Worker's JSON response back to stdout.
//
// Config comes from environment variables (populated by the MCPB host from
// user_config — see manifest.json):
//   PUTER_MCP_URL  - URL of your deployed Worker (e.g. https://...workers.dev/)
//   PUTER_TOKEN    - your personal Puter auth token
//
// Uses only Node built-ins so the bundle needs no node_modules.

'use strict';

const http = require('node:http');
const https = require('node:https');
const readline = require('node:readline');
const { URL } = require('node:url');

const ENDPOINT = process.env.PUTER_MCP_URL;
const TOKEN = process.env.PUTER_TOKEN || '';

const logErr = (...parts) => process.stderr.write(`[puter-mcp] ${parts.join(' ')}\n`);

if (!ENDPOINT) {
    logErr('FATAL: PUTER_MCP_URL is not set. Configure the "Server URL" in the extension settings.');
    process.exit(1);
}

let endpointUrl;
try {
    endpointUrl = new URL(ENDPOINT);
} catch {
    logErr(`FATAL: PUTER_MCP_URL is not a valid URL: ${ENDPOINT}`);
    process.exit(1);
}
const transport = endpointUrl.protocol === 'https:' ? https : http;

// POST one raw JSON-RPC line to the Worker. Resolves to {status, text} or {error}.
function forward(rawLine) {
    return new Promise((resolve) => {
        const body = Buffer.from(rawLine, 'utf8');
        const headers = {
            'content-type': 'application/json',
            accept: 'application/json',
            'content-length': body.length,
        };
        if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

        const req = transport.request(
            endpointUrl,
            { method: 'POST', headers },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
                );
            },
        );
        req.on('error', (error) => resolve({ error }));
        req.write(body);
        req.end();
    });
}

function writeMessage(text) {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

// Requests are forwarded concurrently; don't exit on stdin EOF until every
// in-flight request has resolved (otherwise piped input loses its responses).
let pending = 0;
let stdinClosed = false;
const maybeExit = () => {
    if (stdinClosed && pending === 0) process.exit(0);
};

async function handleLine(raw) {
    // Best-effort parse only to recover an id for error reporting.
    let id;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && !Array.isArray(parsed)) id = parsed.id;
    } catch {
        // Not our problem to validate — let the server reject it.
    }

    const res = await forward(raw);

    if (res.error) {
        logErr(`request failed: ${res.error.message}`);
        // Only requests (with an id) expect a response.
        if (id !== undefined && id !== null) {
            writeMessage(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32000, message: `Cannot reach Puter MCP server: ${res.error.message}` },
                }),
            );
        }
        return;
    }

    // 202 (notification ack) or an empty body => nothing to relay.
    if (res.status === 202 || !res.text) return;
    writeMessage(res.text);
}

rl.on('line', (line) => {
    const raw = line.trim();
    if (!raw) return;
    pending += 1;
    handleLine(raw).finally(() => {
        pending -= 1;
        maybeExit();
    });
});

rl.on('close', () => {
    stdinClosed = true;
    maybeExit();
});
