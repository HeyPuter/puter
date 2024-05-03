import UIWindow from './UIWindow.js'
import Placeholder from "../util/Placeholder.js"

/**
 * @typedef {Object} UIComponentWindowOptions
 * @property {Component} A component to render in the window
 */

/**
 * Render a UIWindow that contains an instance of Component
 * @param {UIComponentWindowOptions} options
 */
export default async function UIComponentWindow (options) {
    const placeholder = Placeholder();

    await UIWindow({
        title: 'Instant Login!',
        app: 'instant-login',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: placeholder.html,
        has_head: false,
        selectable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        backdrop: true,
        width: 550,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        draggable_body: true,
        onAppend: function(this_window){
        },
        window_class: 'window-qr',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
            padding: '20px',
        },
    })

    options.component.attach(placeholder);
}
