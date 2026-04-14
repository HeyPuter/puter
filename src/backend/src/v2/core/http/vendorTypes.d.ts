/**
 * Ambient type declarations for third-party packages that don't ship
 * their own `.d.ts`. Keeps `tsc --noEmit` clean without pulling in
 * `@types/*` packages for each one.
 */
declare module 'cookie-parser' {
    import type { RequestHandler } from 'express';
    function cookieParser (secret?: string | string[], options?: object): RequestHandler;
    export = cookieParser;
}

declare module 'compression' {
    import type { RequestHandler } from 'express';
    function compression (options?: object): RequestHandler;
    export = compression;
}

declare module 'ua-parser-js' {
    function UAParser (ua?: string): {
        browser: { name?: string; version?: string; major?: string };
        engine: { name?: string; version?: string };
        os: { name?: string; version?: string };
        device: { vendor?: string; model?: string; type?: string };
        cpu: { architecture?: string };
    };
    export = UAParser;
}
