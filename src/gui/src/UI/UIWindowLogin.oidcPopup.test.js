// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const state = vi.hoisted(() => ({ el: null }));
vi.mock('./UIWindowRecoverPassword.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowPhoneVerificationRequired.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowCardVerificationRequired.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/authLogoHeader.js', () => ({
    authLogoHeader: () => '',
    wireAuthLogoHeader: vi.fn(),
}));
vi.mock('./UIWindow.js', () => ({
    default: async (options) => {
        state.el = document.createElement('div');
        state.el.innerHTML = options.body_content;
        document.body.append(state.el);
        options.onAppend?.(state.el);
        return state.el;
    },
}));
globalThis.def = globalThis.def ?? ((value) => value);
const { default: UIWindowLogin } = await import('./UIWindowLogin.js');
const { default: UIWindowSignup } = await import('./UIWindowSignup.js');

const PROVIDERS_URL = 'https://api.puter.test/auth/oidc/providers';
const RELAY_POPUP =
    'embedded_in_popup=true&msg_id=1&cross_origin_isolated=true&signin_session=s';
const PLAIN_POPUP = 'embedded_in_popup=true&msg_id=1';

const asPopup = (query) => {
    window.embedded_in_popup = true;
    window.gui_action = 'sign-in';
    window.url_query_params = new URLSearchParams(query);
};

const askedForProviders = () =>
    fetch.mock.calls.some(([url]) => url === PROVIDERS_URL);

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = vi.fn();
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
    globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ providers: ['google'] })),
    );
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.gui_params = { turnstileSiteKey: 'site-key' };
    window.turnstile = { render: vi.fn() };
    window.icons = {};
    window.uuidv4 = () => 'oidc-popup-test';
    window.embedded_in_popup = false;
    window.gui_action = undefined;
    window.url_query_params = new URLSearchParams('');
    state.el = null;
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe.each([
    [
        'login',
        () => UIWindowLogin({ reload_on_success: false, redirect_url: '/' }),
        '.login-btn',
    ],
    [
        'signup',
        () => UIWindowSignup({ reload_on_success: false, redirect_url: '/' }),
        '.signup-btn',
    ],
])('OIDC buttons in the %s window', (_name, open, formButton) => {
    const rendered = async () => {
        void open();
        await vi.waitFor(() =>
            expect(jQuery(state.el).find(formButton)).toHaveLength(1),
        );
    };

    // The provider's return drops the relay that hands the token to an
    // isolated opener, so only password sign-in can finish there.
    it('hides them in a cross-origin-isolated relay popup', async () => {
        asPopup(RELAY_POPUP);
        await rendered();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(askedForProviders()).toBe(false);
        expect(jQuery(state.el).find('.oidc-google-btn').css('display')).toBe(
            'none',
        );
    });

    it('keeps them in a regular sign-in popup', async () => {
        asPopup(PLAIN_POPUP);
        await rendered();

        await vi.waitFor(() =>
            expect(
                jQuery(state.el).find('.oidc-google-btn').css('display'),
            ).toBe('flex'),
        );
    });

    it('keeps them outside a popup', async () => {
        await rendered();

        await vi.waitFor(() =>
            expect(
                jQuery(state.el).find('.oidc-google-btn').css('display'),
            ).toBe('flex'),
        );
        expect(askedForProviders()).toBe(true);
    });
});
