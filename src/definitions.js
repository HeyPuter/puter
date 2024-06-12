/**
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
export class Service {
    construct (o) {
        this.$puter = {};
        for ( const k in o ) this.$puter[k] = o[k];
        if ( ! this._construct ) return;
        return this._construct();
    }
    init (...a) {
        if ( ! this._init ) return;
        return this._init(...a)
    }
};

export const PROCESS_INITIALIZING = { i18n_key: 'initializing' };
export const PROCESS_RUNNING = { i18n_key: 'running' };

// Something is cloning these objects, so '===' checks don't work.
// To work around this, the `i` property is used to compare them.
export const END_SOFT = { i: 0, end: true, i18n_key: 'end_soft' };
export const END_HARD = { i: 1, end: true, i18n_key: 'end_hard' };

export class Process {
    constructor ({ uuid, parent, name, meta }) {
        this.uuid = uuid;
        this.parent = parent;
        this.name = name;
        this.meta = meta;
        this.references = {};

        this.status = PROCESS_INITIALIZING;

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
