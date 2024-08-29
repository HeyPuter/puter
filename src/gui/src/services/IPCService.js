import { Service } from "../definitions.js";

export class IPCService extends Service {
    static description = `
        Allows other services to expose methods to apps.
    `

    async _init () {
        //
    }
    
    register_ipc_handler (name, spec) {
        window.ipc_handlers[name] = spec;
    }
}
