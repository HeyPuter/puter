import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasUserActivation, openAuthPopup } from './auth-popup.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('hasUserActivation', () => {
    it.each([
        [{ hasBeenActive: true, isActive: true }, true],
        [{ hasBeenActive: true, isActive: false }, false],
        [{ hasBeenActive: false, isActive: false }, false],
    ])('reads the User Activation API when the browser has it: %o', (userActivation, expected) => {
        const open = vi.fn();
        vi.stubGlobal('navigator', { userActivation });
        vi.stubGlobal('window', { open });
        expect(hasUserActivation()).toBe(expected);
        expect(open).not.toHaveBeenCalled();
    });

    describe('without the User Activation API', () => {
        const probeWith = (open) => {
            vi.stubGlobal('navigator', {});
            vi.stubGlobal('window', { open });
            return hasUserActivation();
        };

        it('is true when a probe popup opens, and closes the probe', () => {
            const probe = { close: vi.fn() };
            const open = vi.fn(() => probe);
            expect(probeWith(open)).toBe(true);
            expect(open).toHaveBeenCalledWith('', '_blank', 'width=1,height=1,left=-1000,top=-1000');
            expect(probe.close).toHaveBeenCalledTimes(1);
        });

        it('is false when the browser blocks the probe popup', () => {
            expect(probeWith(() => null)).toBe(false);
        });

        it('is false when opening a popup throws', () => {
            expect(probeWith(() => {
                throw new DOMException('Popups are not allowed', 'SecurityError');
            })).toBe(false);
        });
    });
});

describe('openAuthPopup', () => {
    const FEATURES = 'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=600, height=700, top=190, left=660';

    it('opens a popup centered on the screen and has the SDK trust it', () => {
        const popup = { closed: false };
        const open = vi.fn(() => popup);
        const tracked = [];
        vi.stubGlobal('screen', { width: 1920, height: 1080 });
        vi.stubGlobal('window', { open });
        vi.stubGlobal('puter', { trackOpenedWindow_: win => tracked.push(win) });

        expect(openAuthPopup('https://puter.com/action/sign-in?msg_id=1', 'Sign in')).toBe(popup);
        expect(open).toHaveBeenCalledWith('https://puter.com/action/sign-in?msg_id=1', 'Sign in', FEATURES);
        expect(tracked).toEqual([popup]);
    });

    it('names the window Puter by default, and returns null when the browser blocks the popup', () => {
        const open = vi.fn(() => null);
        vi.stubGlobal('screen', { width: 1920, height: 1080 });
        vi.stubGlobal('window', { open });
        vi.stubGlobal('puter', undefined);

        expect(openAuthPopup('https://puter.com/action/sign-in')).toBeNull();
        expect(open).toHaveBeenCalledWith('https://puter.com/action/sign-in', 'Puter', FEATURES);
    });
});
