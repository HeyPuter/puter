import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ el: null }));

vi.mock('../UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        state.el = { body: opts.body_content, opts };
        return state.el;
    }),
}));

vi.mock('../../util/openid.js', () => ({
    openRevalidatePopup: vi.fn(async () => {}),
}));

globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value);

const fields = {};
let clickHandler = null;
const node = (sel) => {
    const self = {
        val: () => fields[sel],
        on: (evt, fn) => {
            if ( evt === 'click' && sel === '.proceed-with-user-deletion' ) clickHandler = fn;
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
    };
    return self;
};
globalThis.$ = () => ({ find: node, close: () => {} });

const { default: UIWindowFinalizeUserDeletion } = await import('./UIWindowFinalizeUserDeletion.js');

const rejected401 = (code) => ({
    ok: false,
    status: 401,
    clone: () => ({ json: async () => ({ code }) }),
    json: async () => ({ code }),
});

const open = async () => {
    UIWindowFinalizeUserDeletion({});
    await new Promise((r) => setTimeout(r));
};

describe('the account-deletion confirmation', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn();
        globalThis.window = {
            icons: { 'danger.svg': 'danger.svg' },
            user: { oidc_only: true, is_temp: false },
            gui_origin: 'https://puter.test',
            auth_token: 'tok-1',
            handleReauthRequired: vi.fn(),
            logout: vi.fn(),
        };
        clickHandler = null;
    });

    it('mints the session cookie and retries when the delete 401s', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(rejected401('token_missing'))
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

        await open();
        await clickHandler();

        const urls = globalThis.fetch.mock.calls.map(([u]) => String(u));
        expect(urls[1]).toContain('/session/sync-cookie');
        expect(globalThis.window.user.deleted).toBe(true);
    });

    // A hard logout here drops the window and reads as "the account is gone".
    it('prompts sign-in rather than logging out when the cookie cannot be minted', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(rejected401('token_missing'))
            .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

        await open();
        await clickHandler();

        expect(globalThis.window.handleReauthRequired).toHaveBeenCalled();
        expect(globalThis.window.logout).not.toHaveBeenCalled();
        expect(globalThis.window.user.deleted).toBeUndefined();
    });
});
