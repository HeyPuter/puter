// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
};

const GUI_ORIGIN = 'https://puter.test';

/** A UI module in one environment. */
const makeUI = ({ env = 'app' } = {}) =>
    new UIModule(
        {
            env,
            authToken: 'token-1',
            APIOrigin: 'https://api.test',
            appID: 'app-1',
            util: {},
        },
        { appInstanceID: 'instance-1' },
    );

const enableCalls = (postMessage) =>
    postMessage.mock.calls.filter(([msg]) => msg?.msg === 'enablePush');

/** Points the SDK at a desktop that advertises `features`. */
const framedBy = (features) => {
    const search = features === null ? '' : `?puter.gui_features=${features}`;
    window.history.replaceState({}, '', `/${search}`);
};

/** The desktop's reply to the message the SDK posted. */
const reply = (postMessage, state) => {
    const [message] = enableCalls(postMessage).at(-1);
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { msg: 'pushEnabled', state, original_msg_id: message.uuid },
            origin: GUI_ORIGIN,
            source: window.parent,
        }),
    );
};

const popupMessage = (data, { origin = GUI_ORIGIN, source } = {}) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

let popup;
let postMessage;

beforeEach(() => {
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
    popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup);
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: true },
    });
    postMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
        configurable: true,
        value: { postMessage },
    });
    framedBy('feedback-dialog,enable-push');
});

afterEach(() => {
    delete navigator.userActivation;
    delete globalThis.puter;
});

describe('ui.enablePush inside the desktop', () => {
    it('asks the desktop and resolves whether this browser is on', async () => {
        const ui = makeUI();
        const first = ui.enablePush();
        await vi.waitFor(() =>
            expect(enableCalls(postMessage)).toHaveLength(1),
        );
        reply(postMessage, 'on');
        await expect(first).resolves.toBe(true);

        const second = ui.enablePush();
        await vi.waitFor(() =>
            expect(enableCalls(postMessage)).toHaveLength(2),
        );
        reply(postMessage, 'off');
        await expect(second).resolves.toBe(false);
    });

    it.each([
        ['a desktop that does not list it', 'feedback-dialog'],
        ['a desktop that lists nothing', null],
    ])('answers false without asking %s', async (_label, features) => {
        framedBy(features);
        const ui = makeUI();
        await expect(ui.enablePush()).resolves.toBe(false);
        expect(enableCalls(postMessage)).toHaveLength(0);
    });
});

describe('ui.enablePush on a website', () => {
    const lastUrl = () => new URL(window.open.mock.calls.at(-1)[0]);

    it('opens the enable-push popup on the Puter origin and reads its answer', async () => {
        const ui = makeUI({ env: 'web' });
        const result = ui.enablePush();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));

        const url = lastUrl();
        expect(url.origin).toBe(GUI_ORIGIN);
        expect(url.pathname).toBe('/action/enable-push');
        expect(url.searchParams.get('embedded_in_popup')).toBe('true');
        const msg_id = url.searchParams.get('msg_id');
        expect(msg_id).toMatch(/^\d+-[a-z0-9]+$/);

        popupMessage(
            { msg: 'pushEnabled', state: 'on', original_msg_id: msg_id },
            { source: popup },
        );
        await expect(result).resolves.toBe(true);
    });

    it('resolves false when the popup answers any state but on', async () => {
        const ui = makeUI({ env: 'web' });
        const result = ui.enablePush();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        const msg_id = lastUrl().searchParams.get('msg_id');

        popupMessage(
            { msg: 'pushEnabled', state: 'blocked', original_msg_id: msg_id },
            { source: popup },
        );
        await expect(result).resolves.toBe(false);
    });

    it('ignores answers from another origin, another window, or another request', async () => {
        const ui = makeUI({ env: 'web' });
        const result = ui.enablePush();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        const msg_id = lastUrl().searchParams.get('msg_id');
        let settled = false;
        result.then(() => {
            settled = true;
        });

        popupMessage(
            { msg: 'pushEnabled', state: 'on', original_msg_id: msg_id },
            { origin: 'https://other.test', source: popup },
        );
        popupMessage(
            { msg: 'pushEnabled', state: 'on', original_msg_id: msg_id },
            { source: { other: true } },
        );
        popupMessage(
            {
                msg: 'pushEnabled',
                state: 'on',
                original_msg_id: 'someone-else',
            },
            { source: popup },
        );
        popupMessage(
            {
                msg: 'permissionGranted',
                granted: true,
                original_msg_id: msg_id,
            },
            { source: popup },
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(settled).toBe(false);

        popupMessage(
            { msg: 'pushEnabled', state: 'on', original_msg_id: msg_id },
            { source: popup },
        );
        await expect(result).resolves.toBe(true);
    });

    it('resolves false when the browser blocks the popup', async () => {
        window.open = vi.fn(() => null);
        const ui = makeUI({ env: 'web' });
        await expect(ui.enablePush()).resolves.toBe(false);
    });

    it('resolves false when the popup closes without answering', async () => {
        const ui = makeUI({ env: 'web' });
        const result = ui.enablePush();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        popup.closed = true;
        await expect(result).resolves.toBe(false);
    }, 5000);

    it('collects a click first when there is no user activation', async () => {
        Object.defineProperty(navigator, 'userActivation', {
            configurable: true,
            value: { hasBeenActive: false, isActive: false },
        });
        const ui = makeUI({ env: 'web' });
        const result = ui.enablePush();
        await vi.waitFor(() =>
            expect(document.querySelector('puter-dialog')).not.toBeNull(),
        );
        const dialog = document.querySelector('puter-dialog');
        expect(dialog.shadowRoot.querySelector('.about').textContent).toContain(
            'push notifications',
        );
        expect(window.open).not.toHaveBeenCalled();

        dialog.shadowRoot.querySelector('#launch-auth-popup-cancel').click();
        await expect(result).resolves.toBe(false);
        expect(document.querySelector('puter-dialog')).toBeNull();
    });
});

describe('ui.enablePush elsewhere', () => {
    it.each(['gui', 'nodejs', 'web-worker'])(
        'answers false in %s',
        async (env) => {
            const ui = makeUI({ env });
            await expect(ui.enablePush()).resolves.toBe(false);
            expect(window.open).not.toHaveBeenCalled();
            expect(enableCalls(postMessage)).toHaveLength(0);
        },
    );
});
