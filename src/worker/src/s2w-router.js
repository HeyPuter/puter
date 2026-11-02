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

// A `fetch()` response's headers are immutable, so it is copied first.
const withCors = (response) => {
    if (response.headers.has('access-control-allow-origin')) return response;
    try {
        response.headers.set('Access-Control-Allow-Origin', '*');
        return response;
    } catch {
        const copy = new Response(response.body, response);
        copy.headers.set('Access-Control-Allow-Origin', '*');
        return copy;
    }
};

// A rejected puter.js call is a plain `{ message, code }` object.
const errorBody = (error) => {
    if (error instanceof Error) return String(error);
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
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
                'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
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
            const cors = (response) =>
                this.handleCors ? withCors(response) : response;
            if (!globalThis.me) {
                globalThis.me = {
                    puter: init_puter_portable(
                        globalThis.puter_auth,
                        globalThis.puter_endpoint || 'https://api.puter.com',
                        'userPuter',
                    ),
                };
                globalThis.my = me;
                globalThis.myself = me;
            }
            if (event.request.headers.has('puter-auth')) {
                event.requestor = {
                    puter: init_puter_portable(
                        event.request.headers.get('puter-auth'),
                        globalThis.puter_endpoint || 'https://api.puter.com',
                        'userPuter',
                        { socket: false },
                    ),
                };
                event.user = event.requestor;
            }

            const mappings = this.map.get(event.request.method);
            if (this.handleCors && event.request.method === 'OPTIONS' && !mappings) {
                return cors(await this.handleOptions(event.request));
            }
            if (!mappings) {
                return cors(new Response(
                    `No routes for given request type ${event.request.method}`,
                    { status: 404 },
                ));
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
                    return cors(response);
                }
            } catch (error) {
                return cors(new Response(errorBody(error), {
                    status: 500,
                    statusText: 'Server Error',
                }));
            }

            return cors(new Response('Path not found', {
                status: 404,
                statusText: 'Not found',
            }));
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
