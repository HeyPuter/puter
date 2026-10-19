// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const state = vi.hoisted(() => ({ el: null, password: 'password' }));

vi.mock('../UIWindow.js', () => ({ default: async options => {
    const el = document.createElement('div');
    el.innerHTML = options.body_content;
    document.body.append(el);
    options.onAppend?.(el);
    state.el = el;
    return el;
} }));
vi.mock('../Components/PasswordEntry.js', () => ({ default: class {
    get () { return state.password; }
    attach () {}
} }));
vi.mock('../../util/Placeholder.js', () => ({ default: () => ({ html: '' }) }));
vi.mock('../../util/openid.js', () => ({ openRevalidatePopup: vi.fn(async () => {}) }));

const { default: UIWindowChangeEmail } = await import('./UIWindowChangeEmail.js');
const { openRevalidatePopup } = await import('../../util/openid.js');
const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });
const submit = () => jQuery(state.el).find('.change-email-btn').triggerHandler('click');
const bodyOf = index => JSON.parse(fetch.mock.calls[index][1].body);

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
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
    await UIWindowChangeEmail();
    jQuery(state.el).find('.new-email').val('changed@example.com');
};

describe('email change authenticator input', () => {
    it('shows the enabled account code field and preserves leading zeroes', async () => {
        await open({ otp: true });
        expect(jQuery(state.el).find('.change-email-otp-wrap')[0].style.display).not.toBe('none');
        jQuery(state.el).find('.change-email-code').val('000123');
        fetch.mockResolvedValue(reply(200));
        await submit();
        expect(bodyOf(0)).toEqual({ new_email: 'changed@example.com', password: 'password', code: '000123' });
    });

    it('keeps the code field hidden for accounts without 2FA', async () => {
        await open({ otp: false });
        expect(jQuery(state.el).find('.change-email-otp-wrap')[0].style.display).toBe('none');
        fetch.mockResolvedValue(reply(200));
        await submit();
        expect(bodyOf(0)).not.toHaveProperty('code');
    });

    it('reveals the field when the server reports a second-factor requirement', async () => {
        await open({ otp: false });
        fetch.mockResolvedValueOnce(reply(400, { factor: 'otp', code: 'bad_request', message: 'Enter your code' }));
        await submit();
        expect(jQuery(state.el).find('.change-email-otp-wrap')[0].style.display).not.toBe('none');
        expect(jQuery(state.el).find('.new-email').prop('disabled')).toBe(false);
        jQuery(state.el).find('.change-email-code').val('000123');
        fetch.mockResolvedValueOnce(reply(401, { factor: 'otp', code: 'code_mismatch', message: 'Incorrect code' }));
        await submit();
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])('includes the code after OIDC revalidation (cached OIDC-only state: %s)', async oidcOnly => {
        await open({ otp: true, oidc_only: oidcOnly, oidc_revalidate_url: 'https://puter.test/revalidate' });
        jQuery(state.el).find('.change-email-code').val('000123');
        if (oidcOnly) state.password = '';
        else fetch.mockResolvedValueOnce(reply(403, { code: 'oidc_revalidation_required', revalidate_url: 'https://puter.test/revalidate' }));
        fetch.mockResolvedValueOnce(reply(200));
        await submit();
        expect(openRevalidatePopup).toHaveBeenCalledOnce();
        expect(bodyOf(oidcOnly ? 0 : 1)).toEqual({ new_email: 'changed@example.com', code: '000123' });
    });
});
