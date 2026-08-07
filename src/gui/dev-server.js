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
import express from 'express';
import { generateDevHtml, build } from './utils.js';
import { argv } from 'node:process';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { authmeRequestUrl } from './src/util/authmeGrant.js';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Arguments: the first bare argument selects the env ('dev' or 'prod');
// `--server=<domain-or-origin>` points the GUI at a remote Puter backend,
// e.g. `--server=puter.com` or `--server=http://puter.localhost:4100`.
// `--extensions=<dir>[;<dir>...]` bundles extra (out-of-tree) GUI extension
// directories into the build via PUTER_GUI_EXTENSION_PATHS.
// `npm start --server=puter.com` (repo root) arrives via npm_config_server.
let env = null;
let server = process.env.npm_config_server || null;
let extensions = process.env.npm_config_extensions || null;
for ( const arg of argv.slice(2) ) {
    if ( arg.startsWith('--server=') ) server = arg.slice('--server='.length);
    else if ( arg.startsWith('--extensions=') ) extensions = arg.slice('--extensions='.length);
    else if ( ! arg.startsWith('--') && env === null ) env = arg;
}

if ( extensions ) {
    const dirs = extensions.split(';').filter(Boolean)
        .map(p => path.resolve(process.cwd(), p));
    for ( const dir of dirs ) {
        if ( ! fs.existsSync(dir) ) {
            console.warn(chalk.yellow(`WARNING: GUI extensions directory not found: ${dir}`));
        }
    }
    process.env.PUTER_GUI_EXTENSION_PATHS =
        [process.env.PUTER_GUI_EXTENSION_PATHS, ...dirs].filter(Boolean).join(';');
    console.log('Extra GUI extensions:', dirs.join(', '));
}
// A remote server implies the bundled GUI: the unbundled html loads raw
// source modules, whose bare npm imports don't resolve in the browser.
env = env ?? (server ? 'prod' : 'dev');
const bundled = env === 'prod';

// Bare domains follow the production convention of the API living at
// `api.<domain>`; a full origin (or an `api.` host) is used verbatim.
// guiOrigin is the remote server's own GUI origin — whoarewe, anti-csrf,
// socket.io, and builtin apps are all served there and are CORS-open, so
// the local GUI must point `gui_origin` at it.
//
// Signing in is the exception. `/login` and `/signup` answer with a full
// session token, so they only accept their own origin (`guiOriginGate` on
// the backend) — otherwise any page anywhere could trade a password for a
// session and read it straight out of the response. Instead the GUI bounces
// to `<guiOrigin>/?action=authme&token_type=session&redirectURL=<here>` and
// comes back with a token in the URL: the password is only ever typed on the
// remote's own origin, and the grant needs a type-to-confirm.
const { apiOrigin, guiOrigin, appDomain } = (() => {
    const value = server ?? 'puter.com';
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return {
        apiOrigin: value.includes('://') || url.hostname.startsWith('api.')
            ? url.origin
            : `https://api.${url.hostname}`,
        guiOrigin: `${url.protocol}//${url.host.replace(/^api\./, '')}`,
        appDomain: url.hostname.replace(/^api\./, ''),
    };
})();

const app = express();
let port = process.env.PORT ?? 4000; // Starting port
const maxAttempts = 10; // Maximum number of ports to try

const startServer = (attempt, useAnyFreePort = false) => {
    if ( attempt > maxAttempts ) {
        useAnyFreePort = true; // Use any port that is free
    }

    // Express 5 invokes the listen callback on 'error' as well, with the
    // error as its first argument — in that case server.address() is null,
    // so bail and let the 'error' listener below own the retry.
    const server = app.listen(useAnyFreePort ? 0 : port, (err) => {
        if ( err ) return;
        const guiUrl = `http://localhost:${server.address().port}`;
        // Same builder the GUI navigates to when it finds no session, so the
        // printed link and the automatic redirect can never disagree.
        const signInUrl = authmeRequestUrl(guiOrigin, `${guiUrl}/`, {
            fullToken: true,
        }).href;

        const label = (s) => chalk.dim(s.padEnd(14));
        console.log(`\n${chalk.bold('  Puter')} ${chalk.dim('(GUI only — backend is remote)')}\n`);
        console.log(`  ${label('GUI')}${chalk.underline.blue(guiUrl)}`);
        console.log(`  ${label('API')}${chalk.underline.blue(apiOrigin)}`);
        console.log(`  ${label('Accounts')}${chalk.underline.blue(guiOrigin)}`);
        console.log(`\n  ${label('Sign in')}${chalk.underline.cyan(signInUrl)}`);
        console.log(chalk.dim(`\n  Opening ${guiUrl} sends you there automatically when you have no\n  session. Signing in grants this local GUI a full account session, so\n  ${guiOrigin} asks you to confirm before handing it over.\n`));

        if ( process.env.PUTER_NO_BROWSER ) return;
        // Open the GUI rather than the sign-in link directly: it's idempotent.
        // An already-signed-in GUI loads straight to the desktop instead of
        // re-prompting for consent on every restart.
        open(guiUrl).catch((e) => {
            console.log(chalk.dim(`  (could not open a browser: ${e.message})`));
        });
    }).on('error', (err) => {
        if ( err.code === 'EADDRINUSE' ) { // Check if the error is because the port is already in use
            console.error(chalk.red(`ERROR: Port ${port} is already in use. Trying next port...`));
            port++; // Increment the port number
            startServer(attempt + 1); // Try the next port
        }
    });
};

// Build the GUI. The bundled html can't render without the webpack output,
// so wait for the build before serving anything.
try {
    await build();
} catch (err) {
    // webpack already printed the compilation errors above
    console.error(chalk.red(`\nGUI build failed: ${err.message}`));
    process.exit(1);
}

startServer(1);

app.get(['/', '/app/*splat', '/action/*splat', '/desktop', '/desktop/app/*splat', '/dashboard'], (req, res) => {
    res.send(generateDevHtml({
        env: env,
        api_origin: apiOrigin,
        gui_origin: guiOrigin,
        app_domain: appDomain,
        title: 'Puter',
        max_item_name_length: 150,
        require_email_verification_to_publish_website: false,
        short_description: 'Puter is a privacy-first personal cloud that houses all your files, apps, and games in one private and secure place, accessible from anywhere at any time.',
    }));
});

// The unbundled html loads the local puter.js build at /sdk/puter.dev.js;
// fall back to the production build when only that one exists.
const sdkDir = path.join(__dirname, '../puter-js/dist');
app.use('/sdk', express.static(sdkDir));
app.get('/sdk/puter.dev.js', (req, res, next) => {
    const prodBuild = path.join(sdkDir, 'puter.js');
    if ( fs.existsSync(prodBuild) ) res.sendFile(prodBuild);
    else next();
});

app.use(express.static(__dirname));

if ( bundled ) {
    // make sure to serve the ./dist/ folder maps to the root of the website
    app.use(express.static(path.join(__dirname, 'dist')));
} else {
    app.use(express.static(path.join(__dirname, 'src')));
}

export { app };
