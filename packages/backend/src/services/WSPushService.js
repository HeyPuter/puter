/*
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
const { AdvancedBase } = require("@heyputer/puter-js-common");

class WSPushService  extends AdvancedBase {
    static MODULES = {
        socketio: require('../socketio.js'),
    }

    constructor ({ services }) {
        super();
        this.log = services.get('log-service').create('WSPushService');
        this.svc_event = services.get('event');

        this.svc_event.on('fs.create.*', this._on_fs_create.bind(this));
        this.svc_event.on('fs.write.*', this._on_fs_update.bind(this));
        this.svc_event.on('fs.move.*', this._on_fs_move.bind(this));
        this.svc_event.on('fs.pending.*', this._on_fs_pending.bind(this));
        this.svc_event.on('fs.storage.upload-progress',
            this._on_upload_progress.bind(this));
        this.svc_event.on('fs.storage.progress.*',
            this._on_upload_progress.bind(this));
        this.svc_event.on('outer.gui.*',
            this._on_outer_gui.bind(this));
    }

    async _on_fs_create (key, data) {
        const { node, context } = data;
        const { socketio } = this.modules;

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

    async _on_fs_update (key, data) {
        const { node, context } = data;
        const { socketio } = this.modules;

        const metadata = {
            from_new_service: true,
        };

        {
            const svc_operationTrace = context.get('services').get('operationTrace');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const gui_metadata = frame.get_attr('gui_metadata') || {};
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

    async _on_fs_move (key, data) {
        const { moved, old_path, context } = data;
        const { socketio } = this.modules;

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

    async _on_fs_pending (key, data) {
        const { fsentry, context } = data;
        const { socketio } = this.modules;

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

    async _on_upload_progress (key, data) {
        this.log.info('got upload progress event');
        const { socketio } = this.modules;
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

            // TODO: this error is temporarily disabled for
            // Puter V1 release, because it will cause a
            // lot of redundant PagerDuty alerts.

            // throw new Error('missing socket id');
        }

        this.log.info('socket id: ' + socket_id);

        const io = socketio.getio()
            .sockets.sockets
            .get(socket_id);

        // socket disconnected; that's allowed
        if ( ! io ) return;

        const ws_event_name = metadata.call_it_download
            ? 'download.progress' : 'upload.progress' ;

        upload_tracker.sub(delta => {
            this.log.info('emitting progress event');
            io.emit(ws_event_name, {
                ...metadata,
                total: upload_tracker.total_,
                loaded: upload_tracker.progress_,
                loaded_diff: delta,
            })
        })
    }
    
    async _on_outer_gui (key, { user_id_list, response }, meta) {
        key = key.slice('outer.gui.'.length);

        const { socketio } = this.modules;

        const io = socketio.getio();
        for ( const user_id of user_id_list ) {
            io.to(user_id).emit(key, response);
        }
    }
}

module.exports = {
    WSPushService
};
