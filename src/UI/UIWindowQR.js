import UIWindow from './UIWindow.js'

async function UIWindowQR(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';
        // close button containing the multiplication sign
        h += `<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>`;
        h += `<div class="otp-qr-code">`;
            h += `<h1 style="text-align: center; font-size: 16px; padding: 10px; font-weight: 400; margin: -10px 10px 20px 10px; -webkit-font-smoothing: antialiased; color: #5f626d;">Scan the code below to log into this session from other devices</h1>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: 'Instant Login!',
            app: 'instant-login',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            draggable_body: false,
            has_head: false,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: false,
            allow_user_select: false,
            backdrop: true,
            width: 350,
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
            }    
        })

        // generate auth token QR code
        new QRCode($(el_window).find('.otp-qr-code').get(0), {
            text: window.gui_origin + '?auth_token=' + window.auth_token,
            width: 155,
            height: 155,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });        
    })
}

export default UIWindowQR