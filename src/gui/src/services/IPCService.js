import { Service } from "../definitions.js";

export class IPCService extends Service {
    async _init () {
        //
    }
    
    register_ipc_handler (name, spec) {
        window.ipc_handlers[name] = spec;
    }
}
