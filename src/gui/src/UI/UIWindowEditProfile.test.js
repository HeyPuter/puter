import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async () => ({})),
}));

globalThis.i18n = (key) => key;

/** Minimal jQuery stand-in: a selector -> value map drives the handler. */
const fields = {};
const shown = {};
let clickHandler = null;
const node = (sel) => {
    const self = {
        val: (v) => {
            if ( v === undefined ) return fields[sel];
            fields[sel] = v;
            return self;
        },
        on: (evt, fn) => {
            if ( evt === 'click' && sel === '.edit-profile-btn' ) clickHandler = fn;
            return self;
        },
        html: (v) => {
            shown[sel] = v;
            return self;
        },
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
globalThis.$ = () => ({ find: node });

const { default: UIWindowEditProfile } = await import('./UIWindowEditProfile.js');

describe('the edit-profile window', () => {
    beforeEach(() => {
        for ( const key of Object.keys(fields) ) delete fields[key];
        for ( const key of Object.keys(shown) ) delete shown[key];
        clickHandler = null;
        globalThis.window = {
            uuidv4: () => 'test-id',
            user: { username: 'alice', profile: { displayName: 'Alice', bio: 'Hi there' } },
            update_profile: vi.fn(async (_username, patch) => patch),
        };
    });

    it('prefills the current display name and bio', async () => {
        await UIWindowEditProfile({});

        expect(fields['.edit-profile-display-name']).toBe('Alice');
        expect(fields['.edit-profile-bio']).toBe('Hi there');
    });

    it('saves trimmed values and clears empty fields', async () => {
        const onSave = vi.fn();
        await UIWindowEditProfile({ onSave });
        fields['.edit-profile-display-name'] = '  Alice Smith ';
        fields['.edit-profile-bio'] = '   ';

        await clickHandler();

        expect(window.update_profile).toHaveBeenCalledWith('alice', {
            displayName: 'Alice Smith',
            bio: null,
        });
        expect(onSave).toHaveBeenCalledWith({ displayName: 'Alice Smith', bio: null });
        expect(shown['.form-success-msg']).toBe('profile_saved');
    });

    it('shows an error and skips onSave when the save fails', async () => {
        window.update_profile = vi.fn(async () => undefined);
        const onSave = vi.fn();
        await UIWindowEditProfile({ onSave });

        await clickHandler();

        expect(shown['.form-error-msg']).toBe('profile_save_failed');
        expect(onSave).not.toHaveBeenCalled();
    });
});
