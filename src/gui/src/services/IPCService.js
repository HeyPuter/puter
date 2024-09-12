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
