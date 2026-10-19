import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

let messageHandlers;
let parentWindow;
let clickedElement;

beforeEach(() => {
    messageHandlers = [];
    parentWindow = { postMessage: vi.fn() };
    clickedElement = { click: vi.fn() };
    globalThis.window = {
        parent: parentWindow,
        focus: vi.fn(),
        addEventListener: (name, handler) => {
            if ( name === 'message' ) messageHandlers.push(handler);
        },
        removeEventListener: () => {},
    };
    globalThis.document = {
        addEventListener: vi.fn(),
        elementFromPoint: vi.fn(() => clickedElement),
    };
    globalThis.puter = { defaultGUIOrigin: 'https://puter.com' };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.puter;
});

describe('app env host messages', () => {
    it.each([['https://other-app.puter.site', 0], ['https://puter.com', 1]])('checks parent origin %s', async (origin, clicks) => {
        new UIModule({
            env: 'app',
            authToken: 'token-1',
            APIOrigin: 'https://api.puter.com',
            appID: 'app-1',
            util: {},
        }, { appInstanceID: 'instance-1' });

        for ( const handler of [...messageHandlers] ) {
            await handler({
                source: parentWindow,
                origin,
                data: { msg: 'click', x: 10, y: 10 },
            });
        }

        expect(clickedElement.click).toHaveBeenCalledTimes(clicks);
    });
});
