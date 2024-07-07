/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Terminal.
 *
 * Puter's Terminal is free software: you can redistribute it and/or modify
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
export class XDocumentANSIShell {
    constructor (params) {
        this.internal_ = {};
        for ( const k in params ) this.internal_[k] = params[k];
    }

    attachToApp (shell) {
        this.internal_.shell = shell;

        const ptt = this.internal_.ptt;

        shell.on('message', message => {
            // When the shell reports it's ready, send configuration
            if (message.$ === 'ready') {
                const params = Object.fromEntries(
                    new URLSearchParams(window.location.search)
                        .entries()
                );
                shell.postMessage({
                    $: 'config',
                    source: params['puter.api_origin'] ??
                        ( params['puter.domain']
                            ? `https://api.${params['puter.domain']}/`
                            : 'https://api.puter.com/' ),
                    ...params
                });

                const savedSize = this.internal_.windowSize;
                if (savedSize) {
                    shell.postMessage({
                        $: 'ioctl.set',
                        windowSize: savedSize,
                    });
                }
                return;
            }

            if (message.$ === 'stdout') {
                ptt.out.write(message.data);
                return;
            }
        });

        shell.on('close', () => {
            const errorMessage = '\n\n\x1b[31;1mConnection lost with shell!\x1b[0m\n';
            const errorArray = new TextEncoder().encode(errorMessage);
            ptt.out.write(errorArray);
        });

        (async () => {
            for ( ;; ) {
                const chunk = (await ptt.in.read()).value;
                shell.postMessage({
                    $: 'stdin',
                    data: chunk,
                });
            }
        })();
    }

    resize (windowSize) {
        const shell = this.internal_.shell;
        this.internal_.windowSize = windowSize;
        shell.postMessage({
            $: 'ioctl.set',
            windowSize,
        });
    }
}
