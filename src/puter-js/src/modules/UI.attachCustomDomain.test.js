import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Popups are opened through the shared helper; stub it so a test can see the
// URL and hand back a window it controls.
const opened = [];
vi.mock('../lib/auth-popup.js', async (importOriginal) => ({
    ...(await importOriginal()),
    hasUserActivation: () => true,
    openAuthPopup: (url, name) => {
        const popup = { url, name, closed: false };
        opened.push(popup);
        return popup;
    },
}));

const { UIModule } = await import('./UI.js');

const GUI_ORIGIN = 'https://puter.com';
const DOMAIN = {
    uuid: 'cd-1',
    hostname: 'www.example.com',
    site: 'mysite',
    status: 'pending',
};

let messageHandlers;
let parentWindow;

const makeUI = (env) =>
    new UIModule({
        env,
        authToken: 'token-1',
        APIOrigin: 'https://api.test',
        appID: 'app-1',
        util: {},
    }, { appInstanceID: 'instance-1' });

const deliver = async (event) => {
    for ( const handler of [...messageHandlers] ) await handler(event);
};

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, Promise.resolve(PENDING)]);

const attachCalls = () =>
    parentWindow.postMessage.mock.calls.filter(([m]) => m?.msg === 'attachCustomDomain');

beforeEach(() => {
    vi.useFakeTimers();
    messageHandlers = [];
    opened.length = 0;
    parentWindow = { postMessage: vi.fn() };
    globalThis.window = {
        parent: parentWindow,
        focus: vi.fn(),
        addEventListener: (name, handler) => {
            if ( name === 'message' ) messageHandlers.push(handler);
        },
        removeEventListener: (name, handler) => {
            const i = messageHandlers.indexOf(handler);
            if ( name === 'message' && i !== -1 ) messageHandlers.splice(i, 1);
        },
    };
    globalThis.document = { addEventListener: vi.fn() };
    globalThis.open = vi.fn();
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
    globalThis.location = { search: '?puter.gui_features=feedback-dialog,custom-domains' };
});

afterEach(() => {
    vi.useRealTimers();
    for ( const name of ['window', 'document', 'open', 'puter', 'location'] ) {
        delete globalThis[name];
    }
});

describe('attachCustomDomain_ inside the Puter desktop', () => {
    it('asks the desktop and resolves the domain the user chose', async () => {
        const ui = makeUI('app');
        const promise = ui.attachCustomDomain_('mysite');

        const [[msg]] = attachCalls();
        expect(msg).toMatchObject({
            msg: 'attachCustomDomain',
            subdomain: 'mysite',
            appInstanceID: 'instance-1',
        });

        await deliver({
            source: parentWindow,
            origin: GUI_ORIGIN,
            data: { msg: 'customDomainAttached', original_msg_id: msg.uuid, domain: DOMAIN },
        });
        await expect(promise).resolves.toEqual(DOMAIN);
    });

    it('resolves null when the user closes the dialog', async () => {
        const ui = makeUI('app');
        const promise = ui.attachCustomDomain_('mysite');
        const [[msg]] = attachCalls();

        await deliver({
            source: parentWindow,
            origin: GUI_ORIGIN,
            data: { msg: 'customDomainAttached', original_msg_id: msg.uuid, domain: null },
        });
        await expect(promise).resolves.toBeNull();
    });

    it('ignores a reply from anything but the desktop', async () => {
        const ui = makeUI('app');
        const promise = ui.attachCustomDomain_('mysite');
        const [[msg]] = attachCalls();

        await deliver({
            source: {},
            origin: 'https://evil.example',
            data: { msg: 'customDomainAttached', original_msg_id: msg.uuid, domain: DOMAIN },
        });
        expect(await settled(promise)).toBe(PENDING);
    });

    it('rejects on a desktop without the dialog instead of hanging', async () => {
        globalThis.location = { search: '?puter.gui_features=feedback-dialog' };
        const ui = makeUI('app');

        await expect(ui.attachCustomDomain_('mysite')).rejects.toMatchObject({
            code: 'not_supported',
        });
        expect(attachCalls()).toHaveLength(0);
    });
});

describe('attachCustomDomain_ on a third-party site', () => {
    it('opens the GUI action popup for the subdomain and resolves its answer', async () => {
        const ui = makeUI('web');
        const promise = ui.attachCustomDomain_('mysite');

        expect(opened).toHaveLength(1);
        const url = new URL(opened[0].url);
        expect(url.origin).toBe(GUI_ORIGIN);
        expect(url.pathname).toBe('/action/attach-custom-domain');
        expect(url.searchParams.get('embedded_in_popup')).toBe('true');
        expect(url.searchParams.get('subdomain')).toBe('mysite');
        const msg_id = url.searchParams.get('msg_id');

        // Wrong request, wrong window, wrong origin: all ignored.
        await deliver({ source: opened[0], origin: GUI_ORIGIN, data: { msg: 'customDomainAttached', original_msg_id: 'other', domain: DOMAIN } });
        await deliver({ source: {}, origin: GUI_ORIGIN, data: { msg: 'customDomainAttached', original_msg_id: msg_id, domain: DOMAIN } });
        await deliver({ source: opened[0], origin: 'https://evil.example', data: { msg: 'customDomainAttached', original_msg_id: msg_id, domain: DOMAIN } });
        expect(await settled(promise)).toBe(PENDING);

        await deliver({ source: opened[0], origin: GUI_ORIGIN, data: { msg: 'customDomainAttached', original_msg_id: msg_id, domain: DOMAIN } });
        await expect(promise).resolves.toEqual(DOMAIN);
    });

    it('resolves null once the popup is closed without an answer', async () => {
        const ui = makeUI('web');
        const promise = ui.attachCustomDomain_('mysite');
        opened[0].closed = true;

        await vi.advanceTimersByTimeAsync(1200);
        await expect(promise).resolves.toBeNull();
    });
});

describe('attachCustomDomain_ where no dialog can be shown', () => {
    it.each(['nodejs', 'web-worker', 'service-worker'])('rejects in %s', async (env) => {
        const ui = makeUI(env);
        await expect(ui.attachCustomDomain_('mysite')).rejects.toMatchObject({
            code: 'not_available',
        });
    });
});
