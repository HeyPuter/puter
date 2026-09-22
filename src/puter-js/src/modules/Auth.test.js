import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));
vi.mock('../lib/networkUtils.js', () => ({ fetchUrl: fetchUrlMock }));

const { AuthModule } = await import('./Auth.js');

const API_ORIGIN = 'https://api.test';
const picture = 'data:image/png;base64,iVBORw0KGgo=';
const profile = { picture, displayName: 'Alice', bio: null };

/** A `fetchUrl` response stub. */
const respond = (body, ok = true) => ({ ok, json: async () => body });

const makeAuth = ({ authToken = 'test-token' } = {}) =>
    new AuthModule({ authToken, APIOrigin: API_ORIGIN });

/** The URL and options of the only request made. */
const onlyRequest = () => {
    expect(fetchUrlMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchUrlMock.mock.calls[0];
    return { url: new URL(url), opts };
};

beforeEach(() => {
    fetchUrlMock.mockReset();
    fetchUrlMock.mockResolvedValue(respond(profile));
});

describe('getProfile', () => {
    it('asks the API for the named user, with the session attached and no sign-in UI', async () => {
        const auth = makeAuth();
        expect(await auth.getProfile('alice')).toEqual(profile);
        const { url, opts } = onlyRequest();
        expect(url.origin + url.pathname).toBe(`${API_ORIGIN}/profile`);
        expect(url.searchParams.get('username')).toBe('alice');
        expect(opts).toMatchObject({ includePuterAuth: true, interactiveReauth: false });
    });

    it('asks for the signed-in user when no username is given', async () => {
        const auth = makeAuth();
        expect(await auth.getProfile()).toEqual(profile);
        expect(onlyRequest().url.searchParams.has('username')).toBe(false);
    });

    it.each([null, '', ' ', 42, {}, [], '.', '..', '../alice', 'alice/Public', 'alice\\Public', 'alice '])(
        'returns null for an invalid username (%j) without a request', async username => {
            expect(await makeAuth().getProfile(username)).toBeNull();
            expect(fetchUrlMock).not.toHaveBeenCalled();
        },
    );

    it('returns null for the signed-in user when signed out, without a request', async () => {
        expect(await makeAuth({ authToken: null }).getProfile()).toBeNull();
        expect(fetchUrlMock).not.toHaveBeenCalled();
    });

    it('still asks for a named user when signed out, since public profiles need no session', async () => {
        expect(await makeAuth({ authToken: null }).getProfile('alice')).toEqual(profile);
        expect(fetchUrlMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a hidden or missing profile (404)', () => respond({ code: 'not_found' }, false)],
        ['a non-object body', () => respond([])],
        ['a request failure', () => Promise.reject(new Error('Network unavailable'))],
    ])('returns null on %s', async (_label, response) => {
        fetchUrlMock.mockImplementation(response);
        expect(await makeAuth().getProfile('alice')).toBeNull();
    });
});

describe('getProfilePicture', () => {
    it('returns the picture from the profile', async () => {
        expect(await makeAuth().getProfilePicture('alice')).toBe(picture);
        expect(onlyRequest().url.searchParams.get('username')).toBe('alice');
    });

    it.each([
        null,
        '',
        'https://example.com/avatar.png',
        'data:text/html;base64,SGk=',
        'data:image/png;base64,',
        'data:image/png;base64,%%%',
    ])('returns null for a picture that is not an image data URL (%j)', async value => {
        fetchUrlMock.mockResolvedValue(respond({ ...profile, picture: value }));
        expect(await makeAuth().getProfilePicture('alice')).toBeNull();
    });

    it('returns null when the profile is unavailable', async () => {
        fetchUrlMock.mockResolvedValue(respond({ code: 'not_found' }, false));
        expect(await makeAuth().getProfilePicture('alice')).toBeNull();
    });
});

describe('updateProfile', () => {
    it('posts the patch as JSON with the session and returns the stored profile', async () => {
        const auth = makeAuth();
        expect(await auth.updateProfile({ displayName: 'Alice' })).toEqual(profile);
        const { url, opts } = onlyRequest();
        expect(url.href).toBe(`${API_ORIGIN}/profile`);
        expect(opts).toMatchObject({
            method: 'POST',
            includePuterAuth: true,
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(opts.body)).toEqual({ displayName: 'Alice' });
    });

    it.each([null, 'x', 42, ['picture']])('rejects a patch that is not an object (%j) without a request', async patch => {
        await expect(makeAuth().updateProfile(patch)).rejects.toMatchObject({ code: 'profile_patch_invalid' });
        expect(fetchUrlMock).not.toHaveBeenCalled();
    });

    it('rejects with the backend body when the API refuses the patch', async () => {
        const refusal = { code: 'profile_field_not_allowed', message: 'Unknown profile field: name', field: 'name' };
        fetchUrlMock.mockResolvedValue(respond(refusal, false));
        await expect(makeAuth().updateProfile({ name: 'x' })).rejects.toEqual(refusal);
    });
});
