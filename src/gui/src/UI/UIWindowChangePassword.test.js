import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ el: null }));

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        state.el = { body: opts.body_content, opts };
        return state.el;
    }),
}));

vi.mock('../helpers/checkPasswordStrength.js', () => ({
    default: vi.fn((pw) => ({ overallPass: pw !== 'weak' })),
}));

vi.mock('../util/openid.js', () => ({
    openRevalidatePopup: vi.fn(async () => {}),
}));

globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value);

/** Minimal jQuery stand-in: a selector -> value map drives the handler. */
const fields = {};
let clickHandler = null;
const node = (sel) => {
    const self = {
        val: (v) => {
            if ( v === undefined ) return fields[sel];
            fields[sel] = v;
            return self;
        },
        on: (evt, fn) => {
            if ( evt === 'click' && sel === '.change-password-btn' ) clickHandler = fn;
            return self;
        },
        html: () => self,
        text: () => self,
        show: () => self,
        hide: () => self,
        fadeIn: () => self,
        addClass: () => self,
        removeClass: () => self,
        attr: () => self,
        get: () => undefined,
    };
    return self;
};
globalThis.$ = () => ({ find: node, close: () => {} });

const { default: UIWindowChangePassword } = await import('./UIWindowChangePassword.js');

const open = async (user) => {
    globalThis.window.user = user;
    UIWindowChangePassword({});
    await new Promise((r) => setTimeout(r));
};

const rejected401 = (code) => ({
    ok: false,
    status: 401,
    clone: () => ({ json: async () => ({ code, message: 'Missing authentication token' }) }),
    json: async () => ({ code, message: 'Missing authentication token' }),
});

const bodyOf = (call) => JSON.parse(call[1].body);

describe('the change-password window', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn();
        globalThis.window = {
            uuidv4: () => 'test-id',
            gui_origin: 'https://puter.test',
            auth_token: 'tok-1',
            handleReauthRequired: vi.fn(),
        };
        clickHandler = null;
        fields['.current-password'] = '';
        fields['.new-password'] = 'ChosenPass1!';
        fields['.confirm-new-password'] = 'ChosenPass1!';
    });

    // The route is cookie-gated and the GUI sends no Authorization header, so
    // a session cookie that went missing mid-session reads as a plain 401.
    it('mints the session cookie and retries when the submit 401s', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(rejected401('token_missing'))
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        await open({ oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' });
        await clickHandler();

        const urls = globalThis.fetch.mock.calls.map(([u]) => String(u));
        expect(urls[1]).toContain('/session/sync-cookie');
        expect(urls[2]).toContain('/user-protected/change-password');
        expect(globalThis.window.handleReauthRequired).not.toHaveBeenCalled();
    });

    it('prompts sign-in when the cookie cannot be minted', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(rejected401('token_missing'))
            .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

        await open({ oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' });
        await clickHandler();

        expect(globalThis.window.handleReauthRequired).toHaveBeenCalled();
    });

    // `oidc_only` on the cached user row can lag the account's real state, so
    // the server-driven revalidation retry has to carry the new password too.
    it('resends the new password on the revalidation retry', async () => {
        fields['.current-password'] = 'OldPass1!';
        globalThis.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({
                    code: 'oidc_revalidation_required',
                    revalidate_url: 'https://puter.test/revalidate',
                }),
            })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        await open({ oidc_only: false });
        await clickHandler();

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(bodyOf(globalThis.fetch.mock.calls[1])).toEqual({ new_pass: 'ChosenPass1!' });
    });
});
