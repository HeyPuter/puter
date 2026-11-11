// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));
globalThis.$ = globalThis.jQuery = jQuery;

const { stub, uiWindow, uiAlert } = vi.hoisted(() => ({
    stub: () => ({ default: () => {} }),
    uiWindow: vi.fn(),
    uiAlert: vi.fn(),
}));
vi.mock('./helpers/itemIcon.js', stub);
vi.mock('./helpers/socialLink.js', stub);
vi.mock('./helpers/updateMousePosition.js', stub);
vi.mock('./UI/UIAlert.js', () => ({ default: uiAlert }));
vi.mock('./UI/UIContextMenu.js', stub);
vi.mock('./UI/UIItem.js', stub);
vi.mock('./UI/UIPopover.js', stub);
vi.mock('./UI/UIPrompt.js', stub);
vi.mock('./UI/UIWindow.js', () => ({ default: uiWindow }));
vi.mock('./UI/UIWindowAppFeedback.js', stub);
vi.mock('./UI/UIWindowAttachCustomDomain.js', stub);
vi.mock('./UI/UIWindowColorPicker.js', stub);
vi.mock('./UI/UIWindowEmailConfirmationRequired.js', stub);
vi.mock('./UI/UIWindowFontPicker.js', stub);
vi.mock('./UI/UIPermissionDialog.js', stub);
vi.mock('./UI/UIEnablePushDialog.js', stub);
vi.mock('./UI/UIWindowSaveAccount.js', stub);
vi.mock('./UI/Auth/UIAuthSignup.js', stub);
vi.mock('./UI/UINotification.js', stub);
vi.mock('./helpers/godmodeTokens.js', () => ({ renewGodmodeToken: vi.fn() }));
vi.mock('./helpers/watchItems.js', () => ({ addItemWatcher: vi.fn() }));
vi.mock('./helpers/verification_gates.js', () => ({ openVerificationGateWindow: vi.fn() }));

let iframe;
let posted;
let dialogOpts;
let written;
const realFetch = globalThis.fetch;

const readText = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file);
});

beforeAll(async () => {
    window.when_puter_happens = [];
    window.appCallbackFunctions = {};
    await import('./IPC.js');
    globalThis.puter = {
        services: undefined,
        util: { rpc: { send: vi.fn() } },
        fs: {
            write: vi.fn(async (target, file) => {
                written.push({ target, text: await readText(file) });
                return { uid: 'file-1', name: 'r.txt', path: target };
            }),
            sign: vi.fn(async () => ({
                items: { fsentry_name: 'r.txt', uid: 'file-1', read_url: 'r', write_url: 'w', metadata_url: 'm', type: 'text/plain' },
            })),
        },
    };
    for ( const fn of window.when_puter_happens ) await fn();
});

beforeEach(() => {
    uiWindow.mockReset();
    uiWindow.mockImplementation(async (opts) => {
        dialogOpts = opts;
    });
    uiAlert.mockReset();
    uiAlert.mockResolvedValue(undefined);
    document.body.innerHTML = '<div class="window" data-app_uuid="app-1"><div class="window-disable-mask"></div></div>';
    iframe = document.createElement('iframe');
    iframe.setAttribute('data-app', 'saver');
    document.body.append(iframe);
    posted = [];
    written = [];
    iframe.contentWindow.postMessage = (data) => posted.push(data);
    window.app_instance_ids = new Set(['inst-1']);
    window.iframe_for_app_instance = (id) => (id === 'inst-1' ? iframe : null);
    window.window_for_app_instance = () => document.querySelector('.window');
    window.is_auth = () => true;
    window.user = { username: 'u', email: 'u@example.com', email_confirmed: true };
    window.busy_indicator_hide_delay = 0;
    window.sort_items = () => {};
    window.show_save_account_notice_if_needed = () => {};
    window.privacy_aware_path = (p) => p;
    window.handle_same_name_exists = async ({ action }) => {
        try {
            await action({ overwrite: false });
            return true;
        } catch {
            return false;
        }
    };
    globalThis.i18n = (k) => k;
    // A closing dialog is removed from the page, which runs its on_close.
    jQuery.fn.close = function () {
        dialogOpts.on_close?.();
        return this;
    };
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

const settle = () => new Promise((r) => setTimeout(r, 20));

const openPicker = async (data) => {
    window.dispatchEvent(new MessageEvent('message', {
        data: { msg: 'showSaveFilePicker', appInstanceID: 'inst-1', env: 'app', uuid: 7, suggestedName: 'r.txt', ...data },
        source: iframe.contentWindow,
        origin: 'https://saver.example',
    }));
    await settle();
    expect(dialogOpts).toBeTruthy();
};

const save = async () => {
    await dialogOpts.onSaveFileDialogSave('/u/Desktop/r.txt', document.createElement('div'));
    await settle();
};

const replies = () => posted.filter((m) => m.original_msg_id === 7).map((m) => m.msg);

describe('showSaveFilePicker in an app', () => {
    it('downloads a url without credentials, saves its bytes and answers fileSaved', async () => {
        globalThis.fetch = vi.fn(async () => new Response('robots body'));
        await openPicker({ url: 'https://example.com/robots.txt', save_type: 'url' });
        await save();

        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/robots.txt', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
        expect(written).toEqual([{ target: '/u/Desktop/r.txt', text: 'robots body' }]);
        expect(replies()).toEqual(['fileSaved']);
    });

    it('alerts and answers fileSaveCancelled when the url cannot be downloaded', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        await openPicker({ url: 'https://example.com/robots.txt', save_type: 'url' });
        await save();

        expect(uiAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'url_save_failed' }));
        expect(written).toEqual([]);
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('refuses a non-http url without fetching it', async () => {
        globalThis.fetch = vi.fn();
        await openPicker({ url: 'data:text/plain,hi', save_type: 'url' });
        await save();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(uiAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'url_save_invalid_url' }));
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('saves content and answers once', async () => {
        await openPicker({ content: 'hello' });
        await save();

        expect(written).toEqual([{ target: '/u/Desktop/r.txt', text: 'hello' }]);
        expect(replies()).toEqual(['fileSaved']);
    });

    it('answers fileSaveCancelled when a content write fails and the dialog closes', async () => {
        puter.fs.write.mockRejectedValueOnce(Object.assign(new Error('Storage full'), { code: 'storage_limit_reached' }));
        await openPicker({ content: 'hello' });
        await save();

        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('answers fileSaveCancelled once when the dialog is cancelled, then closed', async () => {
        await openPicker({ content: 'hello' });
        dialogOpts.onDialogCancel();
        dialogOpts.on_close();
        await settle();

        expect(replies()).toEqual(['fileSaveCancelled']);
    });
});
