import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { puterDrivers } from './drivers';
import { PuterServer } from './server';
import { puterServices } from './services';
import { puterStores } from './stores';
import type { IConfig } from './types';

// Config resolution: prefer the user's runtime config (gitignored), fall back
// to the bundled OSS defaults. Both live at the repo package root so a single
// `packages/puter/config.json` override slot is always the authoritative source.
//
// Post-flatten depth: compiled file is at `packages/puter/dist/src/backend/index.js`,
// so three `..`s land at `packages/puter/`.
const PACKAGE_ROOT = path.resolve(__dirname, '../../..');
const loadConfig = (): IConfig => {
    const runtimePath = path.join(PACKAGE_ROOT, 'config.json');
    const defaultPath = path.join(PACKAGE_ROOT, 'config.default.json');
    const chosen = existsSync(runtimePath) ? runtimePath : defaultPath;
    console.log(`[config] loading ${chosen}`);
    const config = JSON.parse(readFileSync(chosen, 'utf8')) as IConfig;

    // Computed defaults. `origin` and `pub_port` are the externally-visible
    // URL+port — what the browser sees. Separate from `port`, which is the
    // bind port (can differ when behind a reverse proxy). Code paths that
    // build self-referential URLs (GUI bootstrap, email links, OIDC callbacks)
    // depend on `origin` having the right port baked in.
    if ( config.pub_port === undefined ) config.pub_port = config.port;
    if ( config.origin === undefined ) {
        const protocol = config.protocol ?? 'http';
        const domain = config.domain ?? 'localhost';
        const suffix = config.pub_port === 80 || config.pub_port === 443
            ? '' : `:${config.pub_port}`;
        config.origin = `${protocol}://${domain}${suffix}`;
    }
    return config;
};

// if called directly, start the server
if ( require.main === module ) {
    const config = loadConfig();
    const server = new PuterServer(config, puterClients, puterStores, puterServices, puterControllers, puterDrivers);
    server.start();
    // listen for shutdown signals to gracefully stop the server
    const shutDownProcess = async () => {
        await server.prepareShutdown();
        setTimeout( async () => {
            await server.shutdown();
            process.exit(0);
        }, config.serverId ? 1000 * 90 : 1);
    };
    process.on('SIGINT', shutDownProcess);
    process.on('SIGTERM', shutDownProcess);
}
