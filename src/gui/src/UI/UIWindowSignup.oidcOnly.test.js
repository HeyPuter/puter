// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const state = vi.hoisted(() => ({ el: null }));
vi.mock('./UIWindowLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowPhoneVerificationRequired.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowCardVerificationRequired.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/authLogoHeader.js', () => ({
    authLogoHeader: () => '',
    wireAuthLogoHeader: vi.fn(),
}));
vi.mock('../helpers/checkPasswordStrength.js', () => ({
    default: () => ({ overallPass: true }),
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
const { default: UIWindowSignup } = await import('./UIWindowSignup.js');

const providers = (body) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body)));
};
const find = (selector) => jQuery(state.el).find(selector);
const shown = (selector) => find(selector).css('display') !== 'none';

const open = async () => {
    void UIWindowSignup({ reload_on_success: false, redirect_url: '/' });
    await vi.waitFor(() => expect(find('.oidc-google-btn').css('display')).toBe('flex'));
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = vi.fn();
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.gui_params = {};
    window.icons = {};
    window.uuidv4 = () => 'oidc-only-test';
    window.is_email = () => true;
    window.embedded_in_popup = false;
    window.url_query_params = new URLSearchParams('');
    state.el = null;
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('signup window when only OIDC signups are open', () => {
    it('offers the email form behind a button normally', async () => {
        providers({ providers: ['google'], signupOidcOnly: false });
        await open();

        expect(shown('.signup-with-email-wrapper')).toBe(true);
        expect(shown('.signup-oidc-only-notice')).toBe(false);
    });

    it('drops the email form and says why', async () => {
        providers({ providers: ['google'], signupOidcOnly: true });
        await open();

        await vi.waitFor(() => expect(shown('.signup-oidc-only-notice')).toBe(true));
        expect(shown('.signup-form')).toBe(false);
        expect(shown('.signup-with-email-wrapper')).toBe(false);
    });

    it('switches to the providers when a form signup is refused for it', async () => {
        providers({ providers: ['google'], signupOidcOnly: false });
        await open();
        jQuery.ajax = vi.fn((opts) =>
            opts.error({
                responseText: JSON.stringify({
                    code: 'signup_oidc_only',
                    message: 'closed',
                }),
            }));

        find('.signup-with-email-btn').trigger('click');
        find('.username').val('someone');
        find('.email').val('someone@example.com');
        find('.password').val('a-Strong-pass-1');
        find('.confirm-password').val('a-Strong-pass-1');
        find('.signup-btn').trigger('click');

        await vi.waitFor(() => expect(shown('.signup-oidc-only-notice')).toBe(true));
        expect(shown('.signup-form')).toBe(false);
        expect(shown('.signup-with-email-wrapper')).toBe(false);
    });
});
