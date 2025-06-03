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
import { Component, defineComponent } from '../util/Component.js';
import UIComponentWindow from './UIComponentWindow.js';

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

class TaskManagerTable extends Component {
    static ID = 'ui.component.TaskManagerTable';
    static PROPERTIES = {
        tasks: { value: [] },
    };

    static CSS = /*css*/`
        :host {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            background-color: rgba(255,255,255,0.8);
            border: 2px inset rgba(127, 127, 127, 0.3);
            overflow: auto;
        }

        table {
            box-sizing: border-box;
            border-collapse: collapse;
            width: 100%;
        }
        
        thead th {
            box-shadow: 0 1px 4px -2px rgba(0,0,0,0.2);
            backdrop-filter: blur(2px);
            position: sticky;
            z-index: 100;
            padding:
                calc(10 * var(--scale))
                calc(2.5 * var(--scale))
                calc(5 * var(--scale))
                calc(2.5 * var(--scale));
            top: 0;
            background-color: hsla(0, 0%, 100%, 0.8);
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }
        
        thead th:not(:last-of-type) {
            border-right: 1px solid #e0e0e0;
        }
        
        tbody > tr > td {
            border-bottom: 1px solid #e0e0e0;
            padding: 0 calc(2.5 * var(--scale));
            vertical-align: middle;
        }
    `;

    #svc_process = globalThis.services.get('process');

    create_template ({ template }) {
        $(template).html(`
            <table>
                <thead>
                    <tr>
                        <th>${i18n('taskmgr_header_name')}</th>
                        <th>${i18n('taskmgr_header_type')}</th>
                        <th>${i18n('taskmgr_header_status')}</th>
                    </tr>
                </thead>
                <tbody class="taskmgr-taskarea">
                </tbody>
            </table>
        `);
    }

    on_ready ({ listen }) {
        listen('tasks', tasks => {
            const row_data = this.#iter_tasks(tasks, { indent_level: 0, is_last_item_stack: [] });
            const tbody = $(this.dom_).find('.taskmgr-taskarea');
            tbody.empty();

            for (const data of row_data) {
                const row = new TaskManagerRow(data);
                row.attach(tbody[0]);
            }
        });
    }

    #calculate_indent_string (indent_level, is_last_item_stack, is_last_item) {
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
    }

    #iter_tasks (items, { indent_level, is_last_item_stack }) {
        const rows = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const is_last_item = i === items.length - 1;
            rows.push({
                name: item.name,
                uuid: item.uuid,
                process_type: item.type,
                process_status: item.status.i18n_key,
                indentation: this.#calculate_indent_string(indent_level, is_last_item_stack, is_last_item),
            });

            const children = this.#svc_process.get_children_of(item.uuid);
            if (children) {
                rows.push(...this.#iter_tasks(children, {
                    indent_level: indent_level + 1,
                    is_last_item_stack:
                        [ ...is_last_item_stack, is_last_item ],
                }));
            }
        }
        return rows;
    };
}
defineComponent(TaskManagerTable);

class TaskManagerRow extends Component {
    static ID = 'ui.component.TaskManagerRow';

    static PROPERTIES = {
        name: {},
        uuid: {},
        process_type: {},
        process_status: {},
        indentation: { value: '' },
    };

    static CSS = /*css*/`
        :host {
            display: table-row;
        }

        td > span {
            padding: 0 calc(2.5 * var(--scale));
        }
        
        .task {
            display: flex;
            height: calc(10 * var(--scale));
            line-height: calc(10 * var(--scale));
        }
        
        .task-name {
            flex-grow: 1;
            padding-left: calc(2.5 * var(--scale));
        }
        
        .task-indentation {
            display: flex;
        }
        
        .indentcell {
            position: relative;
            align-items: right;
            width: calc(10 * var(--scale));
            height: calc(10 * var(--scale));
        }
        
        .indentcell-trunk {
            position: absolute;
            top: 0;
            left: calc(5 * var(--scale));
            width: calc(5 * var(--scale));
            height: calc(10 * var(--scale));
            border-left: 2px solid var(--line-color);
        }
        
        .indentcell-branch {
            position: absolute;
            top: 0;
            left: calc(5 * var(--scale));
            width: calc(5 * var(--scale));
            height: calc(5 * var(--scale));
            border-left: 2px solid var(--line-color);
            border-bottom: 2px solid var(--line-color);
            border-radius: 0 0 0 calc(2.5 * var(--scale));
        }
    `;

    create_template ({ template }) {
        template.innerHTML = `
            <td>
                <div class="task">
                    <div class="task-indentation"></div>
                    <div class="task-name"></div>
                </div>
            </td>
            <td><span class="process-type"></span></td>
            <td><span class="process-status"></span></td>
        `;
    }

    on_ready ({ listen }) {
        listen('name', name => {
            $(this.dom_).find('.task-name').text(name);
        });
        listen('uuid', uuid => {
            this.setAttribute('data-uuid', uuid);
        });
        listen('process_type', type => {
            $(this.dom_).find('.process-type').text(i18n('process_type_' + type));
        });
        listen('process_status', status => {
            $(this.dom_).find('.process-status').text(i18n('process_status_' + status));
        });
        listen('indentation', indentation => {
            const el = $(this.dom_).find('.task-indentation');
            let h = '';
            for (const c of indentation) {
                h += `<div class="indentcell">`;
                switch (c) {
                    case ' ':
                        break;
                    case '|':
                        h += `<div class="indentcell-trunk"></div>`;
                        break;
                    case '└':
                        h += `<div class="indentcell-branch"></div>`;
                        break;
                    case '├':
                        h += `<div class="indentcell-trunk"></div>`;
                        h += `<div class="indentcell-branch"></div>`;
                        break;
                }
                h += `</div>`;
            }
            el.html(h);
        });

        $(this).on('contextmenu', () => {
            const uuid = this.get('uuid');
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
    }
}
defineComponent(TaskManagerRow);

const UIWindowTaskManager = async function UIWindowTaskManager () {
    const svc_process = globalThis.services.get('process');

    let task_manager_table = new TaskManagerTable({
        tasks: [svc_process.get_init()],
    });

    const interval = setInterval(() => {
        const processes = [svc_process.get_init()];
        task_manager_table.set('tasks', processes);
    }, 500);

    const w = await UIComponentWindow({
        component: task_manager_table,
        window_class: 'window-task-manager',
        title: i18n('task_manager'),
        icon: globalThis.icons['cog.svg'],
        uid: null,
        is_dir: false,
        message: 'message',
        single_instance: true,
        app: 'taskmgr',
        // body_icon: options.body_icon,
        // backdrop: options.backdrop ?? false,
        is_resizable: true,
        is_droppable: false,
        has_head: true,
        selectable_body: true,
        draggable_body: false,
        allow_context_menu: false,
        // allow_native_ctxmenu: true,
        show_in_taskbar: true,
        dominant: true,
        body_content: '',
        width: 350,
        // parent_uuid: options.parent_uuid,
        // ...options.window_options,
        window_css:{
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '20px',
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'blur(3px)',
            'box-sizing': 'border-box',
            // could have been avoided with box-sizing: border-box
            height: 'calc(100% - 30px)',
            display: 'flex',
            'flex-direction': 'column',
            '--scale': '2pt',
            '--line-color': '#6e6e6ebd',
        },
        on_close: () => {
            clearInterval(interval);
        },
    });
}

export default UIWindowTaskManager;
