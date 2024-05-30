/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
import { Context } from 'contextlink';
import { launchPuterShell } from './puter-shell/main.js';
import { CreateFilesystemProvider } from './platform/puter/filesystem.js';
import { CreateDriversProvider } from './platform/puter/drivers.js';
import { XDocumentPTT } from './pty/XDocumentPTT.js';
import { CreateEnvProvider } from './platform/puter/env.js';
import { CreateSystemProvider } from './platform/puter/system.js';

window.main_shell = async () => {
    const config = {};

    let resolveConfigured = null;
    const configured_ = new Promise(rslv => {
        resolveConfigured = rslv;
    });

    const terminal = puter.ui.parentApp();
    if (!terminal) {
        console.error('Phoenix cannot run without a parent Terminal. Exiting...');
        puter.exit();
        return;
    }
    terminal.on('message', message => {
        if (message.$ === 'config') {
            const configValues = { ...message };
            delete configValues.$;
            for ( const k in configValues ) {
                config[k] = configValues[k];
            }
            resolveConfigured();
        }
    });
    terminal.on('close', () => {
        console.log('Terminal closed; exiting Phoenix...');
        puter.exit();
    });

    // FIXME: on terminal close, close ourselves

    terminal.postMessage({ $: 'ready' });

    await configured_;

    const puterSDK = globalThis.puter;
    if ( config['puter.auth.token'] ) {
        await puterSDK.setAuthToken(config['puter.auth.token']);
    }

    const ptt = new XDocumentPTT(terminal);
    await launchPuterShell(new Context({
        ptt,
        config, puterSDK,
        externs: new Context({ puterSDK }),
        platform: new Context({
            name: 'puter',
            filesystem: CreateFilesystemProvider({ puterSDK }),
            drivers: CreateDriversProvider({ puterSDK }),
            env: CreateEnvProvider({ config }),
            system: CreateSystemProvider({ puterSDK })
        }),
    }));
};
