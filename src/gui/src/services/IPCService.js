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

import { Service } from "../definitions.js";

class InternalConnection {
    constructor ({ source, target, uuid, reverse }, { services }) {
        this.services = services;
        this.source = source;
        this.target = target;
        this.uuid = uuid;
        this.reverse = reverse;
    }

    send (data) {
        const svc_process = this.services.get('process');
        const process = svc_process.get_by_uuid(this.target);
        const channel = {
            returnAddress: this.reverse,
        };
        process.send(channel, data);
    }
}

export class IPCService extends Service {
    static description = `
        Allows other services to expose methods to apps.
    `

    async _init () {
        this.connections_ = {};
    }

    add_connection ({ source, target }) {
        const uuid = window.uuidv4();
        const r_uuid = window.uuidv4();
        const forward = this.connections_[uuid] = {
            source, target,
            uuid: uuid, reverse: r_uuid,
        };
        const backward = this.connections_[r_uuid] = {
            source: target, target: source,
            uuid: r_uuid, reverse: uuid,
        };
        return { forward, backward };
    }

    get_connection (uuid) {
        const entry = this.connections_[uuid];
        if ( ! entry ) return;
        if ( entry.object ) return entry.object;
        return entry.object = new InternalConnection(entry, this.context);
    }
    
    register_ipc_handler (name, spec) {
        window.ipc_handlers[name] = spec;
    }
}
