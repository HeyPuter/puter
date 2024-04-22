import UIWindow from "./UIWindow.js";
import UIWindowColorPicker from "./UIWindowColorPicker.js";

const UIWindowThemeDialog = async function UIWindowThemeDialog (options) {
    options = options ?? {};
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    const w = await UIWindow({
        title: i18n('ui_colors'),
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
            
        },
        ...options.window_options,
    });
    const w_body = w.querySelector('.window-body');

    const Button = ({ label }) => {
        const el = document.createElement('button');
        el.textContent = label;
        el.classList.add('button', 'button-block');
        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            },
            onPress (cb) {
                el.addEventListener('click', cb);
                return this;
            },
        };
    }

    const Slider = ({ name, label, min, max, initial, step }) => {
        label = label ?? name;
        const wrap = document.createElement('div');
        const label_el = document.createElement('label');
        label_el.textContent = label;
        label_el.style = "color:var(--primary-color)";
        wrap.appendChild(label_el);
        const el = document.createElement('input');
        wrap.appendChild(el);
        el.type = 'range';
        el.min = min;
        el.max = max;
        el.defaultValue = initial ?? min;
        el.step = step ?? 1;
        el.classList.add('theme-dialog-slider');
        

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
        if (e.meta.name === 'lig') {
            state.light_text = e.target.value < 60 ? true : false;
        }
        svc_theme.apply(state);
        console.log(state);
    };

    Button({ label: i18n('reset_colors') })
        .appendTo(w_body)
        .onPress(() => {
            svc_theme.reset();
        })
        ;

    Slider({
        label: i18n('hue'),
        name: 'hue', min: 0, max: 360,
        initial: svc_theme.get('hue'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        label: i18n('saturation'),
        name: 'sat', min: 0, max: 100,
        initial: svc_theme.get('sat'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        label: i18n('lightness'),
        name: 'lig', min: 0, max: 100,
        initial: svc_theme.get('lig'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;
    Slider({
        label: i18n('transparency'),
        name: 'alpha', min: 0, max: 1, step: 0.01,
        initial: svc_theme.get('alpha'),
    })
        .appendTo(w_body)
        .onChange(slider_ch)
        ;

    return {};
}

export default UIWindowThemeDialog;
