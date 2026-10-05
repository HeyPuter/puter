import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { encode } from 'html-entities';
import { loadLocale } from './i18n/embedI18n.js';
import { createAppBrowser } from './UI/Dashboard/AppBrowser.js';
import { appTileLink } from './UI/Dashboard/appLink.js';
import { installAppIconFallback } from './helpers/appIcon.js';

window.$ = window.jQuery = jQuery;
window.html_encode = value => encode(String(value ?? ''), { mode: 'nonAsciiPrintable' });
window.icons = {
    'app.svg': new URL('./icons/app.svg', import.meta.url).href,
    'app-default.svg': new URL('./icons/app-default.svg', import.meta.url).href,
};

const root = document.querySelector('#app-browser');
const config = JSON.parse(document.querySelector('#app-browser-config').textContent);
window.api_origin = config.apiOrigin;
window.PUTER_API_ORIGIN = config.apiOrigin;
window.PUTER_GUI_ORIGIN = window.location.origin;
window.gui_origin = window.location.origin;
window.puter_gui_enabled = true;
window.puter_socket_enabled = false;
window.locale = 'en';
try {
    window.locale = JSON.parse(localStorage.getItem('user_preferences') || '{}')?.language || 'en';
} catch { /* Corrupt preferences must not prevent loading apps. */ }
const localeReady = loadLocale(window.locale);

async function mount () {
    window.auth_token = localStorage.getItem('auth_token_v2');
    if ( ! window.auth_token ) throw new Error('Missing session');

    await Promise.all([new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = config.sdkUrl;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    }), localeReady]);
    puter.setAPIOrigin(config.apiOrigin);
    installAppIconFallback();

    const browser = createAppBrowser({
        editable: false,
        onLaunch: app => {
            const href = appTileLink(app, window.location.origin);
            if ( href ) window.open(href, '_blank', 'noopener,noreferrer');
        },
    });
    const $root = $(root);
    $root.html(`<section class="dashboard-section dashboard-section-apps active">${browser.html()}</section>`);
    browser.init($root);
}

mount().catch(async () => {
    await localeReady;
    root.innerHTML = `<p class="myapps-empty" role="status">${i18n('app_browser_unavailable')}</p>`;
});
