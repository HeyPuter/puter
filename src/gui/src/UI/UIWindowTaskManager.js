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
import { END_HARD, END_SOFT } from "../definitions.js";
import UIAlert from "./UIAlert.js";
import UIContextMenu from "./UIContextMenu.js";
import UIWindow from './UIWindow.js';

const end_process = async (uuid, force) => {
    const svc_process = globalThis.services.get('process');
    const process = svc_process.get_by_uuid(uuid);
    if (!process) {
        console.warn(`Can't end process with uuid='${uuid}': does not exist`);
        return;
    }

    let confirmation;
    if ( process.is_init() ) {
        if ( ! force ) {
            confirmation = i18n('close_all_windows_confirm');
        } else {
            confirmation = i18n('restart_puter_confirm');
        }
    } else if ( force ) {
        confirmation = i18n('end_process_force_confirm');
    }

    if ( confirmation ) {
        const alert_resp = await UIAlert({
            message: confirmation,
            buttons:[
                {
                    label: i18n('yes'),
                    value: true,
                    type: 'primary',
                },
                {
                    label: i18n('no'),
                    value: false,
                },
            ]
        })
        if ( ! alert_resp ) return;
    }

    process.signal(force ? END_HARD : END_SOFT);
};

const calculate_indent_string = (indent_level, is_last_item_stack, is_last_item) => {
    // Returns a string of '| ├└'
    let result = '';

    for ( let i=0; i < indent_level; i++ ) {
        const last_cell = i === indent_level - 1;
        const has_trunk = (last_cell && ( ! is_last_item )) ||
                (!last_cell && !is_last_item_stack[i+1]);
        const has_branch = last_cell;

        if (has_trunk && has_branch) {
            result += '├';
        } else if (has_trunk) {
            result += '|';
        } else if (has_branch) {
            result += '└';
        } else {
            result += ' ';
        }
    }

    return result;
};

const generate_task_rows = (items, { indent_level, is_last_item_stack }) => {
    const svc_process = globalThis.services.get('process');
    let rows_html = '';
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const is_last_item = i === items.length - 1;
        const indentation = calculate_indent_string(indent_level, is_last_item_stack, is_last_item);
        
        // Generate indentation HTML
        let indentation_html = '';
        for (const c of indentation) {
            indentation_html += `<div class="indentcell">`;
            switch (c) {
                case ' ':
                    break;
                case '|':
                    indentation_html += `<div class="indentcell-trunk"></div>`;
                    break;
                case '└':
                    indentation_html += `<div class="indentcell-branch"></div>`;
                    break;
                case '├':
                    indentation_html += `<div class="indentcell-trunk"></div>`;
                    indentation_html += `<div class="indentcell-branch"></div>`;
                    break;
            }
            indentation_html += `</div>`;
        }

        rows_html += `
            <tr class="task-row" data-uuid="${item.uuid}">
                <td>
                    <div class="task">
                        <div class="task-indentation">${indentation_html}</div>
                        <div class="task-name">${item.name}</div>
                    </div>
                </td>
                <td><span class="process-type">${i18n('process_type_' + item.type)}</span></td>
                <td><span class="process-status">${i18n('process_status_' + item.status.i18n_key)}</span></td>
            </tr>
        `;

        const children = svc_process.get_children_of(item.uuid);
        if (children) {
            rows_html += generate_task_rows(children, {
                indent_level: indent_level + 1,
                is_last_item_stack: [ ...is_last_item_stack, is_last_item ],
            });
        }
    }
    
    return rows_html;
};

const UIWindowTaskManager = async function UIWindowTaskManager () {
    const svc_process = globalThis.services.get('process');

    const h = `
        <div class="task-manager-container">
            <table>
                <thead>
                    <tr>
                        <th>${i18n('taskmgr_header_name')}</th>
                        <th>${i18n('taskmgr_header_type')}</th>
                        <th>${i18n('taskmgr_header_status')}</th>
                    </tr>
                </thead>
                <tbody class="taskmgr-taskarea"></tbody>
            </table>
        </div>
    `;

    const el_window = await UIWindow({
        title: i18n('task_manager'),
        icon: globalThis.icons['cog.svg'],
        uid: null,
        is_dir: false,
        single_instance: true,
        app: 'taskmgr',
        is_resizable: true,
        is_droppable: false,
        has_head: true,
        selectable_body: true,
        draggable_body: false,
        allow_context_menu: false,
        show_in_taskbar: true,
        dominant: true,
        body_content: h,
        width: 350,
        window_class: 'window-task-manager',
        window_css:{
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            'background-color': '#F5F5F7',
            'backdrop-filter': 'blur(3px)',
            'box-sizing': 'border-box',
            height: 'calc(100% - 30px)',
            display: 'flex',
            'flex-direction': 'column',
            '--scale': '2pt',
            '--line-color': '#6e6e6ebd',
            padding: '20px',
        },
    });

    const update_tasks = () => {
        const processes = [svc_process.get_init()];
        const rows_html = generate_task_rows(processes, { indent_level: 0, is_last_item_stack: [] });
        $(el_window).find('.taskmgr-taskarea').html(rows_html);
    };

    // Set up context menu for task rows
    $(el_window).on('contextmenu', '.task-row', function(e) {
        e.preventDefault();
        const uuid = $(this).data('uuid');
        UIContextMenu({
            items: [
                {
                    html: i18n('close'),
                    onClick: () => {
                        end_process(uuid);
                    },
                },
                {
                    html: i18n('force_quit'),
                    onClick: () => {
                        end_process(uuid, true);
                    },
                },
            ],
        });
    });

    // Initial task update
    update_tasks();

    // Set up interval to refresh tasks
    const interval = setInterval(update_tasks, 500);

    // Clean up interval when window is closed
    $(el_window).on('close', () => {
        clearInterval(interval);
    });

    return el_window;
}

export default UIWindowTaskManager;
