/**
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

import truncate_filename from './truncate_filename.js';

const get_html_element_from_options = async function (options) {
    const item_id = window.global_element_id++;

    options.disabled = options.disabled ?? false;
    options.visible = options.visible ?? 'visible'; // one of 'visible', 'revealed', 'hidden'
    options.is_dir = options.is_dir ?? false;
    options.is_selected = options.is_selected ?? false;
    options.is_shared = options.is_shared ?? false;
    options.is_shortcut = options.is_shortcut ?? 0;
    options.is_trash = options.is_trash ?? false;
    options.metadata = options.metadata ?? '';
    options.multiselectable = (!options.multiselectable || options.multiselectable === true) ? true : false;
    options.shortcut_to = options.shortcut_to ?? '';
    options.shortcut_to_path = options.shortcut_to_path ?? '';
    options.immutable = (options.immutable === false || options.immutable === 0 || options.immutable === undefined ? 0 : 1);
    options.sort_container_after_append = (options.sort_container_after_append !== undefined ? options.sort_container_after_append : false);
    const is_shared_with_me = (options.path !== `/${window.user.username}` && !options.path.startsWith(`/${window.user.username}/`));

    let website_url = window.determine_website_url(options.path);

    // do a quick check to see if the target parent has any file type restrictions
    const appendto_allowed_file_types = $(options.appendTo).attr('data-allowed_file_types');
    if ( ! window.check_fsentry_against_allowed_file_types_string({ is_dir: options.is_dir, name: options.name, type: options.type }, appendto_allowed_file_types) )
    {
        options.disabled = true;
    }

    // --------------------------------------------------------
    // HTML for Item
    // --------------------------------------------------------
    let h = '';
    h += `<div  id="item-${item_id}" 
                class="item${options.is_selected ? ' item-selected' : ''} ${options.disabled ? 'item-disabled' : ''} item-${options.visible}" 
                data-id="${item_id}" 
                data-name="${html_encode(options.name)}" 
                data-metadata="${html_encode(options.metadata)}" 
                data-uid="${options.uid}" 
                data-is_dir="${options.is_dir ? 1 : 0}" 
                data-is_trash="${options.is_trash ? 1 : 0}"
                data-has_website="${options.has_website ? 1 : 0 }" 
                data-website_url = "${website_url ? html_encode(website_url) : ''}"
                data-immutable="${options.immutable}" 
                data-is_shortcut = "${options.is_shortcut}"
                data-shortcut_to = "${html_encode(options.shortcut_to)}"
                data-shortcut_to_path = "${html_encode(options.shortcut_to_path)}"
                data-sortable = "${options.sortable ?? 'true'}"
                data-sort_by = "${html_encode(options.sort_by) ?? 'name'}"
                data-size = "${options.size ?? ''}"
                data-type = "${html_encode(options.type) ?? ''}"
                data-modified = "${options.modified ?? ''}"
                data-associated_app_name = "${html_encode(options.associated_app_name) ?? ''}"
                data-path="${html_encode(options.path)}">`;

    // spinner
    h += '<div class="item-spinner">';
    h += '</div>';
    // modified
    h += '<div class="item-attr item-attr--modified">';
    h += `<span>${options.modified === 0 ? '-' : timeago.format(options.modified * 1000)}</span>`;
    h += '</div>';
    // size
    h += '<div class="item-attr item-attr--size">';
    h += `<span>${options.size ? window.byte_format(options.size) : '-'}</span>`;
    h += '</div>';
    // type
    h += '<div class="item-attr item-attr--type">';
    if ( options.is_dir )
    {
        h += '<span>Folder</span>';
    }
    else
    {
        h += `<span>${options.type ? html_encode(options.type) : '-'}</span>`;
    }
    h += '</div>';

    // icon
    h += '<div class="item-icon">';
    h += `<img src="${html_encode(options.icon.image)}" class="item-icon-${options.icon.type}" data-item-id="${item_id}">`;
    h += '</div>';
    // badges
    h += '<div class="item-badges">';
    // website badge
    h += `<img  class="item-badge item-has-website-badge long-hover" 
                        style="${options.has_website ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['world.svg'])}" 
                        data-item-id="${item_id}"
                    >`;
    // link badge
    h += `<img  class="item-badge item-has-website-url-badge" 
                        style="${website_url ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['link.svg'])}" 
                        data-item-id="${item_id}"
                    >`;

    // shared badge
    h += `<img  class="item-badge item-badge-has-permission" 
                        style="display: ${ is_shared_with_me ? 'block' : 'none'};
                            background-color: #ffffff;
                            padding: 2px;" src="${html_encode(window.icons['shared.svg'])}" 
                        data-item-id="${item_id}"
                        title="A user has shared this item with you.">`;
    // owner-shared badge
    h += `<img  class="item-badge item-is-shared" 
                        style="background-color: #ffffff; padding: 2px; ${!is_shared_with_me && options.is_shared ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['owner-shared.svg'])}" 
                        data-item-id="${item_id}"
                        data-item-uid="${options.uid}"
                        data-item-path="${html_encode(options.path)}"
                        title="You have shared this item with at least one other user."
                    >`;
    // shortcut badge
    h += `<img  class="item-badge item-shortcut" 
                        style="background-color: #ffffff; padding: 2px; ${options.is_shortcut !== 0 ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['shortcut.svg'])}" 
                        data-item-id="${item_id}"
                        title="Shortcut"
                    >`;

    h += '</div>';

    // name
    h += `<span class="item-name" data-item-id="${item_id}" title="${html_encode(options.name)}">${html_encode(truncate_filename(options.name))}</span>`;
    // name editor
    h += `<textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${html_encode(options.name)}</textarea>`;
    h += '</div>';

    return h;
};

export default get_html_element_from_options;