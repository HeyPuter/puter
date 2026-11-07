// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    POPUP_FRAME_MSG,
    framedPopupAction,
    framedPopupParams,
    startPopupFrame,
} from './popupFrame.js';

const HOST = 'https://notes.puter.test';

/** A stand-in for the frame's window, with its own parent to post to. */
const frameWindow = () => {
    const parent = { postMessage: vi.fn() };
    const open = vi.fn(() => 'opened');
    return {
        parent,
        open,
        opener: null,
        close: () => {},
        document,
        MutationObserver: window.MutationObserver,
    };
};

const statesSent = (win) => win.parent.postMessage.mock.calls.map(([data, origin]) => {
    expect(origin).toBe(HOST);
    expect(data.msg).toBe(POPUP_FRAME_MSG);
    return data.state;
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('framedPopupAction', () => {
    it.each([
        ['/embed/sign-in', 'sign-in'],
        ['/embed/sign-in/', 'sign-in'],
        ['/embed/show-open-file-picker', 'show-open-file-picker'],
        ['/embed/show-save-file-picker', 'show-save-file-picker'],
        ['/embed/show-directory-picker', 'show-directory-picker'],
        ['/embed/apps', null],
        ['/embed/feedback', null],
        ['/embed/request-permission', null],
        ['/action/sign-in', null],
        ['/embed/sign-in/extra', null],
        ['/', null],
        [undefined, null],
    ])('%s frames %s', (pathname, expected) => {
        expect(framedPopupAction(pathname)).toBe(expected);
    });
});

describe('framedPopupParams', () => {
    it('keeps only the popup parameters a framing page may pass', () => {
        const params = framedPopupParams('#msg_id=7&options=%7B%22multiple%22%3Atrue%7D&request_auth=true&user=abc&auth_token=x&attempt_temp_user_creation=true&api_origin=https%3A%2F%2Fevil.test');
        expect(Object.fromEntries(params)).toEqual({
            msg_id: '7',
            options: '{"multiple":true}',
            request_auth: 'true',
        });
    });

    it('is empty without a fragment', () => {
        expect([...framedPopupParams('')]).toEqual([]);
        expect([...framedPopupParams(undefined)]).toEqual([]);
    });
});

describe('startPopupFrame', () => {
    it('does nothing without a framing page to answer', () => {
        const win = frameWindow();
        expect(startPopupFrame(win, null)).toBeNull();
        const top = frameWindow();
        top.parent = top;
        expect(startPopupFrame(top, HOST)).toBeNull();
        expect(win.opener).toBeNull();
    });

    it('makes the framing page the opener and tells it the frame is loading', () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        expect(win.opener).toBe(win.parent);
        expect(statesSent(win)).toEqual(['loading']);
    });

    it('asks the framing page to remove the frame on close, either way the popup closes', () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        win.close();
        win.open('', '_self').close();
        expect(statesSent(win)).toEqual(['loading', 'closed', 'closed']);
    });

    it('leaves other window.open calls alone', () => {
        const win = frameWindow();
        const open = win.open;
        startPopupFrame(win, HOST);
        expect(win.open('https://puter.com/terms', '_blank')).toBe('opened');
        expect(open).toHaveBeenCalledWith('https://puter.com/terms', '_blank');
    });

    it('tells the framing page it is ready once the popup shows something', async () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        document.body.append(Object.assign(document.createElement('div'), { className: 'busy' }));
        await Promise.resolve();
        expect(statesSent(win)).toEqual(['loading']);

        const dialog = document.createElement('div');
        dialog.className = 'dashboard-dialog-overlay auth-dialog-page';
        document.body.append(dialog);
        await Promise.resolve();
        document.body.append(Object.assign(document.createElement('div'), { className: 'window' }));
        await Promise.resolve();
        expect(statesSent(win)).toEqual(['loading', 'ready']);
    });
});
