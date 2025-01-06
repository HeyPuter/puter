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

import { concepts, AdvancedBase } from "@heyputer/putility";
import TeePromise from "./util/TeePromise.js";

export class Service extends concepts.Service {
    // TODO: Service todo items
    static TODO = [
        'consolidate with BaseService from backend'
    ];
    construct (o) {
        this.$puter = {};
        for ( const k in o ) this.$puter[k] = o[k];
        if ( ! this._construct ) return;
        return this._construct();
    }
    init (...a) {
        if ( ! this._init ) return;
        this.services = a[0].services;
        return this._init(...a)
    }
    get context () {
        return { services: this.services };
    }
};

export const PROCESS_INITIALIZING = { i18n_key: 'initializing' };
export const PROCESS_RUNNING = { i18n_key: 'running' };

export const PROCESS_IPC_PENDING = { i18n_key: 'pending' };
export const PROCESS_IPC_NA = { i18n_key: 'N/A' };
export const PROCESS_IPC_ATTACHED = { i18n_key: 'attached' };

// Something is cloning these objects, so '===' checks don't work.
// To work around this, the `i` property is used to compare them.
export const END_SOFT = { i: 0, end: true, i18n_key: 'end_soft' };
export const END_HARD = { i: 1, end: true, i18n_key: 'end_hard' };

export class Process extends AdvancedBase{
    static PROPERTIES = {
        status: () => PROCESS_INITIALIZING,
        ipc_status: () => PROCESS_IPC_PENDING,
    }
    constructor ({ uuid, parent, name, meta }) {
        super();

        this.uuid = uuid;
        this.parent = parent;
        this.name = name;
        this.meta = meta;
        this.references = {};
        
        Object.defineProperty(this.references, 'iframe', {
            get: () => {
                // note: Might eventually make sense to make the
                // fn on window call here instead.
                return window.iframe_for_app_instance(this.uuid);
            }
        })

        this._construct();
    }
    _construct () {}

    chstatus (status) {
        this.status = status;
    }

    is_init () {}

    signal (sig) {
        this._signal(sig);
    }

    handle_connection (other_process) {
        throw new Error('Not implemented');
    }

    get type () {
        const _to_type_name = (name) => {
            return name.replace(/Process$/, '').toLowerCase();
        };
        return this.type_ || _to_type_name(this.constructor.name) ||
            'invalid'
    }
};

export class InitProcess extends Process {
    static created_ = false;

    is_init () { return true; }

    _construct () {
        this.name = 'Puter';

        this.type_ = 'init'; // thanks minify

        if (InitProcess.created_) {
            throw new Error('InitProccess already created');
        }

        InitProcess.created_ = true;
    }

    _signal (sig) {
        const svc_process = globalThis.services.get('process');
        for ( const process of svc_process.processes ) {
            if ( process === this ) continue;
            process.signal(sig);
        }

        if ( sig.i !== END_HARD.i ) return;

        // Currently this is the only way to terminate `init`.
        window.location.reload();
    }
}

export class PortalProcess extends Process {
    _construct () { this.type_ = 'app' }
    _signal (sig) {
        if ( sig.end ) {
            $(this.references.el_win).close({
                bypass_iframe_messaging: sig.i === END_HARD.i
            });
        }
    }
    
    send (channel, data, context) {
        const target = this.references.iframe.contentWindow;
        target.postMessage({
            msg: 'messageToApp',
            appInstanceID: channel.returnAddress,
            targetAppInstanceID: this.uuid,
            contents: data,
        // }, new URL(this.references.iframe.src).origin);
        }, '*');
    }

    async handle_connection (connection, args) {
        const target = this.references.iframe.contentWindow;
        const connection_response = new TeePromise();
        window.addEventListener('message', (evt) => {
            if ( evt.source !== target ) return;
            // Using '$' instead of 'msg' to avoid handling by IPC.js
            // (following type-tagged message convention)
            if ( evt.data.$ !== 'connection-resp' ) return;
            if ( evt.data.connection !== connection.uuid ) return;
            if ( evt.data.accept ) {
                connection_response.resolve(evt.data.value);
            } else {
                connection_response.reject(evt.data.value
                    ?? new Error('Connection rejected'));
            }
        });
        target.postMessage({
            msg: 'connection',
            appInstanceID: connection.uuid,
            args,
        }, '*');
        const outcome = await Promise.race([
            connection_response,
            new Promise((resolve, reject) => {
                setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 5000);
            })
        ]);
        return outcome;
    }
};
export class PseudoProcess extends Process {
    _construct () { this.type_ = 'ui' }
    _signal (sig) {
        if ( sig.end ) {
            $(this.references.el_win).close({
                bypass_iframe_messaging: sig.i === END_HARD.i
            });
        }
    }
};
