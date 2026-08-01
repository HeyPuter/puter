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

import UIItem from '../UI/UIItem.js';
import item_icon from './item_icon.js';
import { select_added_item_if_pending } from './upload_selection.js';

/**
 * Reflect an `item.added` socket event in every open UIWindow item container
 * showing the item's directory — explorer windows and file dialogs.
 *
 * Shared by both shells: the desktop and the dashboard each own their
 * chrome-specific listing (desktop icons / the dashboard's Files tab) but both
 * can host UIWindow item containers, and those need the same treatment. When
 * only the desktop did this, uploading through a file dialog's "Upload" button
 * on the dashboard left the dialog looking empty until it was navigated.
 *
 * A dialog's `accept` filter needs no handling here — UIItem reads
 * data-allowed_file_types off the container it is appended to.
 *
 * @param {object} item fsentry from the `item.added` event
 */
const apply_item_added_to_containers = async function (item) {
    const $containers = $(`.item-container[data-path='${html_encode(item.dirpath)}' i]`);
    if ( $containers.length === 0 ) {
        return;
    }

    // An overwrite reuses the existing element rather than adding a second one.
    if ( item.overwritten_uid ) {
        $(`.item[data-uid='${item.overwritten_uid}']`).attr({
            'data-immutable': item.immutable,
            'data-path': item.path,
            'data-name': item.name,
            'data-size': item.size,
            'data-modified': item.modified,
            'data-type': item.type,
        });
        const new_icon = (item.is_dir ? window.icons['folder.svg'] : (await item_icon(item)).image);
        $(`.item[data-uid="${item.overwritten_uid}"]`).find('.item-icon > img').attr('src', new_icon);
    } else {
        UIItem({
            appendTo: $containers,
            uid: item.uid,
            immutable: item.immutable || item.writable === false,
            associated_app_name: item.associated_app?.name,
            path: item.path,
            icon: await item_icon(item),
            name: item.name,
            size: item.size,
            type: item.type,
            modified: item.modified,
            is_dir: item.is_dir,
            is_shortcut: item.is_shortcut,
            shortcut_to: item.shortcut_to,
            shortcut_to_path: item.shortcut_to_path,
        });
    }

    $containers.each(function () {
        window.sort_items(this, $(this).attr('data-sort_by'), $(this).attr('data-sort_order'));
    });

    // If this item was just uploaded from this client, its upload `success`
    // handler may have run before this element existed — land it selected.
    select_added_item_if_pending(item, $containers);
};

export default apply_item_added_to_containers;
