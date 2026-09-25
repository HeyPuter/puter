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

import { describe, expect, it } from 'vitest';
import { Controller, Get, Propfind } from './decorators.ts';
import { PuterRouter } from './PuterRouter.ts';

interface Registrable {
    registerRoutes: (router: PuterRouter) => void;
}

const collect = (controller: Registrable) => {
    const router = new PuterRouter();
    controller.registerRoutes(router);
    return router.routes;
};

@Controller('/demo')
class DemoController {
    @Get('/thing')
    thing() {}

    @Propfind('/{*splat}', { subdomain: 'dav' })
    browse() {}
}

describe('route decorators', () => {
    it('collects each decorated method once, in declaration order', () => {
        const routes = collect(new DemoController() as unknown as Registrable);
        expect(routes.map((r) => r.method)).toEqual(['get', 'propfind']);
        expect(routes[1]!.options).toEqual({ subdomain: 'dav' });
    });

    it('does not re-collect when a second instance is constructed', () => {
        // Method initializers run per instance but collect onto the shared
        // prototype, so without a guard a process that builds two servers
        // registers every route on the second one twice over.
        const first = collect(new DemoController() as unknown as Registrable);
        const second = collect(new DemoController() as unknown as Registrable);
        const third = collect(new DemoController() as unknown as Registrable);
        expect(second).toHaveLength(first.length);
        expect(third).toHaveLength(first.length);
        expect(third.map((r) => r.method)).toEqual(['get', 'propfind']);
    });

    it('binds handlers to the instance that registered them', () => {
        @Controller()
        class Bound {
            marker = 'mine';
            seen: string | undefined;

            @Get('/x')
            handle() {
                this.seen = this.marker;
            }
        }

        const instance = new Bound();
        const [route] = collect(instance as unknown as Registrable);
        (route!.handler as unknown as () => void)();
        expect(instance.seen).toBe('mine');
    });
});
