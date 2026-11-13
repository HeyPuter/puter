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
let saveErrors;
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
    saveErrors = [];
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
        } catch ( err ) {
            saveErrors.push(err);
            return false;
        }
    };
    globalThis.i18n = (k) => k;
    jQuery.fn.removeItems = function () {
        return this;
    };
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

    it('answers fileSaveCancelled when the dialog is closed without saving', async () => {
        await openPicker({ content: 'hello' });
        dialogOpts.on_close();
        await settle();

        expect(written).toEqual([]);
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('answers only fileSaved when the dialog closes while the write is in flight', async () => {
        let release;
        puter.fs.write.mockImplementationOnce(async (target, file) => {
            await new Promise((r) => {
                release = r;
            });
            written.push({ target, text: await readText(file) });
            return { uid: 'file-1', name: 'r.txt', path: target };
        });
        await openPicker({ content: 'hello' });
        const saving = save();
        await settle();
        dialogOpts.on_close();
        release();
        await saving;

        expect(written).toEqual([{ target: '/u/Desktop/r.txt', text: 'hello' }]);
        expect(replies()).toEqual(['fileSaved']);
    });

    it('answers fileSaveCancelled once when the dialog closes while a write that fails is in flight', async () => {
        let fail;
        puter.fs.write.mockImplementationOnce(() => new Promise((resolve, reject) => {
            fail = () => reject(Object.assign(new Error('Storage full'), { code: 'storage_limit_reached' }));
        }));
        await openPicker({ content: 'hello' });
        const saving = save();
        await settle();
        dialogOpts.on_close();
        expect(replies()).toEqual([]);
        fail();
        await saving;

        expect(saveErrors).toEqual([]);
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('stops the download and writes nothing when the dialog closes while the url is downloading', async () => {
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
        }));
        await openPicker({ url: 'https://example.com/big.bin', save_type: 'url' });
        const saving = save();
        await settle();
        dialogOpts.on_close();
        await saving;

        expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(written).toEqual([]);
        expect(uiAlert).not.toHaveBeenCalled();
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('writes nothing when the dialog closes before the overwrite is confirmed', async () => {
        let confirm;
        window.handle_same_name_exists = async ({ action }) => {
            await new Promise((r) => {
                confirm = r;
            });
            await action({ overwrite: true });
            return true;
        };
        await openPicker({ content: 'hello' });
        const saving = save();
        await settle();
        dialogOpts.on_close();
        confirm();
        await saving;

        expect(written).toEqual([]);
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('alerts and answers fileSaveCancelled when the save throws', async () => {
        puter.fs.stat = vi.fn(async () => {
            throw Object.assign(new Error('Not found'), { code: 'subject_does_not_exist' });
        });
        await openPicker({ source_path: '/u/AppData/app-1/a.txt', save_type: 'copy' });
        await save();

        expect(uiAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not found' }));
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('ignores a second save while one is running', async () => {
        let release;
        puter.fs.write.mockImplementationOnce(async (target, file) => {
            await new Promise((r) => {
                release = r;
            });
            written.push({ target, text: await readText(file) });
            return { uid: 'file-1', name: 'r.txt', path: target };
        });
        await openPicker({ content: 'hello' });
        const first = save();
        await settle();
        await save();
        release();
        await first;

        expect(written).toHaveLength(1);
        expect(replies()).toEqual(['fileSaved']);
    });

    it('finishes the save quietly when the app window is gone', async () => {
        let release;
        puter.fs.write.mockImplementationOnce(async (target) => {
            await new Promise((r) => {
                release = r;
            });
            return { uid: 'file-1', name: 'r.txt', path: target };
        });
        await openPicker({ content: 'hello' });
        const saving = save();
        await settle();
        // A removed iframe has no contentWindow.
        Object.defineProperty(iframe, 'contentWindow', { value: null });
        release();
        await saving;

        expect(saveErrors).toEqual([]);
        expect(uiAlert).not.toHaveBeenCalled();
    });

    it('retries signing the written file once and answers fileSaved', async () => {
        puter.fs.sign.mockRejectedValueOnce(new Error('Sign failed'));
        await openPicker({ content: 'hello' });
        await save();

        expect(puter.fs.sign).toHaveBeenLastCalledWith('app-1', { uid: 'file-1', action: 'write' });
        expect(written).toEqual([{ target: '/u/Desktop/r.txt', text: 'hello' }]);
        expect(uiAlert).not.toHaveBeenCalled();
        expect(replies()).toEqual(['fileSaved']);
    });

    it('says the file was saved and answers fileSaveCancelled when it cannot be signed', async () => {
        puter.fs.sign.mockRejectedValueOnce(new Error('Sign failed')).mockRejectedValueOnce(new Error('Sign failed'));
        await openPicker({ content: 'hello' });
        await save();

        expect(written).toEqual([{ target: '/u/Desktop/r.txt', text: 'hello' }]);
        expect(uiAlert).toHaveBeenCalledTimes(1);
        expect(uiAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'save_file_not_returned' }));
        expect(saveErrors).toEqual([]);
        expect(replies()).toEqual(['fileSaveCancelled']);
    });

    it('refuses an http url when the desktop is served over https', async () => {
        vi.stubGlobal('location', { protocol: 'https:' });
        try {
            globalThis.fetch = vi.fn();
            await openPicker({ url: 'http://example.com/a.txt', save_type: 'url' });
            await save();
        } finally {
            vi.unstubAllGlobals();
        }

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(uiAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'url_save_https_only' }));
        expect(replies()).toEqual(['fileSaveCancelled']);
    });
});
