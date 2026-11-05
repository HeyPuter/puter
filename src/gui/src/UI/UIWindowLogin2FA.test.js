// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const state = vi.hoisted(() => ({ el: null, options: null }));
vi.mock('./UIWindowRecoverPassword.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowSignup.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/authLogoHeader.js', () => ({ authLogoHeader: () => '', wireAuthLogoHeader: vi.fn() }));
vi.mock('./UIWindow.js', () => ({ default: async options => {
    state.options = options;
    state.el = document.createElement('div');
    state.el.innerHTML = options.body_content;
    document.body.append(state.el);
    options.onAppend?.(state.el);
    return state.el;
} }));
globalThis.def = globalThis.def ?? (value => value);
const { default: UIWindowLogin2FA } = await import('./UIWindowLogin2FA.js');
const { default: UIWindowLogin } = await import('./UIWindowLogin.js');
const reply = (status, data) => new Response(JSON.stringify(data), { status });
const completed = { proceed: true, next_step: 'complete', token: 'gui-token', user: { username: 'user' }, redirectUrl: 'https://puter.test/dashboard' };

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = vi.fn(function () { state.options.on_close?.(); });
    globalThis.i18n = key => key;
    globalThis.html_encode = value => jQuery('<div>').text(value).html();
    globalThis.fetch = vi.fn();
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.icons = {};
    window.uuidv4 = () => 'login-test';
    window.is_email = () => false;
    window.update_auth_data = vi.fn();
    state.el = null;
});
afterEach(() => { vi.restoreAllMocks(); });

const open = async () => {
    const result = UIWindowLogin2FA('first-factor-challenge');
    await vi.waitFor(() => expect(jQuery(state.el).find('.login-2fa-code-inputs input')).toHaveLength(6));
    return { result };
};
const enterOtp = code => {
    const inputs = jQuery(state.el).find('.login-2fa-code-inputs input');
    [...code].forEach((digit, index) => inputs.eq(index).val(digit));
    inputs.last().trigger('input');
};

describe('shared login second-factor dialog', () => {
    it('passes leading-zero codes to the existing verifier and preserves continuation data', async () => {
        fetch.mockResolvedValue(reply(200, completed));
        const { result } = await open();
        enterOtp('001234');
        await expect(result).resolves.toEqual(completed);
        expect(fetch).toHaveBeenCalledWith('https://puter.test/login/otp', expect.objectContaining({ body: JSON.stringify({ token: 'first-factor-challenge', code: '001234' }) }));
        expect(jQuery.fn.close).toHaveBeenCalledOnce();
    });

    it('keeps failed challenges available for a recovery-code retry', async () => {
        fetch.mockResolvedValueOnce(reply(200, { proceed: false })).mockResolvedValueOnce(reply(200, completed));
        const { result } = await open();
        enterOtp('001234');
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-2fa-error').text()).toBe('confirm_code_generic_incorrect'));
        expect(jQuery.fn.close).not.toHaveBeenCalled();
        jQuery(state.el).find('.login-2fa-to-recovery').trigger('click');
        jQuery(state.el).find('.login-2fa-recovery-input').val(' abcdefg2\n').trigger('input');
        await expect(result).resolves.toEqual(completed);
        expect(fetch.mock.calls[1][0]).toBe('https://puter.test/login/recovery-code');
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token: 'first-factor-challenge', code: 'ABCDEFG2' });
    });

    it('reports throttling without closing or completing login', async () => {
        fetch.mockResolvedValue(reply(429, {}));
        const { result } = await open();
        enterOtp('001234');
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-2fa-error').text()).toBe('confirm_code_generic_too_many_requests'));
        expect(jQuery.fn.close).not.toHaveBeenCalled();
        state.options.on_close();
        await expect(result).resolves.toBeNull();
    });

    it('closing the challenge cancels without authenticating', async () => {
        const { result } = await open();
        state.options.on_close();
        await expect(result).resolves.toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('ignores incomplete recovery codes', async () => {
        const { result } = await open();
        jQuery(state.el).find('.login-2fa-recovery-input').val('ABC').trigger('input');
        expect(fetch).not.toHaveBeenCalled();
        state.options.on_close();
        await expect(result).resolves.toBeNull();
    });
});


describe('password login using the shared second-factor dialog', () => {
    it('completes password login only after its challenge succeeds', async () => {
        fetch.mockResolvedValueOnce(reply(200, { providers: [] })).mockResolvedValueOnce(reply(200, completed));
        let success;
        vi.spyOn(jQuery, 'ajax').mockImplementation(options => { success = options.success; });
        const result = UIWindowLogin({ reload_on_success: false, redirect_url: '/' });
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-btn')).toHaveLength(1));
        const login = state.el;
        jQuery(login).find('.email_or_username').val('user');
        jQuery(login).find('.password').val('correct-password');
        jQuery(login).find('.login-btn').trigger('click');
        expect(success).toBeTypeOf('function');
        const submitted = success({ proceed: true, next_step: 'otp', otp_jwt_token: 'password-challenge' });
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-2fa-code-inputs input')).toHaveLength(6));
        expect(window.update_auth_data).not.toHaveBeenCalled();
        enterOtp('001234');
        await submitted;
        await expect(result).resolves.toBe(true);
        expect(window.update_auth_data).toHaveBeenCalledWith(completed.token, completed.user);
        expect(JSON.parse(fetch.mock.calls[1][1].body).token).toBe('password-challenge');
    });

    it('returns to the enabled password form when the second-factor dialog is dismissed', async () => {
        fetch.mockResolvedValue(reply(200, { providers: [] }));
        let success;
        vi.spyOn(jQuery, 'ajax').mockImplementation(options => { success = options.success; });
        const result = UIWindowLogin({ reload_on_success: false, redirect_url: '/' });
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-btn')).toHaveLength(1));
        const login = state.el;
        const loginOptions = state.options;
        jQuery(login).find('.email_or_username').val('user');
        jQuery(login).find('.password').val('correct-password');
        jQuery(login).find('.login-btn').trigger('click');
        const submitted = success({ proceed: true, next_step: 'otp', otp_jwt_token: 'password-challenge' });
        await vi.waitFor(() => expect(jQuery(state.el).find('.login-2fa-code-inputs input')).toHaveLength(6));
        state.options.on_close();
        await submitted;
        expect(window.update_auth_data).not.toHaveBeenCalled();
        expect(jQuery(login).find('.login-btn').prop('disabled')).toBe(false);
        loginOptions.on_close();
        await expect(result).resolves.toBe(false);
    });
});
