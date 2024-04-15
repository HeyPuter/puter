import UIWindow from "./UIWindow.js";

const UIWindowTaskManager = async function UIWindowTaskManager () {
    const svc_process = globalThis.services.get('process');

    const w = await UIWindow({
        title: i18n('task_manager'),
        icon: null,
        uid: null,
        is_dir: false,
        message: 'message',
        // body_icon: options.body_icon,
        // backdrop: options.backdrop ?? false,
        is_resizable: true,
        is_droppable: false,
        has_head: true,
        selectable_body: true,
        draggable_body: false,
        allow_context_menu: true,
        allow_native_ctxmenu: true,
        show_in_taskbar: true,
        window_class: 'window-alert',
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
            // 'background-color': `hsla(
            //     var(--primary-hue),
            //     calc(max(var(--primary-saturation) - 15%, 0%)),
            //     calc(min(100%,var(--primary-lightness) + 20%)), .91)`,
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'blur(3px)',
            
        }
    });
    const w_body = w.querySelector('.window-body');
    w_body.classList.add('taskmgr');

    const Indent = ({ has_trunk, has_branch }) => {
        const el = document.createElement('div');
        el.classList.add('taskmgr-indentcell');
        if ( has_trunk ) {
            // Add new child element
            const el_indentcell_child = document.createElement('div');
            el_indentcell_child.classList.add('taskmgr-indentcell-trunk');
            el.appendChild(el_indentcell_child);
        }
        if ( has_branch ) {
            const el_indentcell_child = document.createElement('div');
            el_indentcell_child.classList.add('taskmgr-indentcell-branch');
            el.appendChild(el_indentcell_child);
        }

        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            }
        };
    };

    const Task = ({ placement, name }) => {
        const {
            indent_level, last_item,
            parent_last_item,
        } = placement;

        const el = document.createElement('div');
        el.classList.add('taskmgr-task');

        for ( let i=0; i < indent_level; i++ ) {
            const last_cell = i === indent_level - 1;
            Indent({
                has_trunk: (last_cell && ( ! last_item )) ||
                    (!last_cell && !parent_last_item[i+1]),
                has_branch: last_cell
            }).appendTo(el);
        }

        const el_title = document.createElement('div');
        el_title.classList.add('taskmgr-task-title');
        el_title.innerText = name;
        el.appendChild(el_title);

        return {
            el () { return el; },
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            }
        };
    }

    // https://codepen.io/fomkin/pen/gOgoBVy
    const Table = ({ headings }) => {
        const el_table = $(`
            <table>
                <thead>
                    <tr>
                        ${headings.map(heading =>
                            `<th><span>${heading}<span></th>`).join('')}
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `)[0];

        const el_tbody = el_table.querySelector('tbody');

        return {
            el () { return el_table; },
            add (el) {
                if ( typeof el.el === 'function' ) el = el.el();
                el_tbody.appendChild(el);
                return this;
            },
            clear () {
                el_tbody.innerHTML = '';
            }
        };
    };

    const Row = () => {
        const el_tr = document.createElement('tr');
        return {
            attach (parent) {
                parent.appendChild(el_tr);
                return this;
            },
            el () { return el_tr; },
            add (el) {
                if ( typeof el.el === 'function' ) el = el.el();
                const el_td = document.createElement('td');
                el_td.appendChild(el);
                el_tr.appendChild(el_td);
                return this;
            }
        };
    };

    const el_taskarea = document.createElement('div');
    el_taskarea.classList.add('taskmgr-taskarea');

    const tasktable = Table({
        headings: ['Name', 'Type', 'Status']
    });

    el_taskarea.appendChild(tasktable.el());

    const iter_tasks = (items, { indent_level, parent_last_item }) => {
        for ( let i=0 ; i < items.length; i++ ) {
            const row = Row();
            const item = items[i];
            const last_item = i === items.length - 1;
            row.add(Task({
                placement: {
                    parent_last_item,
                    indent_level,
                    last_item,
                },
                name: item.name
            }));
            row.add($(`<span>${item.type}</span>`)[0])
            row.add($('<span>open</span>')[0])
            tasktable.add(row);

            const children = svc_process.get_children_of(item.uuid);
            if ( children ) {
                iter_tasks(children, {
                    indent_level: indent_level + 1,
                    parent_last_item:
                        [...parent_last_item, last_item],
                });
            }
        }
    };

    const interval = setInterval(() => {
        tasktable.clear();
        const processes = [svc_process.get_init()];
        iter_tasks(processes, { indent_level: 0, parent_last_item: [] });
    }, 500)

    w.on_close = () => {
        clearInterval(interval);
    }

    w_body.appendChild(el_taskarea);
}

export default UIWindowTaskManager;
