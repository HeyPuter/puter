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

/**
 * Ambient type declarations for third-party packages that don't ship
 * their own `.d.ts`. Keeps `tsc --noEmit` clean without pulling in
 * `@types/*` packages for each one.
 */
declare module 'cookie-parser' {
    import type { RequestHandler } from 'express';
    function cookieParser(
        secret?: string | string[],
        options?: object,
    ): RequestHandler;
    export = cookieParser;
}

declare module 'compression' {
    import type { RequestHandler } from 'express';
    function compression(options?: object): RequestHandler;
    export = compression;
}

declare module 'ua-parser-js' {
    function UAParser(ua?: string): {
        browser: { name?: string; version?: string; major?: string };
        engine: { name?: string; version?: string };
        os: { name?: string; version?: string };
        device: { vendor?: string; model?: string; type?: string };
        cpu: { architecture?: string };
    };
    export = UAParser;
}
