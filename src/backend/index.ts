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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { puterDrivers } from './drivers';
import { PuterServer } from './server';
import { puterServices } from './services';
import { puterStores } from './stores';
import type { IConfig } from './types';

// Config resolution order:
//   1. `process.env.PUTER_CONFIG_PATH` — absolute path to a config file. Used
//      by prod (ECS/Docker) where the outer bootstrap writes a merged config
//      out of Secrets Manager + container env to a known location.
//   2. `<PACKAGE_ROOT>/config.json` — user's runtime override (gitignored),
//      deep-merged over config.default.json so users can omit keys they
//      don't care to override (e.g. gui_assets_root, database).
//   3. `<PACKAGE_ROOT>/config.default.json` — bundled OSS defaults.
//
// Post-flatten depth: compiled file is at `packages/puter/dist/src/backend/index.js`,
// so three `..`s land at `packages/puter/`.
const PACKAGE_ROOT = path.resolve(__dirname, '../../..');
// Root of the running code tree. Matches PACKAGE_ROOT for a source run, but
// points at `dist/` for a compiled run — so config-declared paths like
// `./extensions` resolve to `dist/extensions` at runtime without the config
// having to know about the build layout.
const RUNTIME_ROOT = path.resolve(__dirname, '../..');

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const deepMerge = <T extends Record<string, unknown>>(
    base: T,
    override: Record<string, unknown>,
): T => {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(override)) {
        out[k] =
            isPlainObject(v) && isPlainObject(out[k])
                ? deepMerge(out[k] as Record<string, unknown>, v)
                : v;
    }
    return out as T;
};

const loadConfig = (): IConfig => {
    const envPath = process.env.PUTER_CONFIG_PATH;
    const runtimePath = path.join(PACKAGE_ROOT, 'config.json');
    const defaultPath = path.join(PACKAGE_ROOT, 'config.default.json');

    const defaults = existsSync(defaultPath)
        ? (JSON.parse(readFileSync(defaultPath, 'utf8')) as Record<
              string,
              unknown
          >)
        : {};

    // Runtime override path: env wins, then config.json, else no override
    // (we still return defaults so single-file installs work).
    const overridePath =
        envPath && existsSync(envPath)
            ? envPath
            : existsSync(runtimePath)
              ? runtimePath
              : null;

    console.log(`[config] defaults from ${defaultPath}`);
    if (overridePath) console.log(`[config] override from ${overridePath}`);

    const override = overridePath
        ? (JSON.parse(readFileSync(overridePath, 'utf8')) as Record<
              string,
              unknown
          >)
        : {};

    const config = deepMerge(defaults, override) as IConfig;

    if (!config.version) {
        const pkgPath = path.join(PACKAGE_ROOT, 'package.json');
        if (existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
                    version?: string;
                };
                if (pkg.version) config.version = pkg.version;
            } catch {
                // fall through — /version returns 'unknown'
            }
        }
    }

    // Computed defaults. `origin` and `pub_port` are the externally-visible
    // URL+port — what the browser sees. Separate from `port`, which is the
    // bind port (can differ when behind a reverse proxy). Code paths that
    // build self-referential URLs (GUI bootstrap, email links, OIDC callbacks)
    // depend on `origin` having the right port baked in.
    if (config.pub_port === undefined) config.pub_port = config.port;
    const protocol = config.protocol ?? 'http';
    const domain = config.domain ?? 'localhost';
    const portSuffix =
        config.pub_port === 80 || config.pub_port === 443
            ? ''
            : `:${config.pub_port}`;
    if (config.origin === undefined) {
        config.origin = `${protocol}://${domain}${portSuffix}`;
    }
    // API lives on the `api.` subdomain on the same host+port as the main
    // origin (see PuterRouter subdomain handling in server.ts). Compute it
    // from pub_port/domain so a single-port override (e.g. port: 5101) flows
    // through to the GUI bootstrap without users having to restate the URL.
    if (config.api_base_url === undefined) {
        config.api_base_url = `${protocol}://api.${domain}${portSuffix}`;
    }

    // Resolve path-valued config fields. Two different roots:
    // - `extensions` uses RUNTIME_ROOT because extensions ship inside the
    //   build output (dist/extensions) and the loader's dynamic import()
    //   resolves relative paths against the *importing* module file.
    // - GUI/puter-js/builtin-apps use PACKAGE_ROOT because those assets
    //   live only in the source tree (not copied into dist/) and are served
    //   via express.static at runtime.
    const resolveRuntime = (p: string): string =>
        path.isAbsolute(p) ? p : path.resolve(RUNTIME_ROOT, p);
    const resolvePackage = (p: string): string =>
        path.isAbsolute(p) ? p : path.resolve(PACKAGE_ROOT, p);

    if (Array.isArray(config.extensions)) {
        config.extensions = config.extensions.map(resolveRuntime);
    }
    if (typeof config.gui_assets_root === 'string') {
        config.gui_assets_root = resolvePackage(config.gui_assets_root);
    }
    if (typeof config.puterjs_root === 'string') {
        config.puterjs_root = resolvePackage(config.puterjs_root);
    }
    if (isPlainObject(config.builtin_apps)) {
        for (const [k, v] of Object.entries(config.builtin_apps)) {
            if (typeof v === 'string') {
                (config.builtin_apps as Record<string, string>)[k] =
                    resolvePackage(v);
            }
        }
    }
    return config;
};

// if called directly, start the server
if (require.main === module) {
    const config = loadConfig();
    const server = new PuterServer(
        config,
        puterClients,
        puterStores,
        puterServices,
        puterControllers,
        puterDrivers,
    );
    server.start();
    // listen for shutdown signals to gracefully stop the server
    const shutDownProcess = async () => {
        await server.prepareShutdown();
        setTimeout(
            async () => {
                await server.shutdown();
                process.exit(0);
            },
            config.serverId ? 1000 * 90 : 1,
        );
    };
    process.on('SIGINT', shutDownProcess);
    process.on('SIGTERM', shutDownProcess);
}
