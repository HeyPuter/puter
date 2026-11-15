// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterAlert from '../ui/components/PuterAlert.js';
import PuterColorPicker from '../ui/components/PuterColorPicker.js';
import PuterFontPicker from '../ui/components/PuterFontPicker.js';
import PuterPrompt from '../ui/components/PuterPrompt.js';

const { UIModule } = await import('./UI.js');

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

// The dialogs a website gets, as the SDK registers them on load.
for ( const [tag, component] of [
    ['puter-alert', PuterAlert],
    ['puter-prompt', PuterPrompt],
    ['puter-color-picker', PuterColorPicker],
    ['puter-font-picker', PuterFontPicker],
] ) {
    if ( ! customElements.get(tag) ) customElements.define(tag, component);
}

/** A UI module on a website: no desktop to post to, so it renders its own UI. */
const makeUI = () =>
    new UIModule(
        { env: 'web', authToken: null, APIOrigin: 'https://api.test', appID: 'app-1', util: {} },
        { appInstanceID: 'instance-1' },
    );

const inDialog = (tag, selector) => document.querySelector(tag).shadowRoot.querySelector(selector);

beforeEach(() => {
    globalThis.puter = { defaultGUIOrigin: 'https://puter.test' };
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete globalThis.puter;
});

describe('ui.alert on a website', () => {
    it('shows the message and resolves to the value of the button clicked', async () => {
        const result = makeUI().alert('Delete it?', [
            { label: 'Delete', value: 'delete', type: 'danger' },
            { label: 'Keep', value: 'keep' },
        ]);

        expect(inDialog('puter-alert', '.message').textContent).toBe('Delete it?');
        expect(inDialog('puter-alert', 'dialog').open).toBe(true);
        inDialog('puter-alert', 'button[data-value="keep"]').click();

        await expect(result).resolves.toBe('keep');
        expect(document.querySelector('puter-alert')).toBeNull();
    });

    it('shows an empty message when called bare', () => {
        makeUI().alert();

        expect(document.querySelector('puter-alert').getAttribute('message')).toBe('');
        expect(inDialog('puter-alert', 'button')).not.toBeNull();
    });
});

describe('ui.prompt on a website', () => {
    it('prefills the input and resolves to what the user typed', async () => {
        const result = makeUI().prompt('File name?', 'Untitled', { defaultValue: 'a.txt' });

        const input = inDialog('puter-prompt', '.prompt-input');
        expect(document.querySelector('puter-prompt').getAttribute('message')).toBe('File name?');
        expect(input.placeholder).toBe('Untitled');
        expect(input.value).toBe('a.txt');

        input.value = 'b.txt';
        inDialog('puter-prompt', '.btn-ok').click();

        await expect(result).resolves.toBe('b.txt');
        expect(document.querySelector('puter-prompt')).toBeNull();
    });

    it('resolves false when the user cancels', async () => {
        const result = makeUI().prompt();

        const prompt = document.querySelector('puter-prompt');
        expect(prompt.hasAttribute('message')).toBe(false);
        expect(prompt.hasAttribute('placeholder')).toBe(false);
        expect(prompt.hasAttribute('default-value')).toBe(false);
        inDialog('puter-prompt', '.btn-cancel').click();

        await expect(result).resolves.toBe(false);
    });
});

describe('ui.showColorPicker on a website', () => {
    it.each([
        ['a color string', '#ff0000', '#ff0000'],
        ['defaultColor', { defaultColor: '#00ff00' }, '#00ff00'],
        ['the legacy default', { default: '#0000ff' }, '#0000ff'],
        ['defaultValue over defaultColor', { defaultValue: '#111111', defaultColor: '#222222' }, '#111111'],
        ['defaultColor over default', { defaultColor: '#222222', default: '#333333' }, '#222222'],
        ['nothing', undefined, '#3b82f6'],
    ])('starts from %s and resolves to the color confirmed', async (_form, options, color) => {
        const result = makeUI().showColorPicker(options);

        expect(document.querySelector('puter-color-picker').getAttribute('default-color')).toBe(color);
        inDialog('puter-color-picker', '.btn-ok').click();

        await expect(result).resolves.toBe(color);
        expect(document.querySelector('puter-color-picker')).toBeNull();
    });

    it('resolves null when the user cancels', async () => {
        const result = makeUI().showColorPicker('#ff0000');

        inDialog('puter-color-picker', '.btn-cancel').click();

        await expect(result).resolves.toBeNull();
    });
});

describe('ui.showFontPicker on a website', () => {
    it.each([
        ['a font name', 'Georgia', 'Georgia'],
        ['defaultFont', { defaultFont: 'Verdana' }, 'Verdana'],
        ['the legacy default', { default: 'Tahoma' }, 'Tahoma'],
        ['defaultValue over defaultFont', { defaultValue: 'Arial', defaultFont: 'Georgia' }, 'Arial'],
        ['defaultFont over default', { defaultFont: 'Georgia', default: 'Arial' }, 'Georgia'],
        ['nothing', undefined, 'System UI'],
    ])('starts from %s', (_form, options, font) => {
        makeUI().showFontPicker(options);

        expect(document.querySelector('puter-font-picker').getAttribute('default-font')).toBe(font);
    });

    it('resolves to the font confirmed', async () => {
        const result = makeUI().showFontPicker('Georgia');

        inDialog('puter-font-picker', '.btn-ok').click();

        await expect(result).resolves.toEqual({ fontFamily: 'Georgia, serif' });
        expect(document.querySelector('puter-font-picker')).toBeNull();
    });

    it('resolves null when the user cancels', async () => {
        const result = makeUI().showFontPicker();

        inDialog('puter-font-picker', '.btn-cancel').click();

        await expect(result).resolves.toBeNull();
    });
});

describe('ui.notify on a website', () => {
    const attributes = (el) => Object.fromEntries([...el.attributes].map(({ name, value }) => [name, value]));

    it('adds a notification to the page and resolves to its uid', async () => {
        const result = makeUI().notify({
            title: 'Upload finished',
            text: 'a.txt is ready',
            icon: 'bell.svg',
            type: 'success',
            duration: 0,
            roundIcon: true,
            uid: 'n-1',
        });

        await expect(result).resolves.toBe('n-1');
        expect(attributes(document.querySelector('puter-notification'))).toEqual({
            'title': 'Upload finished',
            'text': 'a.txt is ready',
            'icon': 'bell.svg',
            'type': 'success',
            'round-icon': '',
            'duration': '0',
        });
    });

    it('accepts round_icon too', () => {
        makeUI().notify({ title: 'Done', round_icon: true });

        expect(document.querySelector('puter-notification').hasAttribute('round-icon')).toBe(true);
    });

    it('resolves null for a notification with no uid, and sets only what was given', async () => {
        await expect(makeUI().notify()).resolves.toBeNull();
        expect(attributes(document.querySelector('puter-notification'))).toEqual({});
    });
});

describe('ui.setMenubar on a website', () => {
    const items = [{ label: 'File', items: [{ label: 'Save', action: () => {} }] }];

    it('adds a menubar with the items and the forced theme', () => {
        makeUI().setMenubar({ items, theme: 'dark' });

        const menubar = document.querySelector('puter-menubar');
        expect(menubar.items).toBe(items);
        expect(menubar.getAttribute('theme')).toBe('dark');
    });

    it('replaces the menubar already on the page', () => {
        const ui = makeUI();
        ui.setMenubar({ items });
        ui.setMenubar({});

        const menubars = document.querySelectorAll('puter-menubar');
        expect(menubars).toHaveLength(1);
        expect(menubars[0].items).toEqual([]);
        expect(menubars[0].hasAttribute('theme')).toBe(false);
    });
});

describe('ui.contextMenu on a website', () => {
    const items = [{ label: 'Rename', action: () => {} }, '-', { label: 'Delete', action: () => {} }];

    it('opens the menu at the position given', () => {
        makeUI().contextMenu({ items, x: 120, y: 45, theme: 'light' });

        const menu = document.querySelector('puter-context-menu');
        expect(menu.items).toBe(items);
        expect(menu.getAttribute('x')).toBe('120');
        expect(menu.getAttribute('y')).toBe('45');
        expect(menu.getAttribute('theme')).toBe('light');
    });

    it('opens the menu at the pointer of the event being handled', () => {
        vi.stubGlobal('event', { clientX: 30, clientY: 40 });
        makeUI().contextMenu({ items });

        const menu = document.querySelector('puter-context-menu');
        expect(menu.getAttribute('x')).toBe('30');
        expect(menu.getAttribute('y')).toBe('40');
        expect(menu.hasAttribute('theme')).toBe(false);
    });

    it('opens the menu at the corner when there is no pointer to go by', () => {
        vi.stubGlobal('event', undefined);
        makeUI().contextMenu({});

        const menu = document.querySelector('puter-context-menu');
        expect(menu.items).toEqual([]);
        expect(menu.getAttribute('x')).toBe('0');
        expect(menu.getAttribute('y')).toBe('0');
    });
});

describe('ui.showSpinner', () => {
    // The spinner stays up at least this long, so a quick task doesn't flash it.
    const MIN_VISIBLE_MS = 1200;
    const overlays = () => document.querySelectorAll('.puter-loading-overlay');

    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('covers the page with the message given', () => {
        const ui = makeUI();
        ui.showSpinner('Saving <b>a.txt</b>');

        expect(overlays()).toHaveLength(1);
        expect(overlays()[0].querySelector('.puter-loading-text').innerHTML).toBe('Saving <b>a.txt</b>');
        expect(overlays()[0].querySelector('.puter-loading-spinner')).not.toBeNull();
        expect(ui.isWorkingActive()).toBe(true);
    });

    it('says "Working..." when no message is given', () => {
        makeUI().showSpinner();

        expect(overlays()[0].querySelector('.puter-loading-text').textContent).toBe('Working...');
    });

    it('shows one spinner for nested calls', () => {
        const ui = makeUI();
        ui.showSpinner('First');
        ui.showSpinner('Second');

        expect(overlays()).toHaveLength(1);
        expect(overlays()[0].querySelector('.puter-loading-text').textContent).toBe('First');
    });

    it('keeps a spinner hidden early on screen for its minimum time', () => {
        const ui = makeUI();
        ui.showSpinner();
        vi.advanceTimersByTime(200);
        ui.hideSpinner();

        vi.advanceTimersByTime(MIN_VISIBLE_MS - 201);
        expect(overlays()).toHaveLength(1);
        expect(ui.isWorkingActive()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(overlays()).toHaveLength(0);
        expect(ui.isWorkingActive()).toBe(false);
    });

    it('removes a spinner right away once it has been up long enough', () => {
        const ui = makeUI();
        ui.showSpinner();
        vi.advanceTimersByTime(MIN_VISIBLE_MS);
        ui.hideSpinner();

        expect(overlays()).toHaveLength(0);
        expect(ui.isWorkingActive()).toBe(false);
    });

    it('hides once for repeated hide calls, and can show again after', () => {
        const ui = makeUI();
        ui.showSpinner();
        ui.hideSpinner();
        vi.advanceTimersByTime(500);
        ui.hideSpinner();
        vi.advanceTimersByTime(MIN_VISIBLE_MS);
        expect(overlays()).toHaveLength(0);

        ui.showSpinner('Again');
        expect(overlays()).toHaveLength(1);
        expect(document.querySelectorAll('#puter-spinner-styles')).toHaveLength(1);
    });

    it('does nothing when hiding a spinner that is not showing', () => {
        const ui = makeUI();
        ui.hideSpinner();
        vi.advanceTimersByTime(MIN_VISIBLE_MS);

        expect(ui.isWorkingActive()).toBe(false);
        expect(overlays()).toHaveLength(0);
    });
});

// The legacy menubar: the app writes the markup, and this wires it up.
describe('ui.menubar', () => {
    const MARKUP = `
        <ul class="--puter-menubar">
            <li>
                <span class="menubar-item" id="file">File</span>
                <ul class="dropdown" id="file-menu">
                    <li class="dropdown-item" id="save">Save</li>
                    <li class="dropdown-item dropdown-item-disabled" id="print">Print</li>
                </ul>
            </li>
            <li>
                <span class="menubar-item" id="edit">Edit</span>
                <ul class="dropdown" id="edit-menu"><li class="dropdown-item" id="undo">Undo</li></ul>
            </li>
        </ul>
        <main id="page">Page</main>`;

    const el = (id) => document.getElementById(id);
    const fire = (id, type) => el(id).dispatchEvent(new Event(type, { bubbles: true }));
    const isOpen = (id) => el(id).classList.contains('menubar-item-open');
    const shown = (id) => el(id).style.display;

    beforeEach(() => {
        document.body.innerHTML = MARKUP;
        makeUI().menubar();
    });

    it('adds its stylesheet once, replacing the one from an earlier call', () => {
        makeUI().menubar();

        const sheets = document.querySelectorAll('style.puter-stylesheet');
        expect(sheets).toHaveLength(1);
        expect(sheets[0].parentNode).toBe(document.head);
        expect(sheets[0].textContent).toContain('.--puter-menubar');
    });

    it('opens a menu when its title is pressed', () => {
        fire('file', 'mousedown');

        expect(isOpen('file')).toBe(true);
        expect(shown('file-menu')).toBe('block');
        expect(shown('edit-menu')).toBe('none');
    });

    it('closes an open menu when its title is pressed again', () => {
        fire('file', 'mousedown');
        fire('file', 'mousedown');

        expect(isOpen('file')).toBe(false);
        expect(shown('file-menu')).toBe('none');
    });

    it('switches to another menu when its title is pressed', () => {
        fire('file', 'mousedown');
        fire('edit', 'mousedown');

        expect(isOpen('file')).toBe(false);
        expect(isOpen('edit')).toBe(true);
        expect(shown('file-menu')).toBe('none');
        expect(shown('edit-menu')).toBe('block');
    });

    it('follows the pointer to another title while a menu is open', () => {
        fire('file', 'mousedown');
        fire('edit', 'mouseover');

        expect(isOpen('file')).toBe(false);
        expect(isOpen('edit')).toBe(true);
        expect(shown('edit-menu')).toBe('block');
    });

    it('opens nothing on hover while every menu is closed', () => {
        fire('edit', 'mouseover');

        expect(isOpen('edit')).toBe(false);
    });

    it('closes the open menu on a click elsewhere on the page', () => {
        fire('file', 'mousedown');
        fire('page', 'click');

        expect(isOpen('file')).toBe(false);
        expect(shown('file-menu')).toBe('none');
    });

    it('closes the open menu after one of its items is clicked', () => {
        fire('file', 'mousedown');
        fire('save', 'click');

        expect(isOpen('file')).toBe(false);
        expect(shown('file-menu')).toBe('none');
    });

    it('stays open on a click on a disabled item', () => {
        fire('file', 'mousedown');
        fire('print', 'click');

        expect(isOpen('file')).toBe(true);
        expect(shown('file-menu')).toBe('block');
    });

    it('closes the open menu when the window loses focus', () => {
        fire('file', 'mousedown');
        window.dispatchEvent(new Event('blur'));

        expect(isOpen('file')).toBe(false);
        expect(shown('file-menu')).toBe('none');
    });
});
