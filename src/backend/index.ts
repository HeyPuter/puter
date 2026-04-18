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
    return JSON.parse(readFileSync(chosen, 'utf8')) as IConfig;
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
