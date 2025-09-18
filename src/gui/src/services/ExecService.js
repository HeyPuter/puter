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

import { PROCESS_IPC_ATTACHED, Service } from "../definitions.js";
import launch_app from "../helpers/launch_app.js";

export class ExecService extends Service {
    static description = `
        Manages instances of apps on the Puter desktop.
    `

    _construct () {
        this.param_providers = [];
    }

    register_param_provider (param_provider) {
        this.param_providers.push(param_provider);
    }
    
    async _init ({ services }) {
        const svc_ipc = services.get('ipc');
        svc_ipc.register_ipc_handler('launchApp', {
            handler: this.launchApp.bind(this),
        });
        svc_ipc.register_ipc_handler('connectToInstance', {
            handler: this.connectToInstance.bind(this),
        });

        this.log = puter.logger.fields({
            category: 'ipc'
        });
    }
    
    // This method is exposed to apps via IPCService.
    async launchApp ({ app_name, args, pseudonym, file_paths, items }, { ipc_context, msg_id } = {}) {
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

        const params = {};
        for ( const provider of this.param_providers ) {
            Object.assign(params, provider());
        }

        // Collect source app metadata if available
        let source_app_metadata = {};
        if (app) {
            // Get the source app information
            try {
                const source_app_info = await window.get_apps(process?.name);
                if (source_app_info && !Array.isArray(source_app_info)) {
                    source_app_metadata = {
                        source_app_title: source_app_info.title || process?.name,
                        source_app_id: source_app_info.uuid || source_app_info.uid,
                        source_app_name: source_app_info?.name || process?.name,
                    };
                }
            } catch (error) {
                // If we can't get app info, use basic process info
                source_app_metadata = {
                    source_app_title: process?.name,
                    source_app_id: process?.uuid,
                    source_app_name: process?.name,
                };
            }
        }

        // Handle file paths if provided and caller is in godmode
        let launch_options = {
            launched_by_exec_service: true,
            name: app_name,
            pseudonym,
            args: args ?? {},
            parent_instance_id: app?.appInstanceID,
            uuid: child_instance_id,
            params,
            ...source_app_metadata,
            ...(connection ? {
                parent_pseudo_id: connection.backward.uuid,
            } : {}),
        };
        
        if ( items && items.length ) {
            if ( items.length > 1 ) {
                console.warn('launchApp does not support launch with multiple items (yet)');
            }
            launch_options.file_signature = items[0];
        }

        // Check if file_paths are provided and caller has godmode permissions
        if (file_paths && Array.isArray(file_paths) && file_paths.length > 0 && process) {
            try {
                // Get caller app info to check godmode status
                const caller_app_name = process.name;
                const caller_app_info = await window.get_apps(caller_app_name);
                
                // Check if caller is in godmode
                if (caller_app_info && caller_app_info.godmode === 1) {
                    this.log.info(`⚠️ GODMODE app ${caller_app_name} launching ${app_name} with files:`, file_paths);
                    
                    // Get target app info to create file signatures
                    const target_app_info = await puter.apps.get(app_name);
                    
                    // For the first file, create a file signature and set it up like opening a file
                    if (file_paths.length > 0) {
                        const first_file_path = file_paths[0];
                        
                        try {
                            // Get file stats to verify it exists
                            const file_stat = await puter.fs.stat({path: first_file_path, consistency: 'eventual'});
                            
                            // Create file signature for the target app
                            const file_signature_result = await puter.fs.sign(target_app_info.uuid, {
                                path: first_file_path,
                                action: 'write'
                            });
                            
                            // Set up launch options with file information
                            launch_options.file_signature = file_signature_result.items;
                            launch_options.file_path = first_file_path;
                            launch_options.token = file_signature_result.token;
                            
                            // Add all file paths to args for the target app
                            launch_options.args.file_paths = file_paths;
                            
                        } catch (file_error) {
                            this.log.warn(`Failed to process file ${first_file_path}:`, file_error);
                            // Continue with launch but without file signature
                        }
                    }
                    
                } else {
                    console.log(`⚠️ App ${caller_app_name} attempted to launch ${app_name} with files but does not have godmode permissions`);
                    // Continue with normal launch, ignoring file_paths
                }
            } catch (error) {
                console.log('Error checking godmode permissions:', error);
                // Continue with normal launch
            }
        }

        // The "body" of this method is in a separate file
        const child_process = await launch_app(launch_options);

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
            }, '*');
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
