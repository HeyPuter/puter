import { describe, expect, it } from 'vitest';
import { toShare, toShareRecipients } from './shareUtil.js';

describe('toShareRecipients', () => {
    it('reads a bare string as an email or a username', () => {
        expect(toShareRecipients(['a@b.co', ' bob '])).toEqual([
            { email: 'a@b.co' },
            { username: 'bob' },
        ]);
    });

    it('passes "anyone with the link" through in its object form only', () => {
        expect(toShareRecipients({ anyone: true })).toEqual([{ anyone: true }]);
        // Only the literal `true`: nothing typed into a people field, and no
        // stray truthy field, may open an item to everyone.
        expect(toShareRecipients('anyone')).toEqual([{ username: 'anyone' }]);
        expect(toShareRecipients({ anyone: 'yes', username: 'x' })).toEqual([
            { username: 'x' },
        ]);
    });
});

describe('toShare', () => {
    it('marks a link share and leaves every other share unmarked', () => {
        const row = { uid: 's', mode: 'read', path: '/o/f', uid_entry: 'e', is_dir: 0 };
        expect(toShare({ ...row, anyone: true })).toMatchObject({ anyone: true, holder: null });
        expect(toShare(row)).not.toHaveProperty('anyone');
    });
});
