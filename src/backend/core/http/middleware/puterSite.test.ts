/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../../server';
import { setupTestServer } from '../../../testUtil';
import type { IConfig } from '../../../types';
import { generateDefaultFsentries } from '../../../util/userProvisioning';
import { createPuterSiteMiddleware } from './puterSite';

// ── Harness ─────────────────────────────────────────────────────────
//
// puterSite is a single big handler that either writes a response or
// calls next(). We capture status / body / redirect / cookies / headers
// — enough to assert each branch without standing up the express stack.
//
// File-serving paths (Range, ETag, S3 streaming) aren't exercised here:
// they need real filesystem entries + S3 reads, which is a much bigger
// fixture setup. The early-out branches (config gating, unknown subdomain,
// suspended owner, missing root dir, private-host refusal) are the ones
// security-sensitive enough to be worth pinning.

interface CapturedRes {
    statusCode?: number;
    body?: unknown;
    contentType?: string;
    redirected?: { status?: number; url: string };
    headers: Record<string, string>;
}

const makeRes = () => {
    const out: CapturedRes = { headers: {} };
    // The file-serving branch ends with `download.body.pipe(res)`, so
    // `res` has to satisfy the WritableStream contract Node's `pipe()`
    // expects — write/end/on/emit/etc. Use a real Writable so Node's
    // pipe internals don't trip on missing prototype methods. Bytes
    // piped in are captured into `out.body`.
    const pipedChunks: Buffer[] = [];
    const writable = new Writable({
        write(chunk: Buffer, _enc, cb) {
            pipedChunks.push(chunk);
            cb();
        },
        final(cb) {
            if (pipedChunks.length > 0) {
                out.body = Buffer.concat(pipedChunks);
            }
            cb();
        },
    });
    const res = writable as unknown as Response & {
        status: (code: number) => Response;
        type: (ct: string) => Response;
        send: (payload: unknown) => Response;
        redirect: (...args: unknown[]) => Response;
        cookie: () => Response;
        set: (name: string, value: string) => Response;
        setHeader: (name: string, value: string) => Response;
    };
    res.status = (code: number) => {
        out.statusCode = code;
        return res;
    };
    res.type = (ct: string) => {
        out.contentType = ct;
        return res;
    };
    res.send = (payload: unknown) => {
        out.body = payload;
        return res;
    };
    res.redirect = (...args: unknown[]) => {
        if (typeof args[0] === 'number') {
            out.redirected = {
                status: args[0] as number,
                url: String(args[1]),
            };
        } else {
            out.redirected = { url: String(args[0]) };
        }
        return res;
    };
    res.cookie = () => res;
    res.set = (name: string, value: string) => {
        out.headers[name] = value;
        return res;
    };
    res.setHeader = (name: string, value: string) => {
        out.headers[name] = value;
        return res;
    };
    return { res, out };
};

const makeReq = (init: {
    hostname: string;
    path?: string;
    originalUrl?: string;
    protocol?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
}): Request =>
    ({
        hostname: init.hostname,
        path: init.path ?? '/',
        // Redirect helpers use originalUrl (preserves query string).
        // Default to `path` when caller doesn't care to distinguish.
        originalUrl: init.originalUrl ?? init.path ?? '/',
        protocol: init.protocol ?? 'http',
        headers: init.headers ?? {},
        cookies: init.cookies ?? {},
        query: {},
        // The file-serve branch wires `req.on('close', ...)` to destroy
        // the stream on client disconnect — a no-op event surface is
        // enough for the offline tests.
        on: () => undefined,
    }) as unknown as Request;

const runMiddleware = async (
    mw: ReturnType<typeof createPuterSiteMiddleware>,
    req: Request,
) => {
    const { res, out } = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    return { out, next };
};

// ── Server setup ────────────────────────────────────────────────────

let server: PuterServer;
const hostingConfig: IConfig = {
    domain: 'puter.localhost',
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_domain_alt: null,
    private_app_hosting_domain: 'app.puter.localhost',
    private_app_hosting_domain_alt: null,
    protocol: 'http',
} as unknown as IConfig;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const buildMiddleware = (configOverride?: Partial<IConfig>) =>
    createPuterSiteMiddleware(
        { ...hostingConfig, ...configOverride } as IConfig,
        {
            clients: server.clients,
            stores: server.stores,
            services: server.services,
        },
    );

const makeUser = async (suspended = false) => {
    const username = `ps-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    } as Parameters<typeof server.stores.user.create>[0]);
    if (suspended) {
        // Go through the store's `update` so the user cache gets
        // refreshed — otherwise puterSite's cached `getById` will still
        // see the row as unsuspended.
        await server.stores.user.update(created.id, { suspended: 1 });
    }
    return (await server.stores.user.getById(created.id))!;
};

// ── Config gating ───────────────────────────────────────────────────

describe('createPuterSiteMiddleware — config gating', () => {
    it('returns a no-op when no hosting domains are configured', async () => {
        // Self-hosted deployments without user site hosting shouldn't
        // touch any request, even ones that look like site hostnames.
        const mw = createPuterSiteMiddleware(
            {
                domain: 'puter.localhost',
                static_hosting_domain: null,
                static_hosting_domain_alt: null,
                private_app_hosting_domain: null,
                private_app_hosting_domain_alt: null,
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: 'beans.site.puter.localhost' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
        expect(out.redirected).toBeUndefined();
    });

    it("passes through hosts that aren't one of the configured hosting domains", async () => {
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: 'api.puter.localhost' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
    });

    it("passes through when the hostname can't be parsed", async () => {
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: '' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
    });
});

// ── Bare / www on hosting domain ────────────────────────────────────

describe('createPuterSiteMiddleware — bare host and www', () => {
    it('redirects the bare hosting domain to the configured main domain', async () => {
        // Hitting `site.puter.localhost` directly (no subdomain) belongs
        // on the app shell — 302 to the main domain so legacy bookmarks
        // still work.
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({
                hostname: 'site.puter.localhost',
                protocol: 'http',
            }),
        );
        expect(next).not.toHaveBeenCalled();
        expect(out.redirected).toEqual({
            status: 302,
            url: 'http://puter.localhost',
        });
    });

    it('redirects www.<hosting-domain> the same way (treated as bare)', async () => {
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                hostname: 'www.site.puter.localhost',
                protocol: 'http',
            }),
        );
        expect(out.redirected).toEqual({
            status: 302,
            url: 'http://puter.localhost',
        });
    });

    it('404s the bare host when no main domain is configured (no leak)', async () => {
        // Without a main domain to redirect to, we'd otherwise have no
        // landing target. Returning 404 is the safe default.
        const mw = createPuterSiteMiddleware(
            {
                ...hostingConfig,
                domain: null,
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: 'site.puter.localhost' }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
    });
});

// ── Subdomain lookup ────────────────────────────────────────────────

describe('createPuterSiteMiddleware — subdomain lookup', () => {
    it('404s plain-text on an unknown subdomain (does not reveal whether any user owns it)', async () => {
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                hostname: `never-exists-${Math.random()
                    .toString(36)
                    .slice(2, 10)}.site.puter.localhost`,
            }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
        // Plain-text body — no HTML rendering at this stage.
        expect(out.contentType).toBe('text/plain');
    });

    it("404s when the owning user is suspended — same 'Subdomain not found' shape as unknown-subdomain (no leak)", async () => {
        // Critical: same status + same body as the unknown-subdomain
        // case. A different response here would leak suspension state.
        const owner = await makeUser(/* suspended */ true);
        const sub = `suspended-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.site.puter.localhost` }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
    });

    it('serves the HTML SUBDOMAIN_404 when the subdomain row has no root_dir_id', async () => {
        // The site exists but the owner never registered a directory —
        // give them the slightly friendlier HTML page rather than the
        // bare text 404 used for unknown subdomains.
        const owner = await makeUser();
        const sub = `noroot-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.site.puter.localhost` }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
        expect(String(out.body)).toContain('404');
    });
});

// ── Private hosting domain → public-host redirect ───────────────────

describe('createPuterSiteMiddleware — private hosting domain', () => {
    it('302s a subdomain on the private host with no private app to the equivalent puter.site URL (covers freed-paid-app bookmarks + plain hosted sites)', async () => {
        // Owner exists, subdomain exists, but it has no associated
        // private app. On the *private* host this used to 404; now it
        // mirrors the public→private redirect so a paid app whose price
        // dropped to 0 still resolves on `puter.site` when accessed via
        // its old `puter.app` URL.
        const owner = await makeUser();
        const sub = `leak-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                // Note: app.puter.localhost is the *private* hosting domain.
                hostname: `${sub}.app.puter.localhost`,
                path: '/some/deep/path.html',
            }),
        );
        expect(out.redirected).toEqual({
            status: 302,
            url: `http://${sub}.site.puter.localhost/some/deep/path.html`,
        });
    });

    it('uses the alt private hosting domain when configured (same redirect to the public host)', async () => {
        // Coverage for the `private_app_hosting_domain_alt` slot — same
        // redirect logic, but via the alternate host that the deployment
        // can use for legacy traffic.
        const owner = await makeUser();
        const sub = `altleak-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware({
            private_app_hosting_domain_alt: 'apps.alt.localhost',
        } as Partial<IConfig>);
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.apps.alt.localhost` }),
        );
        expect(out.redirected).toEqual({
            status: 302,
            url: `http://${sub}.site.puter.localhost/`,
        });
    });

    it('falls back to 404 when no public hosting domain is configured (no leak)', async () => {
        // Without a static_hosting_domain to redirect to we have no safe
        // target; the original refusal must still apply so a public-app
        // subdomain doesn't accidentally serve via the private host.
        const owner = await makeUser();
        const sub = `nopub-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = createPuterSiteMiddleware(
            {
                ...hostingConfig,
                static_hosting_domain: null,
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.app.puter.localhost` }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
        expect(out.redirected).toBeUndefined();
    });
});

// ── File serving ────────────────────────────────────────────────────
//
// Wires a subdomain → user home dir so the FS path resolution + read
// stream branches actually run. Uses the live FSService to write real
// files, which goes through the in-memory S3 mock; the readContent
// piping path then yields a real readable stream.

// Variant of `makeUser` that ALSO provisions /<username> + the default
// folder tree. The base `makeUser` doesn't, since the existing tests
// only need a user row; the file-serving tests need a real home dir
// to use as `root_dir_id`.
const makeUserWithHome = async () => {
    const username = `ps-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    } as Parameters<typeof server.stores.user.create>[0]);
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    return (await server.stores.user.getById(created.id))!;
};

const writeFile = async (
    userId: number,
    path: string,
    body: Buffer,
    contentType = 'application/octet-stream',
) => {
    await server.services.fs.write(userId, {
        fileMetadata: {
            path,
            size: body.byteLength,
            contentType,
        },
        fileContent: body,
    });
    return server.stores.fsEntry.getEntryByPath(path);
};

describe('createPuterSiteMiddleware — file serving', () => {
    it('serves an existing file with the right Content-Type, ETag/length headers, and 200', async () => {
        // Build a real subdomain pointing at the user's home dir, write
        // a real index.html under it, then hit the middleware. Exercises
        // the full path-resolution + readContent + header pipeline.
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        expect(homeEntry).not.toBeNull();
        const sub = `serve-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('<html>hi</html>');
        await writeFile(owner.id, `${homePath}/index.html`, body, 'text/html');

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/index.html',
            }),
            res,
            vi.fn(),
        );
        // Allow the piped stream to flush.
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(out.statusCode).toBe(200);
        expect(out.headers['Content-Type']).toMatch(/text\/html/);
        expect(out.headers['Content-Length']).toBe(String(body.byteLength));
        expect(out.headers['Access-Control-Allow-Origin']).toBe('*');
        expect(out.headers['Accept-Ranges']).toBe('bytes');
        // makeRes captures the piped stream bytes into `out.body`.
        const piped = out.body as Buffer | undefined;
        expect(Buffer.isBuffer(piped)).toBe(true);
        expect(piped!.equals(body)).toBe(true);
    });

    it('emits site.htmlServed with the original URL target including query string', async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `serveq-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        await writeFile(
            owner.id,
            `${homePath}/index.html`,
            Buffer.from('<html>hi</html>'),
            'text/html',
        );

        const emitSpy = vi.spyOn(server.clients.event, 'emit');
        try {
            const mw = buildMiddleware();
            const { res } = makeRes();
            await mw(
                makeReq({
                    hostname: `${sub}.site.puter.localhost`,
                    path: '/index.html',
                    originalUrl: '/index.html?brand=paypal',
                }),
                res,
                vi.fn(),
            );

            const htmlServedCall = emitSpy.mock.calls.find(
                (call) => call[0] === 'site.htmlServed',
            );
            expect(htmlServedCall?.[1]).toMatchObject({
                subdomain: sub,
                requestPath: '/index.html',
                requestUrl: '/index.html?brand=paypal',
                mime: 'text/html',
            });
        } finally {
            emitSpy.mockRestore();
        }
    });

    it('returns 206 status when a Range header is supplied', async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `range-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('abcdefghij');
        await writeFile(
            owner.id,
            `${homePath}/clip.bin`,
            body,
            'application/octet-stream',
        );

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/clip.bin',
                headers: { range: 'bytes=0-3' },
            }),
            res,
            vi.fn(),
        );

        // Range request → 206 even if the underlying mock S3 returns the
        // full payload (Content-Range header may not appear in the in-
        // memory mock, but the status code transition is what we care
        // about here).
        expect(out.statusCode).toBe(206);
        expect(out.headers['Accept-Ranges']).toBe('bytes');
    });

    it("rewrites a trailing slash request to /index.html under the site's root", async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `idx-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('default doc');
        await writeFile(owner.id, `${homePath}/index.html`, body, 'text/html');

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                // Trailing slash → driver appends `index.html`.
                path: '/',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(200);
        expect(out.headers['Content-Type']).toMatch(/text\/html/);
    });

    it("returns the HTML 404 'Not Found' page when the file does not exist", async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `miss-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        // No file is written — the path doesn't exist.

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/does-not-exist.html',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
        expect(String(out.body)).toContain('Not Found');
    });

    it('returns 404 when the resolved URL points at a directory with no index.html', async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `dirreq-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                // Documents/ exists from generateDefaultFsentries but has
                // no index.html — directory fallback must still 404.
                path: '/Documents',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
    });

    it('serves <folder>/index.html when the URL resolves to a folder containing one', async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `folderidx-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('nested doc');
        await writeFile(
            owner.id,
            `${homePath}/Documents/index.html`,
            body,
            'text/html',
        );

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                // No trailing slash; folder exists and contains index.html.
                path: '/Documents',
            }),
            res,
            vi.fn(),
        );
        // Allow the piped stream to flush.
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(out.statusCode).toBe(200);
        expect(out.headers['Content-Type']).toMatch(/text\/html/);
        const piped = out.body as Buffer | undefined;
        expect(Buffer.isBuffer(piped)).toBe(true);
        expect(piped!.equals(body)).toBe(true);
    });

    it("serves the HTML SUBDOMAIN_404 when the subdomain's root_dir_id points to a missing entry", async () => {
        // Subdomain row references a fsentry id that doesn't exist —
        // earlier path resolution must catch this with the HTML 404 page.
        const owner = await makeUserWithHome();
        const sub = `missroot-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: 999999, // never inserted
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
    });

    it('returns 404 when root_dir_id points to a file (not a directory)', async () => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const body = Buffer.from('not a directory');
        // Write a file and use ITS id as the subdomain's root_dir_id —
        // the middleware must reject because root must be a directory.
        await writeFile(owner.id, `${homePath}/Documents/somefile.txt`, body);
        const fileEntry = await server.stores.fsEntry.getEntryByPath(
            `${homePath}/Documents/somefile.txt`,
        );
        expect(fileEntry?.isDir).toBe(false);
        const sub = `fileroot-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: fileEntry!.id,
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/',
            }),
            res,
            vi.fn(),
        );
        expect(out.statusCode).toBe(404);
    });

    it('decodes URL-encoded paths before resolving', async () => {
        // %20 in the URL must decode to a space and match the on-disk
        // filename — proves decodeURIComponent runs before path lookup.
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `enc-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('encoded');
        await writeFile(
            owner.id,
            `${homePath}/hello world.txt`,
            body,
            'text/plain',
        );

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/hello%20world.txt',
            }),
            res,
            vi.fn(),
        );
        expect(out.statusCode).toBe(200);
        expect(out.headers['Content-Type']).toMatch(/text\/plain/);
    });

    it('normalizes traversal-style paths so `..` cannot escape the site root', async () => {
        // `/foo/../bar` collapses to `/bar` under the site root; without
        // normalization an attacker could climb out and hit the FS root.
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `trav-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        const body = Buffer.from('inside');
        await writeFile(owner.id, `${homePath}/safe.txt`, body, 'text/plain');

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                // ../../etc/passwd — must normalize to /etc/passwd under
                // the SITE ROOT, not the FS root; lookup will 404.
                path: '/../../etc/passwd',
            }),
            res,
            vi.fn(),
        );
        // Whatever the file branch decides, the response must NOT be
        // a 200 with the file from /etc/passwd — it should 404 because
        // <home>/etc/passwd doesn't exist.
        expect(out.statusCode).toBe(404);
    });
});

// ── .puter_site_config (custom error pages) ─────────────────────────
//
// Sites can drop a `.puter_site_config` JSON file at the root of their
// hosting directory to map error codes onto custom pages — the
// canonical use case is SPA fallback (404 → /index.html with status
// 200). These tests pin the contract end-to-end through the real
// FSService so we exercise parsing, path resolution, and the loop-
// prevention guard together.

describe('createPuterSiteMiddleware — .puter_site_config', () => {
    const setupSiteWithConfig = async (config: unknown) => {
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `cfg-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        await writeFile(
            owner.id,
            `${homePath}/.puter_site_config`,
            Buffer.from(JSON.stringify(config)),
            'application/json',
        );
        return { owner, homePath, sub };
    };

    it('serves /index.html with status 200 on 404 when configured (SPA fallback)', async () => {
        // The user's headline use case: route any unknown path through
        // the SPA entrypoint so client-side routing can take over,
        // while still serving HTTP 200 so search engines don't cache
        // the page as a hard 404.
        const { owner, homePath, sub } = await setupSiteWithConfig({
            errors: {
                '404': { file: '/index.html', status: 200 },
            },
        });
        const body = Buffer.from('<html>spa-shell</html>');
        await writeFile(owner.id, `${homePath}/index.html`, body, 'text/html');

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/some/client-route',
            }),
            res,
            vi.fn(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(out.statusCode).toBe(200);
        expect(out.headers['Content-Type']).toMatch(/text\/html/);
        const piped = out.body as Buffer | undefined;
        expect(Buffer.isBuffer(piped)).toBe(true);
        expect(piped!.equals(body)).toBe(true);
    });

    it('serves the configured file with the matched code when `status` is omitted', async () => {
        // No explicit `status` → default to the matched error code
        // (404 here). Bare `{ file: '/404.html' }` should Just Work
        // for the classic "pretty 404 page" use case.
        const { owner, homePath, sub } = await setupSiteWithConfig({
            errors: { '404': { file: '/404.html' } },
        });
        const body = Buffer.from('<html>custom 404</html>');
        await writeFile(owner.id, `${homePath}/404.html`, body, 'text/html');

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/no-such-page',
            }),
            res,
            vi.fn(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(out.statusCode).toBe(404);
        const piped = out.body as Buffer | undefined;
        expect(piped!.equals(body)).toBe(true);
    });

    it('falls back to the default 404 page when the configured error file does not exist (no infinite loop)', async () => {
        // Critical loop guard: if the error page itself is missing,
        // we must NOT recurse through the error config again. The
        // request must terminate with the built-in 404 page rather
        // than spinning errors.404 → errors.404 → … .
        const { sub } = await setupSiteWithConfig({
            errors: { '404': { file: '/missing.html', status: 200 } },
        });
        // Deliberately do not write missing.html.

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/anything',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
        expect(String(out.body)).toContain('Not Found');
    });

    it('returns 404 when a visitor requests `.puter_site_config` directly (no config leak)', async () => {
        // The config file is implementation detail — hide it the same
        // way any other missing path would 404, so visitors can't
        // enumerate deployment shape by guessing well-known names.
        const { sub } = await setupSiteWithConfig({
            errors: { '404': { file: '/index.html', status: 200 } },
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/.puter_site_config',
            }),
            res,
            vi.fn(),
        );

        // No error-page fallback because we didn't write /index.html.
        expect(out.statusCode).toBe(404);
        // Body shape is the default 404, not the JSON config.
        expect(String(out.body)).not.toContain('errors');
    });

    it('rejects `errors.404.file` paths that try to climb out of the site root', async () => {
        // The normalizer collapses `..` segments, so an attacker who
        // can edit the config can't pivot it into reading files
        // outside their own subdomain root.
        const otherOwner = await makeUserWithHome();
        const secretPath = `/${otherOwner.username}/secret.html`;
        await writeFile(
            otherOwner.id,
            secretPath,
            Buffer.from('SECRET'),
            'text/html',
        );

        const { sub } = await setupSiteWithConfig({
            errors: {
                '404': {
                    // Tries to walk up to the other user's home dir.
                    file: `/../${otherOwner.username}/secret.html`,
                    status: 200,
                },
            },
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/anything',
            }),
            res,
            vi.fn(),
        );

        // The collapsed path resolves under the requesting site's
        // root, which doesn't have a `<username>/secret.html` file —
        // so the fallback fails and we get the default 404, NOT the
        // SECRET body.
        expect(out.statusCode).toBe(404);
        expect(String(out.body)).not.toContain('SECRET');
    });

    it('ignores malformed JSON configs and behaves like there is no config', async () => {
        // A typo in the config file must not 5xx the request — the
        // visitor still gets the default 404 on a missing path.
        const owner = await makeUserWithHome();
        const homePath = `/${owner.username}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(homePath);
        const sub = `bad-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
            rootDirId: homeEntry!.id,
        });
        await writeFile(
            owner.id,
            `${homePath}/.puter_site_config`,
            Buffer.from('this is not json {{{'),
            'application/json',
        );
        await writeFile(
            owner.id,
            `${homePath}/index.html`,
            Buffer.from('would-be-fallback'),
            'text/html',
        );

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/unknown',
            }),
            res,
            vi.fn(),
        );

        expect(out.statusCode).toBe(404);
        expect(String(out.body)).toContain('Not Found');
        // Did NOT silently fall back to /index.html as if the config
        // were valid — malformed config must be ignored, not partially
        // applied.
        expect(String(out.body)).not.toContain('would-be-fallback');
    });

    it('still serves real files normally — config only applies on 404', async () => {
        // Sanity check: when the requested path exists, the config's
        // error rules are not consulted, so the response is the live
        // file at status 200 (not the error-page status override).
        const { owner, homePath, sub } = await setupSiteWithConfig({
            errors: { '404': { file: '/index.html', status: 200 } },
        });
        const body = Buffer.from('real-page');
        await writeFile(
            owner.id,
            `${homePath}/page.html`,
            body,
            'text/html',
        );

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/page.html',
            }),
            res,
            vi.fn(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(out.statusCode).toBe(200);
        const piped = out.body as Buffer | undefined;
        expect(piped!.equals(body)).toBe(true);
    });

    it('serves the cached config on a second request, even when the on-disk file is removed (Redis cache holds within TTL)', async () => {
        // First request seeds the cache with the parsed config. We
        // then delete the underlying file and fire a second request:
        // if the cache is wired correctly, the SPA fallback still
        // applies because we never re-read from S3. Within-TTL
        // staleness is the explicit contract (60s default).
        const { owner, homePath, sub } = await setupSiteWithConfig({
            errors: { '404': { file: '/index.html', status: 200 } },
        });
        const body = Buffer.from('<html>spa-shell</html>');
        await writeFile(owner.id, `${homePath}/index.html`, body, 'text/html');

        const mw = buildMiddleware();

        // First request → primes the cache.
        const first = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/route-a',
            }),
            first.res,
            vi.fn(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(first.out.statusCode).toBe(200);

        // Now wipe the on-disk config. If the loader hits S3 on every
        // request, the second call below would see no config and fall
        // through to a default 404. The cache contract is that it
        // does NOT — within the TTL, the prior parse stands.
        const configEntry = await server.stores.fsEntry.getEntryByPath(
            `${homePath}/.puter_site_config`,
        );
        if (configEntry) {
            await server.services.fs.remove(owner.id, { entry: configEntry });
        }

        const second = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/route-b',
            }),
            second.res,
            vi.fn(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        // SPA fallback still fires → cache served the deleted config.
        expect(second.out.statusCode).toBe(200);
        expect(
            (second.out.body as Buffer | undefined)?.equals(body),
        ).toBe(true);
    });

    it('ignores `errors` entries with status codes outside 4xx/5xx', async () => {
        // A `200` key in errors is meaningless and a footgun (it
        // could be used to silently override the happy path). The
        // parser must drop these on the floor.
        const { sub } = await setupSiteWithConfig({
            errors: {
                '200': { file: '/oops.html', status: 200 },
                '999': { file: '/oops.html', status: 200 },
            },
        });

        const mw = buildMiddleware();
        const { res, out } = makeRes();
        await mw(
            makeReq({
                hostname: `${sub}.site.puter.localhost`,
                path: '/missing',
            }),
            res,
            vi.fn(),
        );

        // No valid 404 rule survives the filter → default 404.
        expect(out.statusCode).toBe(404);
        expect(String(out.body)).toContain('Not Found');
    });
});
