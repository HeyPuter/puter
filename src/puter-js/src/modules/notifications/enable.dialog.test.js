// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('./lib/api.js', () => ({
    request: (...args) => mockRequest(...args),
}));
const store = new Map();
vi.mock('./lib/pushStore.js', () => ({
    HANDLERS_STORE: 'handlers',
    SERVER_KEY_ENTRY: 'puter:server-key',
    SERVER_KEYS_ENTRY: 'puter:server-keys',
    SYNCED_PREFIX: 'puter:synced:',
    SUBSCRIPTION_CHANGED_PREFIX: 'puter:subscription-changed:',
    TAP_BASE_PREFIX: 'puter:tap-base:',
    CLICK_KEEP_MS: 5 * 60 * 1000,
    takeClick: async () => null,
    forgetOldClicks: async () => {},
    forgetPushState: async () => store.clear(),
    idbGet: async (s, k) => store.get(`${s}:${k}`),
    idbPut: async (s, k, v) => void store.set(`${s}:${k}`, v),
    idbDelete: async (s, k) => void store.delete(`${s}:${k}`),
    hasOptIn: async (uuid) => store.get(`opt-in:${uuid}`) === true,
    setOptIn: async (uuid, on) => void store.set(`opt-in:${uuid}`, on),
}));

const { NotificationsModule } = await import('./index.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const KEY = Buffer.from([4, ...Array(64).fill(7)]).toString('base64url');

const subscription = {
    endpoint: 'https://push.example/send/abc',
    options: { applicationServerKey: null },
    toJSON: () => ({
        endpoint: 'https://push.example/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
    }),
};

const makeModule = () =>
    new NotificationsModule({
        env: 'web',
        authToken: 't',
        APIOrigin: 'https://api.test',
        whoami: { uuid: 'u-1' },
        onAuthStateChanged: () => () => {},
    });

const dialog = () => document.querySelector('puter-dialog');
const click = (selector) =>
    dialog().shadowRoot.querySelector(selector).click();
const announced = () =>
    mockRequest.mock.calls.filter(
        ([, method, route]) =>
            method === 'POST' && route === '/push/web/subscriptions',
    );

beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation(async (_p, _method, route) =>
        route === '/push/web/key'
            ? { publicKey: KEY }
            : { status: 'active', device: { uid: 'd1' } },
    );
    store.clear();
    document.body.innerHTML = '';
    globalThis.PushManager = function PushManager() {};
    globalThis.Notification = {
        permission: 'default',
        requestPermission: vi.fn(async () => 'granted'),
    };
    const registration = {
        active: { scriptURL: new URL('/puter-sw.js', location.href).href },
        pushManager: {
            getSubscription: async () => null,
            subscribe: vi.fn(async () => subscription),
        },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            register: vi.fn(async () => registration),
            getRegistration: vi.fn(async () => registration),
            addEventListener: () => {},
            removeEventListener: () => {},
        },
    });
    // The click that called enable() is no longer active.
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: false },
    });
});

afterEach(() => {
    delete navigator.userActivation;
    delete navigator.serviceWorker;
    delete globalThis.PushManager;
    delete globalThis.Notification;
});

describe('enable() on a website without the click', () => {
    it('asks the browser from the Continue click of Puter`s dialog, then turns pushes on', async () => {
        const enabling = makeModule().enable();
        expect(dialog()).not.toBeNull();
        expect(Notification.requestPermission).not.toHaveBeenCalled();

        click('#launch-auth-popup');
        expect(Notification.requestPermission).toHaveBeenCalledTimes(1);

        await expect(enabling).resolves.toBe(true);
        expect(dialog()).toBeNull();
        expect(announced()).toHaveLength(1);
        expect(store.get('opt-in:u-1')).toBe(true);
    });

    it('resolves false without asking the browser when the user cancels', async () => {
        const enabling = makeModule().enable();
        click('#launch-auth-popup-cancel');
        await expect(enabling).resolves.toBe(false);
        expect(Notification.requestPermission).not.toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
        expect(dialog()).toBeNull();
    });

    it('resolves false when the browser refuses from the dialog', async () => {
        Notification.requestPermission.mockResolvedValue('denied');
        const enabling = makeModule().enable();
        click('#launch-auth-popup');
        await expect(enabling).resolves.toBe(false);
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('shows one dialog for calls made while it is open', async () => {
        const module = makeModule();
        const first = module.enable();
        const second = module.enable();
        expect(document.querySelectorAll('puter-dialog')).toHaveLength(1);

        click('#launch-auth-popup');
        await expect(Promise.all([first, second])).resolves.toEqual([
            true,
            true,
        ]);
        expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('asks right away with no dialog while the click is still active', async () => {
        navigator.userActivation.isActive = true;
        const enabling = makeModule().enable();
        expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
        expect(dialog()).toBeNull();
        await expect(enabling).resolves.toBe(true);
    });

    it('rejects user_gesture_required where the page can`t show a dialog', async () => {
        const showModal = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = () => {
            throw new Error('InvalidStateError');
        };
        try {
            await expect(makeModule().enable()).rejects.toMatchObject({
                code: 'user_gesture_required',
            });
            expect(dialog()).toBeNull();
            expect(Notification.requestPermission).not.toHaveBeenCalled();
        } finally {
            HTMLDialogElement.prototype.showModal = showModal;
        }
    });
});
