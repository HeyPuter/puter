// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const GUI_ORIGIN = 'https://puter.test';
const CHECK_URL = 'https://api.test/auth/check-permissions';
const PERMISSION = 'fs:/alice/docs:read';

// How the SDK paces itself once the popup is seen closed.
const CLOSE_POLL_MS = 100;
const CLOSE_GRACE_MS = 1000;
const SERVER_POLL_MS = 2000;
const SERVER_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const SERVER_ATTEMPT_TIMEOUT_MS = 10 * 1000;

let sdk;
let popup;
let fetchMock;

const setActivation = (active) => {
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: active, isActive: active },
    });
};

const setIsolated = (value) => {
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value });
};

/** Starts a request and returns it with the popup's request id, once the popup is open. */
const request = async (options = { permission: PERMISSION }) => {
    const ui = new UIModule(sdk, { appInstanceID: 'instance-1' });
    const result = ui.requestPermission(options);
    const outcome = { value: undefined, settled: false };
    result.then((value) => {
        outcome.value = value;
        outcome.settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    return { result, outcome };
};

const msgId = () => new URL(window.open.mock.calls.at(-1)[0]).searchParams.get('msg_id');

const fromPopup = (data) => window.dispatchEvent(new MessageEvent('message', {
    data: { original_msg_id: msgId(), ...data },
    origin: GUI_ORIGIN,
    source: popup,
}));

/** The user closes the popup, and the SDK notices on its next look. */
const closePopup = async () => {
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(CLOSE_POLL_MS);
};

const heldResponse = (permissions) => ({ ok: true, json: async () => ({ permissions }) });

beforeEach(() => {
    vi.useFakeTimers();
    // No token at first, so the already-held check answers without a request.
    sdk = {
        env: 'web',
        authToken: null,
        APIOrigin: 'https://api.test',
        appID: 'app-1',
        util: {},
        defaultGUIOrigin: GUI_ORIGIN,
    };
    globalThis.puter = sdk;
    popup = { closed: false };
    window.open = vi.fn(() => popup);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setActivation(true);
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setIsolated(false);
    delete navigator.userActivation;
    delete globalThis.puter;
});

describe('ui.requestPermission when the popup closes after announcing itself', () => {
    it('answers false once a decision has had its time to arrive', async () => {
        const { outcome } = await request();
        fromPopup({ msg: 'permissionPromptReady' });
        await closePopup();

        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS - 1);
        expect(outcome.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toEqual({ value: false, settled: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('takes a decision that was still on its way when the popup closed', async () => {
        const { result, outcome } = await request();
        fromPopup({ msg: 'permissionPromptReady' });
        await closePopup();

        fromPopup({ msg: 'permissionGranted', granted: true });
        await expect(result).resolves.toBe(true);

        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
        expect(outcome.value).toBe(true);
    });

    it('does not read the announcement as a decision', async () => {
        const { outcome } = await request();

        fromPopup({ msg: 'permissionPromptReady' });
        await vi.advanceTimersByTimeAsync(CLOSE_POLL_MS);

        expect(outcome.settled).toBe(false);
    });
});

// A popup cut off from its opener reads as closed while the prompt is still up.
describe('ui.requestPermission when the popup closes without ever announcing itself', () => {
    it('answers false right away on a page with no token to check with', async () => {
        const { outcome } = await request();
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);

        expect(outcome).toEqual({ value: false, settled: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads the grant back from the server', async () => {
        fetchMock
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce(heldResponse({ [PERMISSION]: true }));
        const { outcome } = await request();
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);

        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(CHECK_URL);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer token-1');
        expect(JSON.parse(init.body)).toEqual({ permissions: [PERMISSION] });
        expect(outcome.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(outcome).toEqual({ value: true, settled: true });

        // Settled: nothing is left polling.
        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('waits for every scope of a multi-scope request', async () => {
        const permissions = [PERMISSION, 'user:u-1:email:read'];
        fetchMock
            .mockResolvedValueOnce(heldResponse({ [PERMISSION]: true }))
            .mockResolvedValueOnce(heldResponse({ [PERMISSION]: true, 'user:u-1:email:read': true }));
        const { outcome } = await request({ permissions });
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + SERVER_POLL_MS);

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ permissions });
        expect(outcome.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);
        expect(outcome).toEqual({ value: true, settled: true });
    });

    it('keeps asking through failed requests and answers false after five minutes', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        const { outcome } = await request();
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);

        await vi.advanceTimersByTimeAsync(SERVER_POLL_TIMEOUT_MS - SERVER_POLL_MS);
        expect(outcome.settled).toBe(false);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(100);

        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);
        expect(outcome).toEqual({ value: false, settled: true });
    });

    it('gives up on a request that stalls and asks again', async () => {
        // Never answers; settles only when the SDK aborts it.
        fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, rejectAttempt) => {
            signal.addEventListener('abort', () => rejectAttempt(new Error('aborted')));
        }));
        fetchMock.mockResolvedValue(heldResponse({ [PERMISSION]: true }));
        const { outcome } = await request();
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + SERVER_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(SERVER_ATTEMPT_TIMEOUT_MS - 1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1 + SERVER_POLL_MS);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(outcome).toEqual({ value: true, settled: true });
    });

    it('stops asking the server once the page is signed out', async () => {
        fetchMock.mockResolvedValue(heldResponse({}));
        const { outcome } = await request();
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + SERVER_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        sdk.authToken = null;
        await vi.advanceTimersByTimeAsync(SERVER_POLL_TIMEOUT_MS);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({ value: false, settled: true });
    });

    it('takes a decision the popup posts while the server is being asked', async () => {
        fetchMock.mockResolvedValue(heldResponse({}));
        const { result } = await request();
        sdk.authToken = 'token-1';
        await closePopup();
        await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + SERVER_POLL_MS);

        fromPopup({ msg: 'permissionGranted', granted: true });
        await expect(result).resolves.toBe(true);

        const calls = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(calls);
    });
});

describe('ui.requestPermission on a cross-origin-isolated page', () => {
    // The click on Continue comes after the page got its token.
    const requestFromConsent = async () => {
        setActivation(false);
        const started = await request();
        sdk.authToken = 'token-1';
        document.querySelector('puter-dialog').shadowRoot.querySelector('#launch-auth-popup').click();
        return started;
    };

    it('reads the decision from the server while the popup stays open', async () => {
        setIsolated(true);
        fetchMock.mockResolvedValue(heldResponse({ [PERMISSION]: true }));
        const { outcome } = await requestFromConsent();

        expect(window.open).toHaveBeenCalledTimes(1);
        expect(popup.closed).toBe(false);
        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);

        expect(outcome).toEqual({ value: true, settled: true });
    });

    it('does the same for a popup that already reads as closed when it opens', async () => {
        popup.closed = true;
        fetchMock.mockResolvedValue(heldResponse({ [PERMISSION]: true }));
        const { outcome } = await requestFromConsent();

        await vi.advanceTimersByTimeAsync(SERVER_POLL_MS);

        expect(outcome).toEqual({ value: true, settled: true });
    });
});
