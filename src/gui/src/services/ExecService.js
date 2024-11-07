import { PROCESS_IPC_ATTACHED, Service } from "../definitions.js";
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
        svc_ipc.register_ipc_handler('connectToInstance', {
            handler: this.connectToInstance.bind(this),
        });

        this.log = puter.log.fields({
            category: 'ipc'
        });
    }
    
    // This method is exposed to apps via IPCService.
    async launchApp ({ app_name, args, pseudonym }, { ipc_context, msg_id } = {}) {
        const app = ipc_context?.caller?.app;
        const process = ipc_context?.caller?.process;

        // This mechanism will be replated with xdrpc soon
        const child_instance_id = window.uuidv4();
        
        const svc_ipc = this.services.get('ipc');
        const connection = ipc_context ? svc_ipc.add_connection({
            source: process.uuid,
            target: child_instance_id,
        }) : undefined;

        this.log.info('launchApp connection', connection);

        // The "body" of this method is in a separate file
        const child_process = await launch_app({
            launched_by_exec_service: true,
            name: app_name,
            pseudonym,
            args: args ?? {},
            parent_instance_id: app?.appInstanceID,
            uuid: child_instance_id,
            ...(connection ? {
                parent_pseudo_id: connection.backward.uuid,
            } : {}),
        });

        const send_child_launched_msg = (...a) => {
            if ( ! process ) return;
            // TODO: (maybe) message process instead of iframe
            const parent_iframe = process?.references?.iframe;
            parent_iframe.contentWindow.postMessage({
                msg: 'childAppLaunched',
                original_msg_id: msg_id,
                child_instance_id,
                ...a,
            }, '*');
        }

        child_process.onchange('ipc_status', value => {
            if ( value !== PROCESS_IPC_ATTACHED ) return;

            $(child_process.references.iframe).attr('data-appUsesSDK', 'true');

            send_child_launched_msg({ uses_sdk: true });

            // Send any saved broadcasts to the new app
            globalThis.services.get('broadcast').sendSavedBroadcastsTo(child_instance_id);

            // If `window-active` is set (meanign the window is focused), focus the window one more time
            // this is to ensure that the iframe is `definitely` focused and can receive keyboard events (e.g. keydown)
            if($(child_process.references.el_win).hasClass('window-active')){
                $(child_process.references.el_win).focusWindow();
            }
        });

        $(child_process.references.el_win).on('remove', () =>{
            const parent_iframe = process?.references?.iframe;
            if ($(parent_iframe).attr('data-appUsesSdk') !== 'true') {
                send_child_launched_msg({ uses_sdk: false });
                // We also have to report an extra close event because the real one was sent already
                window.report_app_closed(child_process.uuid);
            }

            process.references.iframe.contentWindow.postMessage({
                msg: 'appClosed',
                appInstanceID: connection.forward.uuid,
                statusCode: 0,
            });
        });

        return {
            appInstanceID: connection ? 
                connection.forward.uuid : child_instance_id,
            usesSDK: true,
        };
    }

    async connectToInstance ({ app_name, args }, { ipc_context, msg_id } = {}) {
        const caller_process = ipc_context?.caller?.process;
        if ( ! caller_process ) {
            throw new Error('Caller process not found');
        }

        console.log(
            caller_process.name,
            app_name,
        );
        // TODO: permissions integration; for now it's hardcoded
        if ( caller_process.name !== 'phoenix' ) {
            throw new Error('Connection not allowed.');
        }
        if ( app_name !== 'puter-linux' ) {
            throw new Error('Connection not allowed.');
        }

        const svc_process = this.services.get('process');
        const options = svc_process.select_by_name(app_name);
        const process = options[0];

        if ( ! process ) {
            throw new Error(`No process found: ${app_name}`);
        }

        const svc_ipc = this.services.get('ipc');
        const connection = svc_ipc.add_connection({
            source: caller_process.uuid,
            target: process.uuid,
        });

        const response = await process.handle_connection(
            connection.backward, args);
        
        return {
            appInstanceID: connection.forward.uuid,
            usesSDK: true,
            response,
        };
    }
}
