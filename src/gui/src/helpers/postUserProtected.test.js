import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../util/openid.js', () => ({
    openRevalidatePopup: vi.fn(async () => {}),
}));

globalThis.i18n = (key) => key;

const { default: postUserProtected } = await import('./postUserProtected.js');
const { openRevalidatePopup } = await import('../util/openid.js');

const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });
const urls = () => fetch.mock.calls.map(([url]) => String(url));
const bodyOf = (index) => JSON.parse(fetch.mock.calls[index][1].body);

beforeEach(() => {
    globalThis.fetch = vi.fn();
    globalThis.window = {
        gui_origin: 'https://puter.test',
        auth_token: 'tok-1',
        user: { oidc_only: false },
        handleReauthRequired: vi.fn(),
    };
    openRevalidatePopup.mockReset();
    openRevalidatePopup.mockResolvedValue(undefined);
});

describe('postUserProtected', () => {
    it('posts the change with the password, by cookie and without an Authorization header', async () => {
        fetch.mockResolvedValueOnce(reply(200, { success: true }));

        const result = await postUserProtected('change-username', { new_username: 'bob' }, { password: 'pw' });

        expect(result).toEqual({ ok: true, data: { success: true } });
        expect(urls()).toEqual(['https://puter.test/user-protected/change-username']);
        expect(fetch.mock.calls[0][1].credentials).toBe('include');
        expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
        expect(bodyOf(0)).toEqual({ new_username: 'bob', password: 'pw' });
    });

    // The route is cookie-gated, so a session cookie that went missing
    // mid-session reads as a plain 401.
    it('mints the session cookie and retries when the submit 401s', async () => {
        fetch
            .mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(200))
            .mockResolvedValueOnce(reply(200, { success: true }));

        const result = await postUserProtected('delete-own-user', {}, { password: 'pw' });

        expect(urls()[1]).toContain('/session/sync-cookie');
        expect(urls()[2]).toContain('/user-protected/delete-own-user');
        expect(result.ok).toBe(true);
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
    });

    it('starts the sign-in flow when the cookie cannot be minted', async () => {
        fetch
            .mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(401));

        const result = await postUserProtected('delete-own-user', {}, { password: 'pw' });

        expect(result).toMatchObject({ ok: false, reauth: true, message: 'reauth_required_message' });
        expect(window.handleReauthRequired).toHaveBeenCalled();
    });

    it('signs a provider-only account in first and sends no password', async () => {
        window.user = { oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' };
        const onRevalidate = vi.fn();
        fetch.mockResolvedValueOnce(reply(200));

        await postUserProtected('change-password', { new_pass: 'New1!pass' }, { onRevalidate });

        expect(onRevalidate).toHaveBeenCalledOnce();
        expect(openRevalidatePopup).toHaveBeenCalledWith('https://puter.test/revalidate');
        expect(bodyOf(0)).toEqual({ new_pass: 'New1!pass' });
    });

    // `oidc_only` on the cached user can lag the account's real state, so
    // the server-driven retry has to carry the change itself too.
    it('retries with the change but not the password when the server asks for a provider sign-in', async () => {
        fetch
            .mockResolvedValueOnce(reply(403, { code: 'oidc_revalidation_required', revalidate_url: 'https://puter.test/r2' }))
            .mockResolvedValueOnce(reply(200));

        const result = await postUserProtected('change-email', { new_email: 'a@b.c', code: '000123' }, { password: 'pw' });

        expect(openRevalidatePopup).toHaveBeenCalledWith('https://puter.test/r2');
        expect(bodyOf(1)).toEqual({ new_email: 'a@b.c', code: '000123' });
        expect(result.ok).toBe(true);
    });

    it('gives up without posting when the sign-in popup is closed', async () => {
        window.user = { oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' };
        openRevalidatePopup.mockRejectedValueOnce(new Error('Popup closed'));

        const result = await postUserProtected('delete-own-user', {});

        expect(result).toMatchObject({ ok: false, message: 'revalidate_failed' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('passes the server message through on any other failure', async () => {
        fetch.mockResolvedValueOnce(reply(400, { message: 'Username taken', code: 'bad_request' }));

        const result = await postUserProtected('change-username', { new_username: 'x' }, { password: 'pw' });

        expect(result).toMatchObject({ ok: false, message: 'Username taken' });
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
    });
});
