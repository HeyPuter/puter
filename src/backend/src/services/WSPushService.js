// METADATA // {"ai-commented":{"service":"xai"}}
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
const BaseService = require("./BaseService");
class WSPushService  extends BaseService {
    /**
    * Initializes the WSPushService by setting up event listeners for various file system operations.
    * 
    * @param {Object} options - The configuration options for the service.
    * @param {Object} options.services - An object containing service dependencies.
    */
    async _init () {
        this.svc_event = this.services.get('event');

        this.svc_event.on('fs.create.*', this._on_fs_create.bind(this));
        this.svc_event.on('fs.write.*', this._on_fs_update.bind(this));
        this.svc_event.on('fs.move.*', this._on_fs_move.bind(this));
        this.svc_event.on('fs.pending.*', this._on_fs_pending.bind(this));
        this.svc_event.on('fs.storage.upload-progress',
            this._on_upload_progress.bind(this));
        this.svc_event.on('fs.storage.progress.*',
            this._on_upload_progress.bind(this));
        this.svc_event.on('puter-exec.submission.done',
            this._on_submission_done.bind(this));
        this.svc_event.on('outer.gui.*',
            this._on_outer_gui.bind(this));
    }


    async _on_fs_create (key, data) {
        const { node, context } = data;

        const metadata = {
            from_new_service: true,
        };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame.get_attr('gui_metadata') || {};
            Object.assign(metadata, gui_metadata);
        }

        const response = await node.getSafeEntry({ thumbnail: true });


        const user_id_list = await (async () => {
            // NOTE: Using a set because eventually we will need to dispatch
            //       to multiple users, but this is not currently the case.
            const user_id_set = new Set();
            if ( metadata.user_id ) user_id_set.add(metadata.user_id);
            else user_id_set.add(await node.get('user_id'));
            return Array.from(user_id_set);
        })();

        Object.assign(response, metadata);

        this.svc_event.emit('outer.gui.item.added', {
            user_id_list,
            response,
        });
    }


    /**
    * Handles file system update events.
    * 
    * @param {string} key - The event key.
    * @param {Object} data - The event data containing node and context information.
    * @returns {Promise<void>} A promise that resolves when the update has been processed.
    * 
    * @description
    * This method is triggered when a file or directory is updated. It retrieves
    * metadata from the context, fetches the updated node's entry, determines the
    * relevant user IDs, and emits an event to notify the GUI of the update.
    * 
    * @note
    * - The method uses a set for user IDs to prepare for future multi-user dispatch.
    * - If no specific user ID is provided in the metadata, it falls back to the node's user ID.
    */
    async _on_fs_update (key, data) {
        const { node, context } = data;

        const metadata = {
            from_new_service: true,
        };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame?.get_attr?.('gui_metadata') || {};
            Object.assign(metadata, gui_metadata);
        }

        const response = await node.getSafeEntry({ debug: 'hi', thumbnail: true });

        const user_id_list = await (async () => {
            // NOTE: Using a set because eventually we will need to dispatch
            //       to multiple users, but this is not currently the case.
            const user_id_set = new Set();
            if ( metadata.user_id ) user_id_set.add(metadata.user_id);
            else user_id_set.add(await node.get('user_id'));
            return Array.from(user_id_set);
        })();

        Object.assign(response, metadata);

        this.svc_event.emit('outer.gui.item.updated', {
            user_id_list,
            response,
        });
    }


    /**
    * Handles file system move events by emitting appropriate GUI update events.
    * 
    * This method is triggered when a file or directory is moved within the file system.
    * It collects necessary metadata, updates the response with the old path, and 
    * broadcasts the event to update the GUI for the affected users.
    *
    * @param {string} key - The event key triggering this method.
    * @param {Object} data - An object containing details about the moved item:
    *   - {Node} moved - The moved file system node.
    *   - {string} old_path - The previous path of the moved item.
    *   - {Context} context - The context in which the move operation occurred.
    * @returns {Promise<void>} A promise that resolves when the event has been emitted.
    */
    async _on_fs_move (key, data) {
        const { moved, old_path, context } = data;

        const metadata = {
            from_new_service: true,
        };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame.get_attr('gui_metadata') || {};
            Object.assign(metadata, gui_metadata);
        }

        const response = await moved.getSafeEntry();

        const user_id_list = await (async () => {
            // NOTE: Using a set because eventually we will need to dispatch
            //       to multiple users, but this is not currently the case.
            const user_id_set = new Set();
            if ( metadata.user_id ) user_id_set.add(metadata.user_id);
            else user_id_set.add(await moved.get('user_id'));
            return Array.from(user_id_set);
        })();

        response.old_path = old_path;
        Object.assign(response, metadata);

        this.svc_event.emit('outer.gui.item.moved', {
            user_id_list,
            response,
        });
    }


    /**
    * Handles the 'fs.pending' event, preparing and emitting data for items that are pending processing.
    * 
    * @param {string} key - The event key, typically starting with 'fs.pending.'.
    * @param {Object} data - An object containing the fsentry and context of the pending file system operation.
    * @param {Object} data.fsentry - The file system entry that is pending.
    * @param {Object} data.context - The operation context providing additional metadata.
    * @fires svc_event#outer.gui.item.pending - Emitted with user ID list and entry details.
    * 
    * @returns {Promise<void>} Emits an event to update the GUI about the pending item.
    */
    async _on_fs_pending (key, data) {
        const { fsentry, context } = data;

        const metadata = {
            from_new_service: true,
        };

        const response = { ...fsentry };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame.get_attr('gui_metadata') || {};
            Object.assign(metadata, gui_metadata);
        }

        const user_id_list = await (async () => {
            // NOTE: Using a set because eventually we will need to dispatch
            //       to multiple users, but this is not currently the case.
            const user_id_set = new Set();
            if ( metadata.user_id ) user_id_set.add(metadata.user_id);
            return Array.from(user_id_set);
        })();

        Object.assign(response, metadata);

        this.svc_event.emit('outer.gui.item.pending', {
            user_id_list,
            response,
        });
    }

    /**
    * Emits an upload or download progress event to the relevant socket.
    * 
    * @param {string} key - The event key that triggered this method.
    * @param {Object} data - Contains upload_tracker, context, and meta information.
    * @param {Object} data.upload_tracker - Tracker for the upload/download progress.
    * @param {Object} data.context - Context of the operation.
    * @param {Object} data.meta - Additional metadata for the event.
    * 
    * It emits a progress event to the socket if it exists, otherwise, it does nothing.
    */
    async _on_upload_progress (key, data) {
        this.log.info('got upload progress event');
        const { upload_tracker, context, meta } = data;

        const metadata = {
            ...meta,
            from_new_service: true,
        };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame.get_attr('gui_metadata') || {};
            Object.assign(metadata, gui_metadata);
        }

        const { socket_id } = metadata;

        if ( ! socket_id ) {
            this.log.error('missing socket id', { metadata });
        }

        this.log.info('socket id: ' + socket_id);
        
        const svc_socketio = context.get('services').get('socketio');
        if ( ! svc_socketio.has({ socket: socket_id }) ) {
            return;
        }

        const ws_event_name = metadata.call_it_download
            ? 'download.progress' : 'upload.progress' ;

        upload_tracker.sub(delta => {
            this.log.info('emitting progress event');
            svc_socketio.send({ socket: socket_id }, ws_event_name, {
                ...metadata,
                total: upload_tracker.total_,
                loaded: upload_tracker.progress_,
                loaded_diff: delta,
            });
        })
    }

    async _on_submission_done (key, data) {
        const { actor } = data;
        const { id, output, summary, measures, aux_outputs } = data;
        const user_id = actor.type.user.id;

        const response = {
            id,
            output,
            summary,
            measures,
            aux_outputs,
        };

        this.svc_event.emit('outer.gui.submission.done', {
            user_id_list: [ user_id ],
            response,
        });
    }

    /**
    * Handles the 'outer.gui.*' event to emit GUI-related updates to specific users.
    * 
    * @param {string} key - The event key with 'outer.gui.' prefix removed.
    * @param {Object} data - Contains user_id_list and response to emit.
    * @param {Object} meta - Additional metadata for the event.
    * 
    * @note This method iterates over each user ID provided in the event data,
    *       checks if the user's socket room exists and has clients, then emits
    *       the event to the appropriate room.
    */
    async _on_outer_gui (key, { user_id_list, response }, meta) {
        key = key.slice('outer.gui.'.length);

        const svc_socketio = this.services.get('socketio');

        for ( const user_id of user_id_list ) {
            if ( ! svc_socketio.has({ room: user_id }) ) {
                continue;
            }
            svc_socketio.send({ room: user_id }, key, response);
            this.svc_event.emit(`sent-to-user.${key}`, {
                user_id,
                response,
                meta,
            });
        }
    }
}

module.exports = {
    WSPushService
};
