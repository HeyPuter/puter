// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const state = vi.hoisted(() => ({ el: null, options: null, result: null, password: 'password' }));

vi.mock('../UIWindow.js', () => ({ default: async options => {
    const el = document.createElement('div');
    el.innerHTML = options.body_content;
    document.body.append(el);
    options.onAppend?.(el);
    state.el = el;
    state.options = options;
    return el;
} }));
vi.mock('../Components/PasswordEntry.js', () => ({ default: class {
    get () { return state.password; }
    attach () {}
} }));
vi.mock('../../util/Placeholder.js', () => ({ default: () => ({ html: '' }) }));
vi.mock('../../util/openid.js', () => ({ openRevalidatePopup: vi.fn(async () => {}) }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindowDisable2FA } = await import('./UIWindowDisable2FA.js');
const { openRevalidatePopup } = await import('../../util/openid.js');
const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });
const submit = () => jQuery(state.el).find('.disable-2fa-btn').triggerHandler('click');
const bodyOf = index => JSON.parse(fetch.mock.calls[index][1].body);

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = vi.fn();
    globalThis.i18n = key => key;
    globalThis.html_encode = value => jQuery('<div>').text(value).html();
    globalThis.fetch = vi.fn();
    window.uuidv4 = () => 'test-id';
    window.gui_origin = 'https://puter.test';
    window.auth_token = 'session-token';
    window.handleReauthRequired = vi.fn();
    state.password = 'password';
    openRevalidatePopup.mockClear();
});

const open = async user => {
    window.user = user;
    state.result = await UIWindowDisable2FA();
};

describe('disabling 2FA', () => {
    it('sends the authenticator code and resolves success only after acceptance', async () => {
        await open({ otp: true });
        jQuery(state.el).find('.disable-2fa-code').val('000123');
        fetch.mockResolvedValue(reply(200));
        await submit();
        expect(bodyOf(0)).toEqual({ password: 'password', code: '000123' });
        expect(window.user.otp).toBe(false);
        await expect(Promise.resolve(state.result.promise)).resolves.toBe(true);
    });

    it('trims and uppercases a pasted recovery code', async () => {
        await open({ otp: true });
        jQuery(state.el).find('.disable-2fa-code').val(' abcd2345\n');
        fetch.mockResolvedValue(reply(200));
        await submit();
        expect(bodyOf(0)).toEqual({ password: 'password', code: 'ABCD2345' });
    });

    it.each([400, 401])('leaves 2FA enabled and permits retry after a code rejection (%s)', async status => {
        await open({ otp: true });
        jQuery(state.el).find('.disable-2fa-code').val('000123');
        fetch.mockResolvedValue(reply(status, { factor: 'otp', code: status === 401 ? 'code_mismatch' : 'bad_request', message: 'Enter your code' }));
        await submit();
        expect(window.user.otp).toBe(true);
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
        expect(jQuery.fn.close).not.toHaveBeenCalled();
        expect(jQuery(state.el).find('.disable-2fa-btn').hasClass('disabled')).toBe(false);
    });

    it.each([true, false])('retains the code after OIDC revalidation (cached OIDC-only state: %s)', async oidcOnly => {
        await open({ otp: true, oidc_only: oidcOnly, oidc_revalidate_url: 'https://puter.test/revalidate' });
        jQuery(state.el).find('.disable-2fa-code').val('000123');
        if (oidcOnly) state.password = '';
        else fetch.mockResolvedValueOnce(reply(403, { code: 'oidc_revalidation_required', revalidate_url: 'https://puter.test/revalidate' }));
        fetch.mockResolvedValueOnce(reply(200));
        await submit();
        expect(openRevalidatePopup).toHaveBeenCalledOnce();
        expect(bodyOf(oidcOnly ? 0 : 1)).toEqual({ code: '000123' });
    });

    it('retains the code when renewing a missing session cookie', async () => {
        await open({ otp: true });
        jQuery(state.el).find('.disable-2fa-code').val('000123');
        fetch.mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(200))
            .mockResolvedValueOnce(reply(200));
        await submit();
        expect(String(fetch.mock.calls[1][0])).toContain('/session/sync-cookie');
        expect(bodyOf(2)).toEqual(bodyOf(0));
        expect(bodyOf(2).code).toBe('000123');
    });

    it('resolves cancellation without changing the account state', async () => {
        await open({ otp: true });
        await state.options.on_before_exit();
        await expect(Promise.resolve(state.result.promise)).resolves.toBe(false);
        expect(window.user.otp).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });
});
