import UIWindowQR from "../UIWindowQR.js";

export default {
    id: 'security',
    title_i18n_key: 'security',
    icon: 'shield.svg',
    html: () => {
        let h = `<h1>${i18n('security')}</h1>`;

        // change password button
        if(!user.is_temp){
            h += `<div class="settings-card">`;
                h += `<strong>${i18n('password')}</strong>`;
                h += `<div style="flex-grow:1;">`;
                    h += `<button class="button change-password" style="float:right;">${i18n('change_password')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }

        // session manager
        h += `<div class="settings-card">`;
            h += `<strong>${i18n('sessions')}</strong>`;
            h += `<div style="flex-grow:1;">`;
                h += `<button class="button manage-sessions" style="float:right;">${i18n('manage_sessions')}</button>`;
            h += `</div>`;
        h += `</div>`;

        // configure 2FA
        if(!user.is_temp){
            h += `<div class="settings-card">`;
                h += `<div>`;
                    h += `<strong style="display:block;">${i18n('two_factor')}</strong>`;
                    h += `<span class="user-otp-state" style="display:block; margin-top:5px;">${
                        i18n(user.otp ? 'two_factor_enabled' : 'two_factor_disabled')
                    }</span>`;
                h += `</div>`;
                h += `<div style="flex-grow:1;">`;
                    h += `<button class="button enable-2fa" style="float:right;${user.otp ? 'display:none;' : ''}">${i18n('enable_2fa')}</button>`;
                    h += `<button class="button disable-2fa" style="float:right;${user.otp ? '' : 'display:none;'}">${i18n('disable_2fa')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }


        return h;
    },
    init: ($el_window) => {
        $el_window.find('.enable-2fa').on('click', async function (e) {
            const resp = await fetch(`${api_origin}/auth/configure-2fa/setup`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await resp.json();

            const confirmation = await UIWindowQR({
                message_i18n_key: 'scan_qr_2fa',
                text: data.url,
                text_below: data.secret,
                confirmations: [
                    i18n('confirm_2fa_setup'),
                    i18n('confirm_2fa_recovery'),
                ],
                recovery_codes: data.codes,
                has_confirm_and_cancel: true,
            });

            if ( ! confirmation ) return;

            await fetch(`${api_origin}/auth/configure-2fa/enable`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            $el_window.find('.enable-2fa').hide();
            $el_window.find('.disable-2fa').show();
            $el_window.find('.user-otp-state').text(i18n('two_factor_enabled'));
        });

        $el_window.find('.disable-2fa').on('click', async function (e) {
            const resp = await fetch(`${api_origin}/auth/configure-2fa/disable`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            $el_window.find('.enable-2fa').show();
            $el_window.find('.disable-2fa').hide();
            $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
        });
    }
}