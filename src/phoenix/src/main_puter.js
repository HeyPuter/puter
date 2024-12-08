/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
import { libs } from '@heyputer/putility';
const { Context } = libs.context;
import { launchPuterShell } from './puter-shell/main.js';
import { CreateFilesystemProvider } from './platform/puter/filesystem.js';
import { CreateDriversProvider } from './platform/puter/drivers.js';
import { XDocumentPTT } from './pty/XDocumentPTT.js';
import { CreateEnvProvider } from './platform/puter/env.js';
import { CreateSystemProvider } from './platform/puter/system.js';
import { parseArgs } from '@pkgjs/parseargs';

window.main_shell = async () => {
    const config = Object.fromEntries(
        new URLSearchParams(window.location.search)
            .entries()
    );

    // let resolveConfigured = null;
    // const configured_ = new Promise(rslv => {
    //     resolveConfigured = rslv;
    // });
    const puterSDK = globalThis.puter;

    const terminal = puter.ui.parentApp();
    if (!terminal) {
        console.error('Phoenix cannot run without a parent Terminal. Exiting...');
        puter.exit();
        return;
    }
    terminal.on('message', message => {
        if (message.$ === 'config') {
            const configValues = { ...message };
            // Only copy the config that we actually need
            // config['puter.auth.username'] = configValues['puter.auth.username'];
            config['puter.auth.token'] = configValues['puter.auth.token'];
            // console.log('set!');
            // resolveConfigured();
        }
    });
    terminal.on('close', () => {
        puter.exit();
    });

    // FIXME: on terminal close, close ourselves

    terminal.postMessage({ $: 'ready' });

    const ptt = new XDocumentPTT(terminal);

    // await configured_;
    const user = await puterSDK.auth.getUser();
    config['puter.auth.username'] = user.username;
    // await new Promise(rslv => setTimeout(rslv, 0));

    // if ( config['puter.auth.token'] ) {
    //     await puterSDK.setAuthToken(config['puter.auth.token']);
    // }

    // TODO: move this into Puter's SDK instead
    if ( ! puter.args?.command_line?.args ) {
        puter.args.command_line = {};
        puter.args.command_line.args = [];
    }

    // Argument parsing happens here
    // puter.args < -- command_line.args
    const { values } = parseArgs({
        options: {
            c: {
                type: 'string'
            }
        },
        args: puter.args.command_line.args
    });

    await launchPuterShell(new Context({
        ptt,
        config, puterSDK,
        init_arguments: values,
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
