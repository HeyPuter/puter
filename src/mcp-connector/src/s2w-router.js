// Forked from src/worker/src/s2w-router.js for the Puter MCP server.
//
// Differences from the original worker router:
//   1. There is NO `globalThis.me` / worker-owned puter instance. This server
//      holds no credentials of its own — every request runs as the caller.
//   2. The per-request puter instance (`event.user.puter`) is generated from the
//      standard `Authorization: Bearer <token>` header instead of `puter-auth`.

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRouteMatcher = (route) => {
    let pattern = '^';
    const paramNames = [];

    for (let index = 0; index < route.length; index += 1) {
        const char = route[index];
        if (char === ':' || char === '*') {
            let name = '';
            let offset = index + 1;
            while (offset < route.length) {
                const nextChar = route[offset];
                if (!/[A-Za-z0-9_]/.test(nextChar)) {
                    break;
                }
                name += nextChar;
                offset += 1;
            }

            if (name.length === 0) {
                pattern += escapeRegex(char);
                continue;
            }

            paramNames.push(name);
            pattern += char === ':' ? '([^/]+)' : '(.*)';
            index = offset - 1;
            continue;
        }

        pattern += escapeRegex(char);
    }

    pattern += '$';
    const regex = new RegExp(pattern);
    return (pathname) => {
        const matches = regex.exec(pathname);
        if (!matches) return false;

        const params = {};
        for (let index = 0; index < paramNames.length; index += 1) {
            params[paramNames[index]] = matches[index + 1];
        }
        return { params };
    };
};

// Error responses as JSON (with CORS) so clients never get a non-JSON body they
// might try to parse — notably MCP OAuth discovery probes against unknown paths.
const jsonError = (status, message) =>
    new Response(JSON.stringify({ error: { code: status, message } }), {
        status,
        headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });

// Pull the bearer token out of the Authorization header.
const getBearerToken = (request) => {
    const header = request.headers.get('authorization');
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
};

function initS2w () {
    const router = {
        routing: true,
        handleCors: true,
        map: new Map(),
        custom(eventName, route, eventListener) {
            const matchExp = buildRouteMatcher(route);
            if (!this.map.has(eventName)) {
                this.map.set(eventName, [[matchExp, eventListener]]);
                return;
            }
            this.map.get(eventName).push([matchExp, eventListener]);
        },
        get(...args) {
            this.custom('GET', ...args);
        },
        post(...args) {
            this.custom('POST', ...args);
        },
        options(...args) {
            this.custom('OPTIONS', ...args);
        },
        put(...args) {
            this.custom('PUT', ...args);
        },
        delete(...args) {
            this.custom('DELETE', ...args);
        },
        async handleOptions(request) {
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
                'Access-Control-Max-Age': '86400',
            };
            if (
                request.headers.get('Origin') !== null &&
                request.headers.get('Access-Control-Request-Method') !== null &&
                request.headers.get('Access-Control-Request-Headers') !== null
            ) {
                return new Response(null, {
                    headers: {
                        ...corsHeaders,
                        'Access-Control-Allow-Headers':
                            request.headers.get(
                                'Access-Control-Request-Headers',
                            ),
                    },
                });
            }
            return new Response(null, {
                headers: {
                    Allow: 'GET, HEAD, POST, OPTIONS',
                },
            });
        },
        async route(event) {
            // Generate the caller's puter instance from the Authorization header.
            // No `me`/worker-owned instance: this server is purely a pass-through
            // for the caller's own token.
            const token = getBearerToken(event.request);
            if (token) {
                event.requestor = {
                    puter: init_puter_portable(
                        token,
                        globalThis.puter_endpoint || 'https://api.puter.com',
                        'userPuter',
                    ),
                };
                event.user = event.requestor;
            }

            const mappings = this.map.get(event.request.method);
            if (this.handleCors && event.request.method === 'OPTIONS' && !mappings) {
                return this.handleOptions(event.request);
            }
            if (!mappings) {
                // JSON (not plain text) so clients that probe unknown paths —
                // e.g. an MCP client's OAuth discovery — can parse the body
                // instead of throwing a JSON syntax error on it.
                return jsonError(404, `No routes for request method ${event.request.method}`);
            }

            const url = new URL(event.request.url);
            try {
                for (const mapping of mappings) {
                    const results = mapping[0](url.pathname);
                    if (!results) continue;

                    event.params = results.params;
                    let response = await mapping[1](event);
                    if (!(response instanceof Response)) {
                        try {
                            if (
                                response instanceof Blob ||
                                response instanceof ArrayBuffer ||
                                response instanceof Uint8Array.__proto__ ||
                                response instanceof ReadableStream ||
                                response instanceof URLSearchParams ||
                                typeof response === 'string'
                            ) {
                                response = new Response(response);
                            } else {
                                response = new Response(JSON.stringify(response), {
                                    headers: {
                                        'content-type': 'application/json',
                                    },
                                });
                            }
                        } catch {
                            throw new Error(
                                'Returned response by handler was neither a Response object nor an object which can implicitly be converted into a Response object',
                            );
                        }
                    }
                    if (
                        this.handleCors &&
                        !response.headers.has('access-control-allow-origin')
                    ) {
                        response.headers.set('Access-Control-Allow-Origin', '*');
                    }
                    return response;
                }
            } catch (error) {
                return jsonError(500, String(error && error.message ? error.message : error));
            }

            // No matching route for this path. JSON 404 (see note above) — this
            // is also what OAuth/well-known discovery probes will hit.
            return jsonError(404, 'Path not found');
        },
    };

    globalThis.router = router;
    self.addEventListener('fetch', (event) => {
        if (!router.routing) {
            return false;
        }
        event.respondWith(router.route(event));
        return true;
    });
}

export default initS2w;
