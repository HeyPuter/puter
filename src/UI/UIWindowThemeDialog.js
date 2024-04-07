import UIWindow from "./UIWindow.js";

const UIWindowThemeDialog = async function UIWindowThemeDialog () {
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    const w = await UIWindow({
        title: null,
        icon: null,
        uid: null,
        is_dir: false,
        message: 'message',
        // body_icon: options.body_icon,
        // backdrop: options.backdrop ?? false,
        is_resizable: false,
        is_droppable: false,
        has_head: true,
        stay_on_top: true,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
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
            'background-color': 'rgba(231, 238, 245, .95)',
            'backdrop-filter': 'blur(3px)',
        }
    });
    const w_body = w.querySelector('.window-body');

    const Slider = ({ name, label, min, max, initial, step }) => {
        label = label ?? name;
        const wrap = document.createElement('div');
        const el = document.createElement('input');
        wrap.appendChild(el);
        el.type = 'range';
        el.min = min;
        el.max = max;
        el.defaultValue = initial ?? min;
        el.step = step ?? 1;
        el.classList.add('theme-dialog-slider');
        const label_el = document.createElement('label');
        label_el.textContent = label;
        wrap.appendChild(label_el);

        return {
            appendTo (parent) {
                parent.appendChild(wrap);
                return this;
            },
            onChange (cb) {
                el.addEventListener('input', e => {
                    e.meta = { name, label };
                    cb(e);
                });
                return this;
            },
        };
    };

    const state = {};

    const slider_ch = (e) => {
        state[e.meta.name] = e.target.value;
        svc_theme.apply(state);
    };

    Slider({
        name: 'hue', min: 0, max: 360,
        initial: svc_theme.get('hue'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        name: 'sat', min: 0, max: 100,
        initial: svc_theme.get('sat'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        name: 'lig', min: 0, max: 100,
        initial: svc_theme.get('lig'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        name: 'alpha', min: 0, max: 1, step: 0.01,
        initial: svc_theme.get('alpha'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;

    return {};
}

export default UIWindowThemeDialog;
