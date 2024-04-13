import UIWindow from "./UIWindow.js";

const UIWindowTaskManager = async function UIWindowTaskManager () {
    const sample_data = [
        {
            name: 'root',
            children: [
                {
                    name: 'terminal',
                    children: [
                        {
                            name: 'phoenix'
                        }
                    ],
                    children: [
                        {
                            name: 'ai-plugin'
                        }
                    ]
                },
                {
                    name: 'editor'
                }
            ]
        }
    ];

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
        stay_on_top: true,
        selectable_body: true,
        draggable_body: false,
        allow_context_menu: true,
        show_in_taskbar: false,
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
        const { indent_level, last_item } = placement;

        const el = document.createElement('div');
        el.classList.add('taskmgr-task');

        for ( let i=0; i < indent_level; i++ ) {
            const last_cell = i === indent_level - 1;
            console.log('last_cell', last_cell);
            console.log('last_item', last_item);
            Indent({
                has_trunk: (last_cell && ( ! last_item )) ||
                    ! last_cell,
                has_branch: last_cell
            }).appendTo(el);
        }

        const el_title = document.createElement('div');
        el_title.classList.add('taskmgr-task-title');
        el_title.innerText = name;
        el.appendChild(el_title);

        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            }
        };
    }

    const el_tasklist = document.createElement('div');
    el_tasklist.classList.add('taskmgr-tasklist');
    const iter_tasks = (items, { indent_level }) => {
        for ( let i=0 ; i < items.length; i++ ) {
            const item = items[i];
            Task({
                placement: {
                    indent_level,
                    last_item: i === items.length - 1,
                },
                name: item.name
            }).appendTo(el_tasklist);
            if ( item.children ) {
                iter_tasks(item.children, {
                    indent_level: indent_level + 1
                });
            }
        }
    };
    iter_tasks(sample_data, { indent_level: 0 });
    w_body.appendChild(el_tasklist);
}

export default UIWindowTaskManager;
