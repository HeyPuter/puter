/*
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

import type { RequestHandler } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { extension, extensionStore } from './extensions.ts';
import {
    clientsContainers,
    configContainer,
    controllersContainers,
    driversContainers,
    servicesContainers,
    storesContainers,
} from './exports.ts';

/**
 * The `extension.import('client')` proxy does NOT return `undefined` for
 * clients that were never registered — it hands back a placeholder proxy that
 * throws on property access. Extensions reaching for an OPTIONAL client (e.g.
 * the ClickHouse analytics client, absent on plain self-hosts) must therefore
 * probe for a real method behind a try/catch rather than trusting truthiness.
 *
 * These tests lock it so a future proxy change can't silently reintroduce the
 * "truthy-but-throws" footgun.
 */
describe('extension.import("client") optional client access', () => {
    const clients = extension.import('client') as Record<
        string,
        { query?: unknown } | undefined
    >;

    afterEach(() => {
        delete clientsContainers.notRegistered;
        delete clientsContainers.optionalThing;
    });

    it('returns a truthy-but-throwing placeholder for an unregistered client', () => {
        delete clientsContainers.notRegistered;
        const placeholder = clients.notRegistered;
        // Truthy — so a bare `if (clients.x)` check is NOT safe.
        expect(placeholder).toBeTruthy();
        // ...and accessing a method on it throws.
        expect(() => (placeholder as { query: unknown }).query).toThrow();
    });

    it('the try/catch probe pattern reports absence safely', () => {
        delete clientsContainers.optionalThing;
        const probe = () => {
            try {
                return typeof clients.optionalThing?.query === 'function'
                    ? clients.optionalThing
                    : null;
            } catch {
                return null;
            }
        };
        expect(probe()).toBeNull();
    });

    it('the same probe returns a registered client exposing the method', () => {
        const fake = { query: async () => undefined };
        clientsContainers.optionalThing =
            fake as unknown as (typeof clientsContainers)[string];
        const probe = () => {
            try {
                return typeof clients.optionalThing?.query === 'function'
                    ? clients.optionalThing
                    : null;
            } catch {
                return null;
            }
        };
        // The import proxy method-binds, so the result is a binding proxy over
        // `fake` rather than the raw reference (identity is intentionally not
        // preserved). What the probe pattern locks is that a registered client
        // surfaces a callable method.
        const result = probe();
        expect(result).not.toBeNull();
        expect(typeof (result as { query: unknown }).query).toBe('function');
    });
});

// ── Registry writers ─────────────────────────────────────────────────

describe('extension registry writers', () => {
    class Dummy {}

    afterEach(() => {
        for (const registry of [
            extensionStore.clients,
            extensionStore.stores,
            extensionStore.services,
            extensionStore.controllers,
            extensionStore.drivers,
        ] as Record<string, unknown>[]) {
            delete registry.dummy;
        }
        extensionStore.globalMiddlewares.length = 0;
    });

    it('records each layer registration under its own registry', () => {
        extension.registerClient('dummy', Dummy as never);
        extension.registerStore('dummy', Dummy as never);
        extension.registerService('dummy', Dummy as never);
        extension.registerController('dummy', Dummy as never);
        extension.registerDriver('dummy', Dummy as never);

        expect(extensionStore.clients.dummy).toBe(Dummy);
        expect(extensionStore.stores.dummy).toBe(Dummy);
        expect(extensionStore.services.dummy).toBe(Dummy);
        expect(extensionStore.controllers.dummy).toBe(Dummy);
        expect(extensionStore.drivers.dummy).toBe(Dummy);
    });

    it('lets a later registration replace an earlier one under the same name', () => {
        class First {}
        class Second {}
        extension.registerService('dummy', First as never);
        extension.registerService('dummy', Second as never);
        expect(extensionStore.services.dummy).toBe(Second);
    });

    it('appends global middleware in registration order', () => {
        const a = (() => undefined) as unknown as RequestHandler;
        const b = (() => undefined) as unknown as RequestHandler;
        extension.registerGlobalMiddleware(a);
        extension.registerGlobalMiddleware(b);
        expect(extensionStore.globalMiddlewares).toEqual([a, b]);
    });

    it('exposes the live server config object', () => {
        expect(extension.config).toBe(configContainer);
    });
});

// ── Event subscription ───────────────────────────────────────────────

describe('extension.on', () => {
    const key = 'test.extension.event' as never;

    afterEach(() => {
        delete (extensionStore.events as Record<string, unknown>)[
            key as unknown as string
        ];
    });

    it('creates the listener bucket on first subscribe and appends after that', () => {
        const first = () => undefined;
        const second = () => undefined;

        extension.on(key, first);
        expect(extensionStore.events[key as unknown as string]).toEqual([
            first,
        ]);

        extension.on(key, second);
        expect(extensionStore.events[key as unknown as string]).toEqual([
            first,
            second,
        ]);
    });
});

// ── Route registration ───────────────────────────────────────────────

describe('extension route helpers', () => {
    const handler = (() => undefined) as unknown as RequestHandler;
    const other = (() => undefined) as unknown as RequestHandler;

    afterEach(() => {
        extensionStore.routeHandlers.length = 0;
    });

    const VERBS = [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'head',
        'options',
        'all',
    ] as const;

    it.each(VERBS)(
        '%s(path, handler) records the verb with empty options',
        (verb) => {
            extension[verb]('/thing', handler);
            expect(extensionStore.routeHandlers).toEqual([
                { method: verb, path: '/thing', options: {}, handler },
            ]);
        },
    );

    it.each(VERBS)('%s(path, options, handler) carries the options', (verb) => {
        const options = { subdomain: 'api', requireAuth: true } as const;
        extension[verb]('/thing', options, handler);
        expect(extensionStore.routeHandlers[0]).toEqual({
            method: verb,
            path: '/thing',
            options,
            handler,
        });
    });

    it('throws when a verb is registered without a handler', () => {
        expect(() =>
            (extension.get as unknown as (p: string, o: unknown) => void)(
                '/thing',
                { subdomain: 'api' },
            ),
        ).toThrow("extension.get('/thing', ...) missing handler");
        expect(extensionStore.routeHandlers).toHaveLength(0);
    });

    it('preserves registration order across verbs', () => {
        extension.get('/a', handler);
        extension.post('/b', other);
        expect(
            extensionStore.routeHandlers.map(
                (r) => `${r.method} ${String(r.path)}`,
            ),
        ).toEqual(['get /a', 'post /b']);
    });

    describe('use', () => {
        it('use(handler) registers pathless global middleware', () => {
            extension.use(handler);
            expect(extensionStore.routeHandlers[0]).toEqual({
                method: 'use',
                options: {},
                handler,
            });
            expect(extensionStore.routeHandlers[0].path).toBeUndefined();
        });

        it('use(options, handler) stays pathless and keeps the options', () => {
            const options = { bodyJson: true } as const;
            extension.use(options, handler);
            expect(extensionStore.routeHandlers[0]).toEqual({
                method: 'use',
                options,
                handler,
            });
        });

        it.each([
            ['string', '/mount'],
            ['regexp', /^\/mount/u],
            ['array', ['/a', '/b']],
        ])('use(%s path, handler) keeps the path', (_label, path) => {
            extension.use(path as never, handler);
            expect(extensionStore.routeHandlers[0]).toMatchObject({
                method: 'use',
                path,
                options: {},
                handler,
            });
        });

        it('use(path, options, handler) keeps both', () => {
            const options = { subdomain: 'api' } as const;
            extension.use('/mount', options, handler);
            expect(extensionStore.routeHandlers[0]).toEqual({
                method: 'use',
                path: '/mount',
                options,
                handler,
            });
        });

        it('substitutes empty options when the options argument is nullish', () => {
            extension.use('/mount', undefined as never, handler);
            expect(extensionStore.routeHandlers[0].options).toEqual({});

            extensionStore.routeHandlers.length = 0;
            extension.use(undefined as never, handler);
            expect(extensionStore.routeHandlers[0]).toEqual({
                method: 'use',
                options: {},
                handler,
            });
        });

        it('throws when no handler can be found in any argument position', () => {
            expect(() => extension.use('/mount', {} as never)).toThrow(
                'extension.use(...) missing handler',
            );
            expect(() =>
                (extension.use as unknown as (o: unknown) => void)({}),
            ).toThrow('extension.use(...) missing handler');
            expect(extensionStore.routeHandlers).toHaveLength(0);
        });
    });
});

// ── Import proxy ─────────────────────────────────────────────────────

describe('extension.import', () => {
    const containers = {
        store: storesContainers,
        service: servicesContainers,
        controller: controllersContainers,
        driver: driversContainers,
        client: clientsContainers,
    } as Record<string, Record<string, unknown>>;

    afterEach(() => {
        for (const container of Object.values(containers)) {
            delete container.fixture;
        }
    });

    it.each([
        ['client', 'clients'],
        ['store', 'stores'],
        ['service', 'services'],
        ['controller', 'controllers'],
        ['driver', 'drivers'],
    ])(
        'resolves a registered %s under both the singular and plural name',
        (singular, plural) => {
            const instance = { value: 7 };
            containers[singular].fixture = instance;

            const viaSingular = (
                extension.import(singular as never) as Record<
                    string,
                    { value: number }
                >
            ).fixture;
            const viaPlural = (
                extension.import(plural as never) as Record<
                    string,
                    { value: number }
                >
            ).fixture;

            expect(viaSingular.value).toBe(7);
            expect(viaPlural.value).toBe(7);
        },
    );

    it.each(['client', 'store', 'service', 'controller', 'driver'])(
        'hands back a throwing placeholder for an unregistered %s',
        (layer) => {
            const proxy = extension.import(layer as never) as Record<
                string,
                Record<string, unknown>
            >;
            const placeholder = proxy.fixture;
            expect(placeholder).toBeTruthy();
            expect(() => placeholder.anything).toThrow(
                `extension.import('${layer}:fixture') missing property 'anything'`,
            );
        },
    );

    it.each(['client', 'store', 'service', 'controller', 'driver'])(
        'resolves a %s captured before the layer was constructed',
        (layer) => {
            // Extension modules are imported before PuterServer builds the
            // layers (see server.ts), so a deep capture at module scope --
            // `const db = extension.import('client').db` in cfFileCache --
            // reads a name that is still absent. The placeholder has to
            // re-resolve on access, or that reference never works.
            const captured = (
                extension.import(layer as never) as Record<
                    string,
                    Record<string, () => string>
                >
            ).fixture;

            containers[layer].fixture = { read: () => 'live-instance' };

            expect(captured.read()).toBe('live-instance');
        },
    );

    it.each(['store', 'service', 'controller', 'driver'])(
        'does not resolve an unregistered %s name against the client registry',
        (layer) => {
            // The placeholder used to read from `clientsContainers`
            // regardless of the layer, so `import('store').db` handed back
            // the database *client*.
            clientsContainers.fixture = {
                query: () => 'leaked',
            } as never;

            const proxy = extension.import(layer as never) as Record<
                string,
                Record<string, unknown>
            >;
            expect(() => proxy.fixture.query).toThrow(
                `extension.import('${layer}:fixture') missing property 'query'`,
            );
        },
    );

    it('binds methods reached through a pre-registration placeholder', () => {
        // cfFileCache's exact shape: `const db = extension.import('client').db`
        // at module scope, then `db.read(...)` at request time. The placeholder
        // has to bind, or `this` is the proxy and the private-field read throws.
        class Db {
            #dsn = 'primary';
            read() {
                return this.#dsn;
            }
        }
        const captured = (
            extension.import('client') as unknown as Record<
                string,
                { read: () => string }
            >
        ).db;

        clientsContainers.db = new Db() as never;

        expect(captured.read()).toBe('primary');
        delete (clientsContainers as Record<string, unknown>).db;
    });

    it('binds methods so a detached reference still works', () => {
        // Extensions routinely destructure a method off the import; without
        // binding, `this` would be undefined at call time.
        class Service {
            #secret = 'private-state';
            read() {
                return this.#secret;
            }
            get viaGetter() {
                return this.#secret;
            }
        }
        servicesContainers.fixture = new Service() as never;

        const svc = (
            extension.import('service') as unknown as Record<
                string,
                { read: () => string; viaGetter: string }
            >
        ).fixture;
        const { read } = svc;

        expect(read()).toBe('private-state');
        expect(svc.viaGetter).toBe('private-state');
        // Binding trades away reference identity — pin that expectation.
        expect(svc.read).not.toBe(svc.read);
    });

    it('returns non-object layer values untouched', () => {
        servicesContainers.fixture = 'plain-string' as never;
        const svc = extension.import('service') as unknown as Record<
            string,
            unknown
        >;
        expect(svc.fixture).toBe('plain-string');
    });

    it('returns undefined for a layer name it does not know', () => {
        expect(extension.import('nonsense' as never)).toBeUndefined();
    });
});
