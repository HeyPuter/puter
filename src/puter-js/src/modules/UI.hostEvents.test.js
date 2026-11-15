import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FSItem from './FSItem.js';

const { UIModule } = await import('./UI.js');

const GUI_ORIGIN = 'https://puter.com';

let windowListeners;
let documentListeners;
let hostPostMessage;
let host;
// What the page has under each point the desktop names.
let elementsAt;

const collect = (listeners) => (name, handler) => {
    (listeners[name] ??= []).push(handler);
};

/** Deliver one message from the desktop to every listener registered so far. */
const fromHost = async (data) => {
    const event = { source: host, origin: GUI_ORIGIN, data };
    for ( const handler of [...windowListeners.message] ) await handler(event);
};

const makeUI = () =>
    new UIModule({
        env: 'app',
        authToken: null,
        APIOrigin: 'https://api.test',
        appID: 'app-1',
        util: {},
    }, { appInstanceID: 'instance-1' });

const posted = (name) => hostPostMessage.mock.calls.findLast(([message]) => message.msg === name)?.[0];

/** An element that records the events dispatched on it. */
const makeElement = () => {
    const element = new EventTarget();
    element.click = vi.fn();
    element.events = [];
    for ( const name of ['dragenter', 'dragleave', 'drop'] ) {
        element.addEventListener(name, (event) => element.events.push(event));
    }
    return element;
};

const eventNames = (element) => element.events.map((event) => event.type);

beforeEach(() => {
    windowListeners = {};
    documentListeners = {};
    elementsAt = new Map();
    hostPostMessage = vi.fn();
    host = { postMessage: hostPostMessage };
    globalThis.window = {
        parent: host,
        focus: vi.fn(),
        addEventListener: collect(windowListeners),
        removeEventListener: () => {},
    };
    globalThis.document = {
        addEventListener: collect(documentListeners),
        elementFromPoint: (x, y) => elementsAt.get(`${x},${y}`) ?? null,
    };
    globalThis.puter = { defaultGUIOrigin: GUI_ORIGIN };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.puter;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('focus', () => {
    it('focuses the app window when the desktop asks', async () => {
        makeUI();

        await fromHost({ msg: 'focus' });

        expect(window.focus).toHaveBeenCalledOnce();
    });

    it('tells the desktop when the app window gains focus', () => {
        makeUI();
        hostPostMessage.mockClear();

        for ( const handler of windowListeners.focus ) handler({});

        expect(hostPostMessage).toHaveBeenCalledWith({
            msg: 'windowFocused',
            appInstanceID: 'instance-1',
        }, '*');
    });
});

describe('pointer position', () => {
    it.each([
        ['mousemove', 'mouseMoved'],
        ['click', 'mouseClicked'],
    ])('reports a %s to the desktop', (eventName, msg) => {
        const ui = makeUI();

        for ( const handler of documentListeners[eventName] ) handler({ clientX: 120, clientY: 45 });

        expect(posted(msg)).toEqual({ msg, appInstanceID: 'instance-1', x: 120, y: 45 });
        expect(ui.mouseX).toBe(120);
        expect(ui.mouseY).toBe(45);
    });
});

describe('pointer events the desktop relays', () => {
    it('clicks the element under a click', async () => {
        makeUI();
        const button = makeElement();
        elementsAt.set('10,20', button);

        await fromHost({ msg: 'click', x: 10, y: 20 });

        expect(button.click).toHaveBeenCalledOnce();
    });

    it('does nothing for a click over no element', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        makeUI();

        await fromHost({ msg: 'click', x: 10, y: 20 });

        expect(error).not.toHaveBeenCalled();
    });

    it('enters an element once while a drag stays over it', async () => {
        makeUI();
        const zone = makeElement();
        elementsAt.set('10,20', zone);
        elementsAt.set('11,20', zone);

        await fromHost({ msg: 'drag', x: 10, y: 20 });
        await fromHost({ msg: 'drag', x: 11, y: 20 });

        expect(eventNames(zone)).toEqual(['dragenter']);
        expect(zone.events[0].bubbles).toBe(true);
    });

    it('leaves the last element when a drag moves to another', async () => {
        makeUI();
        const first = makeElement();
        const second = makeElement();
        elementsAt.set('10,20', first);
        elementsAt.set('200,20', second);

        await fromHost({ msg: 'drag', x: 10, y: 20 });
        await fromHost({ msg: 'drag', x: 200, y: 20 });

        expect(eventNames(first)).toEqual(['dragenter', 'dragleave']);
        expect(eventNames(second)).toEqual(['dragenter']);
    });

    it('leaves the last element when a drag moves off every element', async () => {
        makeUI();
        const zone = makeElement();
        elementsAt.set('10,20', zone);

        await fromHost({ msg: 'drag', x: 10, y: 20 });
        await fromHost({ msg: 'drag', x: 900, y: 900 });

        expect(eventNames(zone)).toEqual(['dragenter', 'dragleave']);
    });

    it('drops the dragged items on the element last dragged over', async () => {
        makeUI();
        const zone = makeElement();
        elementsAt.set('10,20', zone);
        const items = [{ uid: 'uid-1', name: 'a.txt' }];

        await fromHost({ msg: 'drag', x: 10, y: 20 });
        await fromHost({ msg: 'drop', x: 12, y: 22, items });
        await fromHost({ msg: 'drop', x: 12, y: 22, items });

        const drops = zone.events.filter((event) => event.type === 'drop');
        expect(drops).toHaveLength(1);
        expect(drops[0].detail).toEqual({ clientX: 12, clientY: 22, items });
        expect(drops[0].bubbles).toBe(true);
    });

    it('ignores a drop that no drag preceded', async () => {
        makeUI();
        const zone = makeElement();
        elementsAt.set('10,20', zone);

        await fromHost({ msg: 'drop', x: 10, y: 20, items: [] });

        expect(zone.events).toEqual([]);
    });
});

describe('closing the window', () => {
    it('lets the desktop close a window nobody is guarding', async () => {
        makeUI();

        await fromHost({ msg: 'windowWillClose', msg_id: 7 });

        expect(hostPostMessage).toHaveBeenLastCalledWith({
            msg: true,
            appInstanceID: 'instance-1',
            original_msg_id: 7,
        }, '*');
    });

    it('holds the window open and runs the onWindowClose handler', async () => {
        const ui = makeUI();
        const onClose = vi.fn();
        ui.onWindowClose(onClose);

        await fromHost({ msg: 'windowWillClose', msg_id: 7 });

        expect(hostPostMessage).toHaveBeenLastCalledWith({
            msg: false,
            appInstanceID: 'instance-1',
            original_msg_id: 7,
        }, '*');
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('items opened with a running app', () => {
    beforeEach(() => {
        vi.stubGlobal('location', { search: '' });
    });

    it('tells the desktop nobody handles them when there is no handler', async () => {
        makeUI();

        await fromHost({ msg: 'itemsOpened', msg_id: 3, items: [{ uid: 'uid-1', name: 'a.txt' }] });

        expect(hostPostMessage).toHaveBeenLastCalledWith({
            msg: true,
            appInstanceID: 'instance-1',
            original_msg_id: 3,
        }, '*');
    });

    it('hands the items to the onItemsOpened handler', async () => {
        const ui = makeUI();
        const onItems = vi.fn();
        ui.onItemsOpened(onItems);

        await fromHost({
            msg: 'itemsOpened',
            msg_id: 3,
            items: [
                { uid: 'uid-1', name: 'a.txt', path: '/alice/a.txt' },
                { uid: 'uid-2', name: 'Docs', path: '/alice/Docs', is_dir: true },
            ],
        });

        expect(hostPostMessage).toHaveBeenLastCalledWith({
            msg: false,
            appInstanceID: 'instance-1',
            original_msg_id: 3,
        }, '*');
        const [items] = onItems.mock.calls[0];
        expect(items.every((item) => item instanceof FSItem)).toBe(true);
        expect(items.map((item) => [item.name, item.isDirectory])).toEqual([
            ['a.txt', false],
            ['Docs', true],
        ]);
    });

    it('hands the handler an empty list when nothing was opened', async () => {
        const ui = makeUI();
        const onItems = vi.fn();
        ui.onItemsOpened(onItems);

        await fromHost({ msg: 'itemsOpened', msg_id: 3, items: [] });

        expect(onItems).toHaveBeenCalledWith([]);
    });
});

describe('the item an app was launched with', () => {
    it('reads a relative path as one under the home directory', () => {
        vi.stubGlobal('location', {
            search: '?puter.item.name=a.txt&puter.item.uid=uid-1&puter.item.path=Desktop%2Fa.txt'
                + `&puter.item.read_url=${encodeURIComponent('https://api.test/file?uid=uid-1')}`,
        });
        const launched = vi.fn();
        makeUI().onLaunchedWithItems(launched);

        expect(launched.mock.calls[0][0][0].path).toBe('~/Desktop/a.txt');
    });
});

describe('broadcasts', () => {
    it('ignores a broadcast it has no event for', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ui = makeUI();
        const onLocale = vi.fn();
        ui.on('localeChanged', onLocale);

        await fromHost({ msg: 'broadcast', name: 'wallpaperChanged', data: { url: 'x' } });

        expect(onLocale).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});
