import { describe, expect, it, vi } from 'vitest';
import { AuthModule } from './Auth.js';

const picture = 'data:image/png;base64,iVBORw0KGgo=';

const makeAuth = () => {
    const puter = {
        authToken: 'test-token',
        fs: { read: vi.fn().mockResolvedValue(new Blob([JSON.stringify({ picture })])) },
    };
    return new AuthModule(puter);
};

describe('getProfilePicture', () => {
    it('reads only the requested public profile and returns its picture', async () => {
        const auth = makeAuth();
        expect(await auth.getProfilePicture('alice')).toBe(picture);
        expect(auth.puter.fs.read).toHaveBeenCalledExactlyOnceWith('/alice/Public/.profile');
    });

    it.each([null, '', ' ', 42, {}, [], '.', '..', '../alice', 'alice/Public', 'alice\\Public', 'alice\u0000'])(
        'returns null for an invalid username (%j) without reading a file', async username => {
            const auth = makeAuth();
            expect(await auth.getProfilePicture(username)).toBeNull();
            expect(auth.puter.fs.read).not.toHaveBeenCalled();
        },
    );

    it('returns null without reading a file when signed out', async () => {
        const auth = makeAuth();
        auth.puter.authToken = null;
        expect(await auth.getProfilePicture('alice')).toBeNull();
        expect(await auth.getProfilePicture()).toBeNull();
        expect(auth.puter.fs.read).not.toHaveBeenCalled();
    });

    it('returns null when the file request fails', async () => {
        const auth = makeAuth();
        auth.puter.fs.read.mockRejectedValue(new Error('Network unavailable'));
        expect(await auth.getProfilePicture('alice')).toBeNull();
    });

    it('returns null when reading the blob fails', async () => {
        const auth = makeAuth();
        auth.puter.fs.read.mockResolvedValue({ text: async () => { throw new Error('Read failed'); } });
        expect(await auth.getProfilePicture('alice')).toBeNull();
    });
});
