import { Service } from "../definitions.js";
import launch_app from "../helpers/launch_app.js";

export class ExecService extends Service {
    static description = `
        Manages instances of apps on the Puter desktop.
    `
    
    async _init ({ services }) {
        const svc_ipc = services.get('ipc');
        svc_ipc.register_ipc_handler('launchApp', {
            handler: this.launchApp.bind(this),
        });
    }
    
    // This method is exposed to apps via IPCService.
    launchApp ({ app_name, args }, { ipc_context, msg_id } = {}) {
        // This mechanism will be replated with xdrpc soon
        const child_instance_id = window.uuidv4();
        window.child_launch_callbacks[child_instance_id] = {
            parent_instance_id: event.data.appInstanceID,
            launch_msg_id: msg_id,
        };
        
        // The "body" of this method is in a separate file
        launch_app({
            name: app_name,
            args: args ?? {},
            parent_instance_id: ipc_context?.appInstanceId,
            uuid: child_instance_id,
        });
    }
}
