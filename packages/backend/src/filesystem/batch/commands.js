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
const { AsyncProviderTrait } = require("../../traits/AsyncProviderTrait");
const { HLMkdir, QuickMkdir } = require("../hl_operations/hl_mkdir");
const { Context } = require("../../util/context");
const { HLWrite } = require("../hl_operations/hl_write");
const { get_app } = require("../../helpers");
const { OperationFrame } = require("../../services/OperationTraceService");
const { AppUnderUserActorType } = require("../../services/auth/Actor");
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { HLMkShortcut } = require("../hl_operations/hl_mkshortcut");
const { HLMkLink } = require("../hl_operations/hl_mklink");
const { HLRemove } = require("../hl_operations/hl_remove");


class BatchCommand extends AdvancedBase {
    static TRAITS = [
        new AsyncProviderTrait(),
    ]
    static async run (executor, parameters) {
        const instance = new this();
        let x = Context.get();
        const operationTraceSvc = x.get('services').get('operationTrace');
        const frame = await operationTraceSvc.add_frame('batch:' + this.name);
        if ( parameters.hasOwnProperty('item_upload_id') ) {
            frame.attr('gui_metadata', {
                ...(frame.get_attr('gui_metadata') || {}),
                item_upload_id: parameters.item_upload_id,
            });
        }
        x = x.sub({ [operationTraceSvc.ckey('frame')]: frame });
        await x.arun(async () => {
            await instance.run(executor, parameters);
        });
        frame.status = OperationFrame.FRAME_STATUS_DONE;
        return instance;
    }
}

class MkdirCommand extends BatchCommand {
    async run (executor, parameters) {
        const context = Context.get();
        const fs = context.get('services').get('filesystem');

        const parent = parameters.parent
            ? await fs.node(await executor.pathResolver.awaitSelector(parameters.parent))
            : undefined ;

        const meta = parameters.parent
            ? executor.pathResolver.getMeta(parameters.parent)
            : undefined ;

        if ( meta?.conflict_free ) {
            // No potential conflict; just create the directory
            const q_mkdir = new QuickMkdir();
            await q_mkdir.run({
                parent,
                path: parameters.path,
            });
            if ( parameters.as ) {
                executor.pathResolver.putSelector(
                    parameters.as,
                    q_mkdir.created.selector,
                    { conflict_free: true }
                );
            }
            this.setFactory('result', async () => {
                await q_mkdir.created.awaitStableEntry();
                const response = await q_mkdir.created.getSafeEntry();
                return response;
            });
            return;
        }
        console.log('USING SLOW MKDIR');

        const hl_mkdir = new HLMkdir();
        const response = await hl_mkdir.run({
            parent,
            path: parameters.path,
            overwrite: parameters.overwrite,
            dedupe_name: parameters.dedupe_name,
            create_missing_parents:
                parameters.create_missing_ancestors ??
                parameters.create_missing_parents ??
                false,
            shortcut_to: parameters.shortcut_to,
            user: executor.user,
        });
        if ( parameters.as ) {
            executor.pathResolver.putSelector(
                parameters.as,
                hl_mkdir.created.selector,
                hl_mkdir.used_existing
                    ? undefined
                    : { conflict_free: true }
            );
        }
        this.provideValue('result', response)
    }
}

class WriteCommand extends BatchCommand {
    async run (executor, parameters) {
        const context = Context.get();
        const fs = context.get('services').get('filesystem');

        const uploaded_file = executor.getFile();

        const destinationOrParent =
            await fs.node(await executor.pathResolver.awaitSelector(parameters.path));

        let app;
        if ( parameters.app_uid ) {
            app = await get_app({uid: parameters.app_uid})
        }

        const hl_write = new HLWrite();
        const response = await hl_write.run({
            destination_or_parent: destinationOrParent,
            specified_name: parameters.name,
            fallback_name: uploaded_file.originalname,

            overwrite: parameters.overwrite,
            dedupe_name: parameters.dedupe_name,

            create_missing_parents:
                parameters.create_missing_ancestors ??
                parameters.create_missing_parents ??
                false,
            user: executor.user,

            file: uploaded_file,
            offset: parameters.offset,

            // TODO: handle these with event service instead
            socket_id: parameters.socket_id,
            operation_id: parameters.operation_id,
            item_upload_id: parameters.item_upload_id,
            app_id: app ? app.id : null,
        });

        this.provideValue('result', response);


        // const opctx = await fs.write(fs, {
        //     // --- per file ---
        //     name: parameters.name,
        //     fallbackName: uploaded_file.originalname,
        //     destinationOrParent,
        //     // app_id: app ? app.id : null,
        //     overwrite: parameters.overwrite,
        //     dedupe_name: parameters.dedupe_name,
        //     file: uploaded_file,
        //     thumbnail: parameters.thumbnail,
        //     target: parameters.target ? await req.fs.node(parameters.shortcut_to) : null,
        //     symlink_path: parameters.symlink_path,
        //     operation_id: parameters.operation_id,
        //     item_upload_id: parameters.item_upload_id,
        //     user: executor.user,

        //     // --- per batch ---
        //     socket_id: parameters.socket_id,
        //     original_client_socket_id: parameters.original_client_socket_id,
        // });

        // opctx.onValue('response', v => this.provideValue('result', v));
    }
}

class ShortcutCommand extends BatchCommand {
    async run (executor, parameters) {
        const context = Context.get();
        const fs = context.get('services').get('filesystem');

        const destinationOrParent =
            await fs.node(await executor.pathResolver.awaitSelector(parameters.path));

        const shortcut_to =
            await fs.node(await executor.pathResolver.awaitSelector(parameters.shortcut_to));

        let app;
        if ( parameters.app_uid ) {
            app = await get_app({uid: parameters.app_uid})
        }

        await destinationOrParent.fetchEntry({ thumbnail: true });
        await shortcut_to.fetchEntry({ thumbnail: true });

        const hl_mkShortcut = new HLMkShortcut();
        const response = await hl_mkShortcut.run({
            parent: destinationOrParent,
            name: parameters.name,
            user: executor.user,
            target: shortcut_to,

            // TODO: handle these with event service instead
            socket_id: parameters.socket_id,
            operation_id: parameters.operation_id,
            item_upload_id: parameters.item_upload_id,
            app_id: app ? app.id : null,
        });

        this.provideValue('result', response);
    }
}

class SymlinkCommand extends BatchCommand {
    async run (executor, parameters) {
        const context = Context.get();
        const fs = context.get('services').get('filesystem');

        const destinationOrParent =
            await fs.node(await executor.pathResolver.awaitSelector(parameters.path));

        let app;
        if ( parameters.app_uid ) {
            app = await get_app({uid: parameters.app_uid})
        }

        await destinationOrParent.fetchEntry({ thumbnail: true });

        const hl_mkLink = new HLMkLink();
        const response = await hl_mkLink.run({
            parent: destinationOrParent,
            name: parameters.name,
            user: executor.user,
            target: parameters.target,

            // TODO: handle these with event service instead
            socket_id: parameters.socket_id,
            operation_id: parameters.operation_id,
            item_upload_id: parameters.item_upload_id,
            app_id: app ? app.id : null,
        });

        this.provideValue('result', response);
    }
}

class DeleteCommand extends BatchCommand {
    async run (executor, parameters) {
        const context = Context.get();
        const fs = context.get('services').get('filesystem');

        const target =
            await fs.node(await executor.pathResolver.awaitSelector(parameters.path));

        const hl_remove = new HLRemove();
        const response = await hl_remove.run({
            target,
            user: executor.user,
            recursive: parameters.recursive ?? false,
            descendants_only: parameters.descendants_only ?? false,
        });
        this.provideValue('result', response);
    }
}

module.exports = {
    commands: {
        mkdir: MkdirCommand,
        write: WriteCommand,
        shortcut: ShortcutCommand,
        symlink: SymlinkCommand,
        delete: DeleteCommand,
    }
};
