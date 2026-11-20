import { spawn } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

// `open` launches a browser; capture the URL instead.
const loadInitWithOpenStub = () => {
    const opened = [];
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if ( request === 'open' ) {
            return { default: (url) => opened.push(url) };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve('./init.cjs')];
        const { getAuthToken } = require('./init.cjs');
        return { getAuthToken, opened };
    } finally {
        Module._load = originalLoad;
    }
};

describe('node getAuthToken loopback callback', () => {
    it('requires the callback state and consumes only the first valid token', async () => {
        const { getAuthToken, opened } = loadInitWithOpenStub();
        const servers = [];
        const createServer = http.createServer;
        const serverSpy = vi.spyOn(http, 'createServer').mockImplementation((...args) => {
            const server = createServer(...args);
            servers.push(server);
            return server;
        });
        let pending;
        try {
            pending = getAuthToken('https://puter.com');
        } finally {
            serverSpy.mockRestore();
        }
        await vi.waitFor(() => expect(opened).toHaveLength(1));
        const signIn = new URL(opened[0]);
        const redirect = new URL(signIn.searchParams.get('redirectURL'));
        const state = redirect.searchParams.get('state');
        const forged = new URL(redirect);
        forged.search = '?token=unrelated-token';
        const invalid = await fetch(forged);
        redirect.searchParams.set('token', 'valid-token');
        const wrongState = new URL(redirect);
        wrongState.searchParams.set('state', 'wrong-state');
        expect((await fetch(wrongState)).status).toBe(400);
        const favicon = new URL(redirect);
        favicon.pathname = '/favicon.ico';
        expect((await fetch(favicon)).status).toBe(400);
        expect((await fetch(redirect, { method: 'POST' })).status).toBe(400);
        const malformedStatus = await new Promise((resolve, reject) => {
            const request = http.request({
                hostname: '127.0.0.1', port: redirect.port, path: '//[',
            }, response => {
                response.resume();
                resolve(response.statusCode);
            });
            request.once('error', reject);
            request.end();
        });
        expect(malformedStatus).toBe(400);
        expect(servers[0].address().address).toBe('127.0.0.1');
        const valid = await fetch(redirect);
        const token = await pending;
        expect(redirect.hostname).toBe('127.0.0.1');
        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(invalid.status).toBe(400);
        expect(valid.status).toBe(200);
        expect(token).toBe('valid-token');
        await expect(fetch(redirect)).rejects.toThrow();
    });
});

describe('node init with a token', () => {
    // Runs the built bundle in a child process against a real socket.io
    // server. The child holds the event loop with a timer only until the
    // server's probe arrives, so a prompt exit means the open socket isn't
    // what keeps it alive.
    it('exits on its own while its socket stays connected', async () => {
        const { Server } = require('socket.io');
        const server = http.createServer((req, res) => {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        const io = new Server(server);
        let connections = 0;
        io.on('connection', (socket) => {
            connections++;
            socket.emit('probe');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

        let child;
        try {
            const origin = `http://127.0.0.1:${server.address().port}`;
            const script = `
                globalThis.PUTER_API_ORIGIN = ${JSON.stringify(origin)};
                const puter = require(${JSON.stringify(require.resolve('./init.cjs'))}).init('token');
                const hold = setTimeout(() => {}, 10000);
                puter.fs.socket.on('probe', () => {
                    console.log('probe received');
                    clearTimeout(hold);
                });
            `;
            child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
            let stdout = '';
            child.stdout.on('data', chunk => {
                stdout += chunk;
            });
            const started = Date.now();
            const code = await new Promise(resolve => child.on('exit', resolve));

            expect(stdout).toContain('probe received');
            expect(code).toBe(0);
            expect(connections).toBe(1);
            expect(Date.now() - started).toBeLessThan(8000);
        } finally {
            child?.kill();
            io.close();
            server.close();
        }
    }, 20000);
});
