// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));
globalThis.$ = globalThis.jQuery = jQuery;

const { stub } = vi.hoisted(() => ({ stub: () => ({ default: () => {} }) }));
vi.mock('./helpers/download.js', stub);
vi.mock('./helpers/itemIcon.js', stub);
vi.mock('./helpers/socialLink.js', stub);
vi.mock('./helpers/updateMousePosition.js', stub);
vi.mock('./UI/UIAlert.js', stub);
vi.mock('./UI/UIContextMenu.js', stub);
vi.mock('./UI/UIItem.js', stub);
vi.mock('./UI/UIPopover.js', stub);
vi.mock('./UI/UIPrompt.js', stub);
vi.mock('./UI/UIWindow.js', stub);
vi.mock('./UI/UIWindowAppFeedback.js', stub);
vi.mock('./UI/UIWindowColorPicker.js', stub);
vi.mock('./UI/UIWindowEmailConfirmationRequired.js', stub);
vi.mock('./UI/UIWindowFontPicker.js', stub);
vi.mock('./UI/UIPermissionDialog.js', stub);
vi.mock('./UI/UIWindowSaveAccount.js', stub);
vi.mock('./UI/UIWindowSignup.js', stub);
vi.mock('./UI/UINotification.js', stub);
vi.mock('./helpers/godmodeTokens.js', () => ({ renewGodmodeToken: vi.fn() }));
vi.mock('./helpers/watchItems.js', () => ({ addItemWatcher: vi.fn() }));
vi.mock('./helpers/verification_gates.js', () => ({
    openVerificationGateWindow: vi.fn(),
}));

let iframe;
let send;

beforeAll(async () => {
    window.when_puter_happens = [];
    window.appCallbackFunctions = {};
    await import('./IPC.js');
    globalThis.puter = {
        services: undefined,
        util: { rpc: { send: (...a) => send(...a) } },
    };
    for (const fn of window.when_puter_happens) await fn();
});

beforeEach(() => {
    send = vi.fn();
    document.body.innerHTML = '';
    iframe = document.createElement('iframe');
    document.body.append(iframe);
    window.app_instance_ids = new Set(['inst-1']);
    window.iframe_for_app_instance = (id) => (id === 'inst-1' ? iframe : null);
    window.window_for_app_instance = () => document.body;
    globalThis.services = {
        get: () => ({
            get_by_uuid: () => ({ name: 'caller', uuid: 'inst-1' }),
        }),
    };
});

const post = (msg) =>
    window.dispatchEvent(
        new MessageEvent('message', {
            data: {
                $: 'puter-ipc',
                v: 2,
                appInstanceID: 'inst-1',
                env: 'app',
                msg,
                parameters: {},
                uuid: 'cb-1',
            },
            source: iframe.contentWindow,
            origin: 'https://app.example',
        }),
    );

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('registered IPC handlers', () => {
    it('answers the app when the handler returns', async () => {
        window.ipc_handlers.okHandler = { handler: async () => ({ ok: true }) };
        post('okHandler');
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('replies with a stable error when a handler throws', async () => {
        const unhandled = [];
        const onUnhandled = (e) => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('Launching this app is not allowed.');
        window.ipc_handlers.throwingHandler = {
            handler: async () => {
                throw failure;
            },
        };
        post('throwingHandler');
        await settle();
        process.off('unhandledRejection', onUnhandled);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            iframe.contentWindow,
            'cb-1',
            {
                $: 'puter-ipc-error',
                error: {
                    code: 'ipc_handler_failed',
                    message: 'The request could not be completed.',
                },
            },
        );
        expect(logged).toHaveBeenCalledWith(
            expect.stringContaining('throwingHandler'),
            failure,
        );
        expect(unhandled).toEqual([]);
        logged.mockRestore();
    });

    it('does not send an error reply when sending the result fails', async () => {
        const unhandled = [];
        const onUnhandled = (e) => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        send = vi.fn(() => {
            throw new Error('frame gone');
        });
        window.ipc_handlers.okHandler = { handler: async () => ({ ok: true }) };
        post('okHandler');
        await settle();
        process.off('unhandledRejection', onUnhandled);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            iframe.contentWindow,
            'cb-1',
            { ok: true },
        );
        expect(unhandled.map((e) => e.message)).toEqual(['frame gone']);
    });
});
