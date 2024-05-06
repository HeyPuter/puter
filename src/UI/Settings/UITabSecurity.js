import UIAlert from "../UIAlert.js";
import UIWindow2FASetup from "../UIWindow2FASetup.js";
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
            h += `<div class="settings-card settings-card-security ${user.otp ? 'settings-card-success' : 'settings-card-warning'}">`;
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

            const { promise } = await UIWindow2FASetup();
            const tfa_was_enabled = await promise;

            if ( tfa_was_enabled ) {
                $el_window.find('.enable-2fa').hide();
                $el_window.find('.disable-2fa').show();
                $el_window.find('.user-otp-state').text(i18n('two_factor_enabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-warning');
                $el_window.find('.settings-card-security').addClass('settings-card-success');
            }

            return;
        });

        $el_window.find('.disable-2fa').on('click', async function (e) {
            const confirmation = i18n('disable_2fa_confirm');
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
            $el_window.find('.settings-card-security').removeClass('settings-card-success');
            $el_window.find('.settings-card-security').addClass('settings-card-warning');
        });
    }
}