import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $SCOPE } from '../lib/xdrpc.js';
import FSItem from './FSItem.js';
import { UtilRPC } from './Util.js';

const { UIModule } = await import('./UI.js');

const GUI_ORIGIN = 'https://puter.com';

let messageHandlers;
let hostPostMessage;
let host;

const listen = (name, handler) => {
    if ( name === 'message' ) messageHandlers.push(handler);
};

/** Deliver one message from the desktop to every listener registered so far. */
const fromHost = async (data) => {
    const event = { source: host, origin: GUI_ORIGIN, data };
    for ( const handler of [...messageHandlers] ) await handler(event);
};

const makePuter = (overrides = {}) => ({
    env: 'app',
    authToken: null,
    APIOrigin: 'https://api.test',
    appID: 'app-1',
    util: { rpc: new UtilRPC() },
    ...overrides,
});

const makeUI = (overrides) => new UIModule(makePuter(overrides), { appInstanceID: 'instance-1' });

/** The last message of this name the SDK posted to the desktop. */
const posted = (name) => hostPostMessage.mock.calls.findLast(([message]) => message.msg === name)?.[0];

/** Answers the SDK's last request the way the desktop does. */
const reply = (fields) => {
    const { uuid } = hostPostMessage.mock.calls.at(-1)[0];
    return fromHost({ original_msg_id: uuid, ...fields });
};

/** Answers the SDK's last IPC call. */
const replyIpc = (value) => {
    const { uuid } = hostPostMessage.mock.calls.at(-1)[0];
    return fromHost({ $SCOPE, id: uuid, args: [value] });
};

/** Waits for an IPC call, which posts a tick after it is made. */
const ipcPosted = async (method) => {
    await vi.waitFor(() => expect(posted(method)).toBeDefined());
    return posted(method);
};

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, Promise.resolve(PENDING)]);

beforeEach(() => {
    messageHandlers = [];
    hostPostMessage = vi.fn();
    host = { postMessage: hostPostMessage };
    globalThis.window = {
        parent: host,
        focus: vi.fn(),
        addEventListener: listen,
        removeEventListener: () => {},
    };
    globalThis.addEventListener = listen;
    globalThis.document = { addEventListener: vi.fn() };
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.addEventListener;
    delete globalThis.document;
    delete globalThis.puter;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('dialogs the desktop shows for an app', () => {
    it('alert() resolves to the button the user picked', async () => {
        const ui = makeUI();
        const buttons = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
        const result = ui.alert('Delete it?', buttons, { type: 'warning' });

        expect(posted('ALERT')).toMatchObject({
            env: 'app',
            appInstanceID: 'instance-1',
            message: 'Delete it?',
            buttons,
            options: { type: 'warning' },
        });
        await reply({ msg: 'alertResponded', response: 'yes' });
        await expect(result).resolves.toBe('yes');
    });

    it('prompt() resolves to what the user typed', async () => {
        const ui = makeUI();
        const result = ui.prompt('Name?', 'Untitled', { defaultValue: 'a.txt' });

        expect(posted('PROMPT')).toMatchObject({
            message: 'Name?',
            placeholder: 'Untitled',
            options: { defaultValue: 'a.txt' },
        });
        await reply({ msg: 'promptResponded', response: 'b.txt' });
        await expect(result).resolves.toBe('b.txt');
    });

    it('notify() sends the camelCase roundIcon as round_icon and resolves to the uid', async () => {
        const ui = makeUI();
        const result = ui.notify({ title: 'Done', roundIcon: true });

        expect(posted('showNotification').options).toEqual({
            title: 'Done',
            roundIcon: true,
            round_icon: true,
        });
        await reply({ msg: 'notificationShown', uid: 'n-1' });
        await expect(result).resolves.toBe('n-1');
    });

    it('notify() keeps an explicit round_icon and sends empty options when called bare', async () => {
        const ui = makeUI();
        ui.notify({ roundIcon: true, round_icon: false });
        expect(posted('showNotification').options.round_icon).toBe(false);

        ui.notify();
        expect(posted('showNotification').options).toEqual({});
    });

    it('showFontPicker() resolves to the font the user chose', async () => {
        const ui = makeUI();
        const result = ui.showFontPicker({ defaultFont: 'Arial' });

        expect(posted('showFontPicker').options).toEqual({ defaultFont: 'Arial' });
        await reply({ msg: 'fontPicked', font: { fontFamily: 'Georgia' } });
        await expect(result).resolves.toEqual({ fontFamily: 'Georgia' });
    });

    it('showColorPicker() resolves to the color the user chose', async () => {
        const ui = makeUI();
        const result = ui.showColorPicker();

        expect(posted('showColorPicker').options).toEqual({});
        await reply({ msg: 'colorPicked', color: '#ff0000' });
        await expect(result).resolves.toBe('#ff0000');
    });

    it('getLanguage() resolves to the desktop language', async () => {
        const ui = makeUI();
        const result = ui.getLanguage();

        expect(posted('getLanguage')).toBeDefined();
        await reply({ msg: 'languageReceived', language: 'fr' });
        await expect(result).resolves.toBe('fr');
    });

    it('socialShare() resolves to whatever the desktop replies', async () => {
        const ui = makeUI();
        const result = ui.socialShare('https://example.com', 'Look', { left: 10, top: 20 });

        expect(posted('socialShare')).toMatchObject({
            url: 'https://example.com',
            message: 'Look',
            options: { left: 10, top: 20 },
        });
        await reply({ msg: 'socialShareDone' });
        await expect(result).resolves.toMatchObject({ msg: 'socialShareDone' });
    });

    it('openDevPaymentsAccount() resolves once the desktop acknowledges', async () => {
        const ui = makeUI();
        const result = ui.openDevPaymentsAccount();

        expect(posted('openDevPaymentsAccount')).toBeDefined();
        await expect(settled(result)).resolves.toBe(PENDING);
        await reply({ msg: 'devPaymentsAccountOpened' });
        await expect(result).resolves.toMatchObject({ msg: 'devPaymentsAccountOpened' });
    });

    it.each([
        [{ response: true }, true],
        [{ response: false }, false],
        [{}, false],
    ])('requestVerificationGate() reads the reply %j as %s', async (answer, expected) => {
        const ui = makeUI();
        const result = ui.requestVerificationGate('phone_verification_required', { factors: ['phone', 'card'] });

        expect(posted('requestVerificationGate')).toMatchObject({
            code: 'phone_verification_required',
            factors: ['phone', 'card'],
        });
        await reply({ msg: 'verificationGateDone', ...answer });
        await expect(result).resolves.toBe(expected);
    });

    it('requestPermission() resolves to what the desktop granted', async () => {
        const ui = makeUI();
        const result = ui.requestPermission({ permission: 'fs:/alice/docs:read' });

        await vi.waitFor(() => expect(posted('requestPermission')).toBeDefined());
        expect(posted('requestPermission').options).toEqual({ permission: 'fs:/alice/docs:read' });
        await reply({ granted: true });
        await expect(result).resolves.toBe(true);
    });

    it('requestPermission() resolves false for anything but a grant', async () => {
        const ui = makeUI();
        const result = ui.requestPermission({ permission: 'fs:/alice/docs:read' });

        await vi.waitFor(() => expect(posted('requestPermission')).toBeDefined());
        await reply({ granted: 'yes' });
        await expect(result).resolves.toBe(false);
    });
});

describe('desktop features an app can ask for', () => {
    const launchedWith = (features) => {
        vi.stubGlobal('location', { search: `?puter.gui_features=${features}` });
        return makeUI();
    };

    it('showFeedbackDialog() resolves false on a desktop without the dialog', async () => {
        const ui = launchedWith('enable-push');

        await expect(ui.showFeedbackDialog()).resolves.toBe(false);
        expect(posted('showFeedbackDialog')).toBeUndefined();
    });

    it.each([
        [{ sent: true }, true],
        [{ sent: false }, false],
    ])('showFeedbackDialog() reads the reply %j as %s', async (answer, expected) => {
        const ui = launchedWith('feedback-dialog');
        const result = ui.showFeedbackDialog();

        await vi.waitFor(() => expect(posted('showFeedbackDialog')).toBeDefined());
        await reply(answer);
        await expect(result).resolves.toBe(expected);
    });
});

describe('window controls', () => {
    it('createWindow() resolves to the handle of the new window', async () => {
        const ui = makeUI();
        const result = ui.createWindow({ title: 'Inspector', width: 300 });

        expect(posted('createWindow').options).toEqual({ title: 'Inspector', width: 300 });
        await reply({ window: { id: 'window-2' } });
        await expect(result).resolves.toEqual({ id: 'window-2' });
    });

    it('createWindow() sends empty options when called bare', () => {
        makeUI().createWindow();
        expect(posted('createWindow').options).toEqual({});
    });

    const SETTERS = [
        ['setWindowTitle', ['Notes'], { new_title: 'Notes' }],
        ['setWindowWidth', [640], { width: 640 }],
        ['setWindowHeight', [480], { height: 480 }],
        ['setWindowSize', [640, 480], { width: 640, height: 480 }],
        ['setWindowPosition', [10, 20], { x: 10, y: 20 }],
        ['setWindowX', [10], { x: 10 }],
        ['setWindowY', [20], { y: 20 }],
    ];

    it.each(SETTERS)('%s() targets the main window by default', async (method, args, fields) => {
        const ui = makeUI();
        const result = ui[method](...args);

        const message = posted(method);
        expect(message).toMatchObject(fields);
        expect(message.window_id).toBeUndefined();
        await reply({ msg: `${method}Done` });
        await expect(result).resolves.toMatchObject({ msg: `${method}Done` });
    });

    it.each(SETTERS)('%s() targets a window by id', (method, args, fields) => {
        makeUI()[method](...args, 'window-2');
        expect(posted(method)).toMatchObject({ ...fields, window_id: 'window-2' });
    });

    it.each(SETTERS)('%s() targets a window by its handle', (method, args, fields) => {
        makeUI()[method](...args, { id: 'window-2' });
        expect(posted(method)).toMatchObject({ ...fields, window_id: 'window-2' });
    });

    it.each(SETTERS)('%s() takes a legacy callback in place of the window', (method, args, fields) => {
        makeUI()[method](...args, () => {});

        const message = posted(method);
        expect(message).toMatchObject(fields);
        expect(message.window_id).toBeUndefined();
    });

    it.each(['showWindow', 'hideWindow', 'toggleWindow'])('%s() tells the desktop which app asked', (method) => {
        makeUI()[method]();
        expect(posted(method)).toEqual({
            msg: method,
            env: 'app',
            appInstanceID: 'instance-1',
            value: undefined,
        });
    });
});

describe('menus', () => {
    it.each([
        ['disableMenuItem', ['save'], { id: 'save' }],
        ['enableMenuItem', ['save'], { id: 'save' }],
        ['setMenuItemIcon', ['save', 'data:image/png;base64,AA'], { id: 'save', icon: 'data:image/png;base64,AA' }],
        ['setMenuItemIconActive', ['save', 'data:image/png;base64,BB'], { id: 'save', icon: 'data:image/png;base64,BB' }],
        ['setMenuItemChecked', ['wrap', true], { id: 'wrap', checked: true }],
    ])('%s() names the item', (method, args, value) => {
        makeUI()[method](...args);
        expect(posted(method).value).toEqual(value);
    });

    it.each(['setMenubar', 'contextMenu'])('%s() runs an item action when the desktop reports the click', async (method) => {
        const save = vi.fn();
        makeUI()[method]({
            items: [
                { label: 'File', items: [{ label: 'Save', action: save }, '-'] },
            ],
        });

        const { value } = posted(method);
        const [file] = value.items;
        expect(file.label).toBe('File');
        expect(file.items[1]).toBe('-');
        // Functions can't cross postMessage; the desktop gets a callback id.
        expect(file.items[0].action).toEqual({ $SCOPE, id: expect.any(String) });

        await fromHost({ $SCOPE, id: file.items[0].action.id, args: [] });
        expect(save).toHaveBeenCalledOnce();
    });

    it('ignores a menu click reported by another window', async () => {
        const save = vi.fn();
        makeUI().setMenubar({ items: [{ label: 'Save', action: save }] });
        const { id } = posted('setMenubar').value.items[0].action;

        const event = { source: {}, origin: GUI_ORIGIN, data: { $SCOPE, id, args: [] } };
        for ( const handler of [...messageHandlers] ) await handler(event);

        expect(save).not.toHaveBeenCalled();
    });
});

describe('pickers inside the desktop', () => {
    beforeEach(() => {
        globalThis.open = vi.fn();
    });

    afterEach(() => {
        delete globalThis.open;
    });

    const entry = (name) => ({ uid: `uid-${name}`, name, path: `/alice/${name}` });

    it('showOpenFilePicker() resolves to every file of a multiple selection', async () => {
        const ui = makeUI();
        const result = ui.showOpenFilePicker({ multiple: true, accept: 'image/*' });

        expect(posted('showOpenFilePicker').options).toEqual({ multiple: true, accept: 'image/*' });
        await reply({ msg: 'fileOpenPicked', items: [entry('a.png'), entry('b.png')] });

        const items = await result;
        expect(items).toHaveLength(2);
        expect(items.every((item) => item instanceof FSItem)).toBe(true);
        expect(items.map((item) => item.name)).toEqual(['a.png', 'b.png']);
    });

    it('showDirectoryPicker() resolves to every folder of a multiple selection', async () => {
        const ui = makeUI();
        const result = ui.showDirectoryPicker({ multiple: true });

        expect(posted('showDirectoryPicker').options).toEqual({ multiple: true });
        await reply({ msg: 'directoryPicked', items: [entry('Docs'), entry('Music')] });

        const items = await result;
        expect(items.map((item) => item.path)).toEqual(['/alice/Docs', '/alice/Music']);
        expect(items.every((item) => item instanceof FSItem)).toBe(true);
    });

    it('showSaveFilePicker() sends the content and the suggested name', async () => {
        const ui = makeUI();
        const result = ui.showSaveFilePicker('hello', 'a.txt');

        expect(posted('showSaveFilePicker')).toMatchObject({
            content: 'hello',
            suggestedName: 'a.txt',
            save_type: undefined,
            url: undefined,
            source_path: undefined,
        });
        await reply({ msg: 'fileSaved', saved_file: entry('a.txt') });
        await expect(result).resolves.toMatchObject({ name: 'a.txt', path: '/alice/a.txt' });
    });

    it('showSaveFilePicker() sends a URL object as a URL to fetch, not as content', () => {
        makeUI().showSaveFilePicker(new URL('https://example.com/cat.png'));

        expect(posted('showSaveFilePicker')).toMatchObject({
            save_type: 'url',
            url: 'https://example.com/cat.png',
            content: undefined,
            suggestedName: '',
        });
    });

    it.each(['move', 'copy'])('showSaveFilePicker() sends the source path for a %s', (type) => {
        makeUI().showSaveFilePicker('/alice/a.txt', 'a.txt', type);

        expect(posted('showSaveFilePicker')).toMatchObject({
            save_type: type,
            source_path: '/alice/a.txt',
        });
    });
});

describe('pickers where no window can open', () => {
    it.each([
        ['showOpenFilePicker', (ui) => ui.showOpenFilePicker()],
        ['showDirectoryPicker', (ui) => ui.showDirectoryPicker()],
        ['showSaveFilePicker', (ui) => ui.showSaveFilePicker('hello', 'a.txt')],
    ])('%s() rejects', async (_name, open) => {
        const ui = makeUI();

        await expect(open(ui)).rejects.toBe('This API is not compatible in Web Workers.');
        expect(hostPostMessage.mock.calls.map(([message]) => message.msg)).toEqual(['READY']);
    });
});

describe('picture-in-picture', () => {
    beforeEach(() => {
        vi.stubGlobal('location', { href: 'https://app-1.puter.site/index.html', search: '' });
    });

    it('opens the page resolved against the app, at the requested size', async () => {
        const ui = makeUI();
        const result = ui.requestPictureInPicture({ url: 'pip.html', width: 320, height: 180 });

        const message = await ipcPosted('requestPictureInPicture');
        expect(message).toMatchObject({
            $: 'puter-ipc',
            appInstanceID: 'instance-1',
            parameters: { url: 'https://app-1.puter.site/pip.html', width: 320, height: 180 },
        });
        await replyIpc({ ok: true });
        await expect(result).resolves.toBeUndefined();
    });

    it('runs onClose once when the user closes the window', async () => {
        const ui = makeUI();
        const onClose = vi.fn();
        const result = ui.requestPictureInPicture({ url: 'pip.html', onClose });
        await ipcPosted('requestPictureInPicture');
        await replyIpc({ ok: true });
        await result;

        await fromHost({ msg: 'pictureInPictureClosed' });
        await fromHost({ msg: 'pictureInPictureClosed' });

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not run onClose for a window the app closed itself', async () => {
        const ui = makeUI();
        const onClose = vi.fn();
        const opened = ui.requestPictureInPicture({ url: 'pip.html', onClose });
        await ipcPosted('requestPictureInPicture');
        await replyIpc({ ok: true });
        await opened;

        const exited = ui.exitPictureInPicture();
        await ipcPosted('exitPictureInPicture');
        await replyIpc({ wasOpen: true });
        await expect(exited).resolves.toBe(true);
        await fromHost({ msg: 'pictureInPictureClosed' });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('rejects with the error the desktop names', async () => {
        const ui = makeUI();
        const result = ui.requestPictureInPicture({ url: 'https://other.test/pip.html' });
        const rejection = expect(result).rejects.toMatchObject({
            name: 'SecurityError',
            message: 'The page is not on this app\'s origin.',
        });
        await ipcPosted('requestPictureInPicture');
        await replyIpc({ ok: false, error: { name: 'SecurityError', message: 'The page is not on this app\'s origin.' } });

        await rejection;
    });

    it('rejects as not allowed when the desktop gives no reason', async () => {
        const ui = makeUI();
        const result = ui.requestPictureInPicture({ url: 'pip.html' });
        const rejection = expect(result).rejects.toMatchObject({
            name: 'NotAllowedError',
            message: 'Could not open a picture-in-picture window.',
        });
        await ipcPosted('requestPictureInPicture');
        await replyIpc({ ok: false });

        await rejection;
    });

    it('rejects a url that is not one, without asking the desktop', async () => {
        vi.stubGlobal('location', { search: '' });
        const ui = makeUI();

        await expect(ui.requestPictureInPicture({ url: 'pip.html' })).rejects.toMatchObject({
            name: 'TypeError',
            message: '`url` must be a URL.',
        });
        expect(posted('requestPictureInPicture')).toBeUndefined();
    });

    it('is not supported on a website', async () => {
        const ui = makeUI({ env: 'web' });

        await expect(ui.requestPictureInPicture({ url: 'pip.html' })).rejects.toMatchObject({
            name: 'NotSupportedError',
        });
        await expect(ui.exitPictureInPicture()).resolves.toBe(false);
    });

    it('names the error the same way where there is no DOMException', async () => {
        vi.stubGlobal('DOMException', undefined);
        const ui = makeUI({ env: 'web' });

        const result = ui.requestPictureInPicture({ url: 'pip.html' });
        await expect(result).rejects.toBeInstanceOf(Error);
        await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
    });
});

describe('environments with no desktop to ask', () => {
    it('getLanguage() reads the locale inside the GUI itself', async () => {
        globalThis.window.locale = 'de';
        const ui = makeUI({ env: 'gui' });

        await expect(ui.getLanguage()).resolves.toBe('de');
        expect(hostPostMessage).not.toHaveBeenCalled();
    });

    it('authenticateWithPuter() does nothing outside a website', () => {
        expect(makeUI().authenticateWithPuter()).toBeUndefined();
    });

    it('showFeedbackDialog() resolves false in a worker', async () => {
        await expect(makeUI({ env: 'web-worker' }).showFeedbackDialog()).resolves.toBe(false);
    });
});
