/**
 * OnlyOffice <-> Puter bridge.
 *
 * OnlyOffice Document Server (running in its own Docker container) needs to:
 *   1. download the file being opened (`document.url` in the editor config)
 *   2. POST back to a `callbackUrl` when the user saves
 *
 * Both of those are server-to-server calls made by the Document Server
 * container, not the browser, so they need URLs the *container* can reach.
 * This bridge sits in between: it proxies the download from Puter's API,
 * and on save either overwrites the existing file (signed write_url) or
 * creates a new one (POST /batch with the app's auth token), then relays
 * back to the Document Server.
 *
 * Configuration is via environment variables (see .env.example) so the
 * same code runs unmodified in local dev and on the production VPS.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 8083;

// Origin the *browser* uses to load the OnlyOffice JS API (api.js) and
// render the editor iframe. Must be reachable from the user's machine.
const DOCSERVER_BROWSER_ORIGIN = process.env.DOCSERVER_BROWSER_ORIGIN || 'http://localhost:8082';

// Origin the OnlyOffice *container* uses to reach this bridge for
// downloads/callbacks. On a single VPS with both services in the same
// Docker network, this is typically the bridge's container/service name
// (e.g. http://onlyoffice-bridge:8083); for a Mac/Docker Desktop dev setup
// it's http://host.docker.internal:8083.
const BRIDGE_CONTAINER_ORIGIN = process.env.BRIDGE_CONTAINER_ORIGIN || 'http://host.docker.internal:8083';

// Puter's API origin, as reached *from this bridge process* (not from the
// browser and not from the OnlyOffice container). On the same host this
// is usually http://api.<domain> or, for local dev, http://api.puter.localhost:4100.
const PUTER_API_ORIGIN = process.env.PUTER_API_ORIGIN || 'http://api.puter.localhost:4100';

const EDITOR_HTML_TEMPLATE = fs.readFileSync(path.join(__dirname, 'editor.html'), 'utf8');
const EDITOR_HTML = EDITOR_HTML_TEMPLATE
    .replaceAll('__DOCSERVER_BROWSER_ORIGIN__', DOCSERVER_BROWSER_ORIGIN)
    .replaceAll('__BRIDGE_CONTAINER_ORIGIN__', BRIDGE_CONTAINER_ORIGIN);

const BLANK_TEMPLATES = {
    word: { file: 'blank.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    cell: { file: 'blank.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    slide: { file: 'blank.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};

function send(res, status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(body);
}

// Node's own DNS resolution doesn't special-case *.localhost the way
// curl/browsers do on some systems (getaddrinfo ENOTFOUND for e.g.
// api.puter.localhost), even though it resolves fine everywhere else.
// Force the connection to 127.0.0.1 for *.localhost targets while keeping
// the original Host header, since Puter's routing is host-based. This is
// a no-op (and harmless) once PUTER_API_ORIGIN points at a real domain.
function fetchLocal(targetUrl, { method = 'GET', body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(targetUrl);
        const isDotLocalhost = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.request({
            hostname: isDotLocalhost ? '127.0.0.1' : u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method,
            headers: { ...headers, Host: u.host },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                buffer: () => Buffer.concat(chunks),
                text: () => Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// /writeFile (signed-URL overwrite) parses the body with busboy and just
// wants a single `file` part — no other fields required.
function buildSimpleFileMultipart(filename, mime, fileBuf) {
    const boundary = '----puterWrite' + crypto.randomBytes(16).toString('hex');
    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return { body: Buffer.concat([head, fileBuf, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Builds a minimal multipart/form-data body for Puter's /batch endpoint:
// one 'write' operation targeting `parentPath`/`name`, paired with the
// file bytes. Mirrors what puter-js's upload() sends, minus the
// progress-socket fields (those are optional on the server).
function buildBatchWriteMultipart({ parentPath, name, mime, fileBuf }) {
    const boundary = '----puterBatch' + crypto.randomBytes(16).toString('hex');
    const op = JSON.stringify({
        op: 'write',
        path: parentPath,
        name,
        dedupe_name: true,
        overwrite: false,
        create_missing_ancestors: true,
    });
    const fileinfo = JSON.stringify({ name, type: mime, size: fileBuf.length });

    const parts = [];
    const field = (fieldName, value) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`;

    parts.push(field('operation', op));
    parts.push(field('fileinfo', fileinfo));
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    );
    const head = Buffer.from(parts.join(''), 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, fileBuf, tail]);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);

    if (reqUrl.pathname === '/editor.html') {
        return send(res, 200, EDITOR_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (reqUrl.pathname === '/blank') {
        const kind = reqUrl.searchParams.get('type');
        const tpl = BLANK_TEMPLATES[kind];
        if (!tpl) return send(res, 400, 'unknown blank type');
        const buf = fs.readFileSync(path.join(__dirname, tpl.file));
        return send(res, 200, buf, { 'Content-Type': tpl.mime });
    }

    // Proxies a Puter read_url so the OnlyOffice container (which cannot
    // resolve puter.localhost in local dev) can fetch the document through
    // this bridge, which runs on the host/network and resolves it fine.
    if (reqUrl.pathname === '/download') {
        const target = reqUrl.searchParams.get('u');
        if (!target) return send(res, 400, 'missing u');
        console.log('[download] fetching', target);
        fetchLocal(target).then((r) => {
            if (r.status !== 200) {
                console.error('[download] upstream error', r.status, r.text());
                return send(res, 502, 'upstream error ' + r.status);
            }
            send(res, 200, r.buffer(), { 'Content-Type': 'application/octet-stream' });
        }).catch((e) => {
            console.error('[download] error', e.message);
            send(res, 502, 'fetch failed: ' + e.message);
        });
        return;
    }

    // OnlyOffice Document Server POSTs here on save events.
    if (reqUrl.pathname === '/callback' && req.method === 'POST') {
        const writeUrl = reqUrl.searchParams.get('write_url');
        const createMode = reqUrl.searchParams.get('create') === '1';
        const authToken = reqUrl.searchParams.get('auth_token');
        const title = reqUrl.searchParams.get('title');
        const mime = reqUrl.searchParams.get('mime');

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            console.log('[callback] body:', body);
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch (e) {
                console.error('[callback] bad JSON', e.message);
                return send(res, 200, JSON.stringify({ error: 0 }), { 'Content-Type': 'application/json' });
            }
            // status 2 = ready to save, 6 = force-save while still editing
            if (parsed.status === 2 || parsed.status === 6) {
                try {
                    console.log('[callback] downloading edited file from', parsed.url);
                    const fileResp = await fetchLocal(parsed.url);
                    const fileBuf = fileResp.buffer();

                    if (createMode) {
                        console.log('[callback:create] creating', title, 'via /batch,', fileBuf.length, 'bytes');
                        const { body: multipartBody, contentType } = buildBatchWriteMultipart({
                            parentPath: '~/Desktop',
                            name: title,
                            mime,
                            fileBuf,
                        });
                        const batchResp = await fetchLocal(PUTER_API_ORIGIN + '/batch', {
                            method: 'POST',
                            body: multipartBody,
                            headers: {
                                'Content-Type': contentType,
                                'Authorization': 'Bearer ' + authToken,
                            },
                        });
                        console.log('[callback:create] /batch response', batchResp.status, batchResp.text());
                    } else {
                        console.log('[callback] uploading', fileBuf.length, 'bytes to write_url');
                        const { body: mpBody, contentType } = buildSimpleFileMultipart(
                            title || 'documento',
                            mime || 'application/octet-stream',
                            fileBuf,
                        );
                        const putResp = await fetchLocal(writeUrl, {
                            method: 'POST',
                            body: mpBody,
                            headers: {
                                'Content-Type': contentType,
                                'Authorization': 'Bearer ' + authToken,
                            },
                        });
                        console.log('[callback] write_url response status', putResp.status, putResp.text());
                    }
                } catch (e) {
                    console.error('[callback] save relay failed', e.message);
                }
            }
            send(res, 200, JSON.stringify({ error: 0 }), { 'Content-Type': 'application/json' });
        });
        return;
    }

    send(res, 404, 'not found');
});

server.listen(PORT, () => {
    console.log(`OnlyOffice bridge listening on http://0.0.0.0:${PORT}`);
    console.log(`  DOCSERVER_BROWSER_ORIGIN = ${DOCSERVER_BROWSER_ORIGIN}`);
    console.log(`  BRIDGE_CONTAINER_ORIGIN  = ${BRIDGE_CONTAINER_ORIGIN}`);
    console.log(`  PUTER_API_ORIGIN         = ${PUTER_API_ORIGIN}`);
});
