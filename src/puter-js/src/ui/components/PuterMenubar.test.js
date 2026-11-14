// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterContextMenu from './PuterContextMenu.js';
import PuterMenubar from './PuterMenubar.js';

const BUTTON_WIDTH = 60;
const BAR_HEIGHT = 36;

// jsdom lays nothing out: buttons sit side by side along a 36px bar.
const layout = function () {
    if ( ! this.classList.contains('menu-button') ) {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    }
    const left = Number(this.dataset.index) * BUTTON_WIDTH;
    return {
        left, top: 0, right: left + BUTTON_WIDTH, bottom: BAR_HEIGHT, width: BUTTON_WIDTH, height: BAR_HEIGHT, x: left, y: 0,
    };
};

const ITEMS = () => [
    { label: 'File', items: [{ label: 'New' }, { label: 'Open' }] },
    { label: 'Edit', items: [{ label: 'Undo' }, { label: 'Redo' }] },
    { label: 'View', items: [{ label: 'Zoom' }] },
];

// One frame: lets a dropdown's deferred listeners and first-item focus run.
const frame = () => vi.advanceTimersByTime(20);

const mount = (items = ITEMS(), attributes = {}) => {
    const el = document.createElement('puter-menubar');
    el.items = items;
    for ( const [name, value] of Object.entries(attributes) ) el.setAttribute(name, value);
    document.body.appendChild(el);
    return el;
};

const buttons = el => [...el.shadowRoot.querySelectorAll('.menu-button')];
const button = (el, label) => buttons(el).find(node => node.textContent === label);
const withClass = (el, name) => buttons(el).filter(node => node.classList.contains(name)).map(node => node.textContent);
const keyboardNav = el => el.shadowRoot.querySelector('.menubar').classList.contains('keyboard-nav');
const dropdowns = () => [...document.querySelectorAll('puter-context-menu')];
const dropdownLabels = () => dropdowns().map(menu =>
    [...menu.shadowRoot.querySelectorAll('.menu-item .label')].map(node => node.textContent));
const dropdownRow = label =>
    [...dropdowns()[0].shadowRoot.querySelectorAll('.menu-item')].find(node => node.textContent.trim() === label);
const dropdownFocus = () => dropdowns()[0].shadowRoot.querySelector('.menu-item.focused .label')?.textContent ?? null;

const key = (type, name, init = {}) => {
    const event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
};
const press = (name, init) => key('keydown', name, init);
const tapAlt = () => {
    key('keydown', 'Alt');
    return key('keyup', 'Alt');
};
const hover = node => node.dispatchEvent(new MouseEvent('mouseenter'));
const leave = node => node.dispatchEvent(new MouseEvent('mouseleave'));
const pointerDownOn = node => node.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
const selections = (el) => {
    const seen = [];
    el.addEventListener('select', event => seen.push(event.detail));
    return seen;
};

beforeAll(() => {
    if ( ! customElements.get('puter-context-menu') ) customElements.define('puter-context-menu', PuterContextMenu);
    if ( ! customElements.get('puter-menubar') ) customElements.define('puter-menubar', PuterMenubar);
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout);
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    document.body.innerHTML = '';
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('<puter-menubar> rendering', () => {
    it('renders one button per item, escaping labels', () => {
        const el = mount([{ label: 'File' }, { label: '<b>Edit</b>' }, {}]);
        expect(buttons(el).map(node => node.textContent)).toEqual(['File', '<b>Edit</b>', '']);
        expect(el.shadowRoot.querySelector('.menu-button b')).toBeNull();
    });

    it('re-renders when items are replaced, and treats a missing list as empty', () => {
        const el = mount();
        el.items = [{ label: 'Help' }];
        expect(buttons(el).map(node => node.textContent)).toEqual(['Help']);
        expect(el.items).toHaveLength(1);
        el.items = undefined;
        expect(buttons(el)).toEqual([]);
        expect(el.items).toEqual([]);
    });
});

describe('<puter-menubar> mouse', () => {
    it('opens a dropdown under the clicked button', () => {
        const el = mount(ITEMS(), { theme: 'dark' });
        button(el, 'Edit').click();
        frame();
        expect(dropdownLabels()).toEqual([['Undo', 'Redo']]);
        expect(withClass(el, 'active')).toEqual(['Edit']);
        const [dropdown] = dropdowns();
        expect([dropdown.style.left, dropdown.style.top]).toEqual([`${BUTTON_WIDTH}px`, `${BAR_HEIGHT}px`]);
        expect(dropdown.getAttribute('theme')).toBe('dark');
    });

    it('switches dropdowns when another button is clicked', () => {
        const el = mount();
        button(el, 'File').click();
        button(el, 'View').click();
        expect(dropdownLabels()).toEqual([['Zoom']]);
        expect(withClass(el, 'active')).toEqual(['View']);
    });

    it('closes the dropdown when its button is clicked again', () => {
        const el = mount();
        button(el, 'File').click();
        button(el, 'File').click();
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
    });

    it('does not reopen the dropdown on the click that follows the press that closed it', () => {
        const el = mount();
        button(el, 'File').click();
        frame();
        // A real press: pointerdown closes the dropdown as an outside press, then click arrives.
        pointerDownOn(button(el, 'File'));
        expect(dropdowns()).toEqual([]);
        button(el, 'File').click();
        expect(dropdowns()).toEqual([]);

        button(el, 'File').click();
        expect(dropdownLabels()).toEqual([['New', 'Open']]);
    });

    it('forgets a press that no click followed', () => {
        const el = mount();
        button(el, 'File').click();
        frame();
        pointerDownOn(button(el, 'File'));
        vi.advanceTimersByTime(400);
        button(el, 'File').click();
        expect(dropdownLabels()).toEqual([['New', 'Open']]);
    });

    it('runs a top-level action at once and reports it', () => {
        const action = vi.fn();
        const items = [{ label: 'Save', action }, { label: 'Empty', items: [] }, { label: 'Inert' }];
        const el = mount(items);
        const selected = selections(el);
        button(el, 'Save').click();
        button(el, 'Empty').click();
        button(el, 'Inert').click();
        expect(action).toHaveBeenCalledTimes(1);
        expect(selected).toEqual([items[0]]);
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
    });

    it('reports the chosen dropdown item and closes', () => {
        const items = ITEMS();
        const action = vi.fn();
        items[0].items[1].action = action;
        const el = mount(items);
        const selected = selections(el);
        button(el, 'File').click();
        frame();
        dropdownRow('Open').click();
        expect(action).toHaveBeenCalledTimes(1);
        expect(selected).toEqual([items[0].items[1]]);
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
    });

    it('releases the button when the dropdown closes itself', () => {
        const el = mount();
        button(el, 'File').click();
        frame();
        pointerDownOn(document.body);
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
        // The menubar is no longer driving the keyboard.
        expect(press('ArrowRight').defaultPrevented).toBe(false);
        expect(dropdowns()).toEqual([]);
    });

    it('highlights the hovered button', () => {
        const el = mount();
        hover(button(el, 'Edit'));
        expect(withClass(el, 'hovered')).toEqual(['Edit']);
        expect(dropdowns()).toEqual([]);
        leave(button(el, 'Edit'));
        expect(withClass(el, 'hovered')).toEqual([]);
    });

    it('follows the hover to another button while a dropdown is open', () => {
        const el = mount();
        button(el, 'File').click();
        hover(button(el, 'File'));
        expect(dropdownLabels()).toEqual([['New', 'Open']]);
        hover(button(el, 'Edit'));
        expect(dropdownLabels()).toEqual([['Undo', 'Redo']]);
        expect(withClass(el, 'active')).toEqual(['Edit']);
    });

    it('hands the highlight from the keyboard to the mouse', () => {
        const el = mount();
        press('F10');
        button(el, 'File').focus();
        expect(withClass(el, 'focused')).toEqual(['File']);

        hover(button(el, 'View'));
        expect(withClass(el, 'focused')).toEqual([]);
        expect(withClass(el, 'hovered')).toEqual(['View']);
        expect(keyboardNav(el)).toBe(false);
        expect(el.shadowRoot.activeElement).toBeNull();
    });

    it('leaves keyboard-nav mode once the mouse moves', () => {
        const el = mount();
        press('F10');
        expect(keyboardNav(el)).toBe(true);
        document.dispatchEvent(new MouseEvent('mousemove'));
        expect(keyboardNav(el)).toBe(false);
    });
});

describe('<puter-menubar> keyboard', () => {
    it('toggles keyboard focus with F10', () => {
        const el = mount();
        expect(press('F10').defaultPrevented).toBe(true);
        expect(withClass(el, 'focused')).toEqual(['File']);
        expect(keyboardNav(el)).toBe(true);
        press('F10');
        expect(withClass(el, 'focused')).toEqual([]);
        expect(keyboardNav(el)).toBe(false);
    });

    it('closes an open dropdown with F10', () => {
        const el = mount();
        button(el, 'File').click();
        press('F10');
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
    });

    it('toggles keyboard focus with a lone Alt tap', () => {
        const el = mount();
        expect(tapAlt().defaultPrevented).toBe(true);
        expect(withClass(el, 'focused')).toEqual(['File']);
        tapAlt();
        expect(withClass(el, 'focused')).toEqual([]);
    });

    it('ignores Alt used as a modifier, and Alt held through a window switch', () => {
        const el = mount();
        key('keydown', 'Alt');
        key('keydown', 'Alt', { repeat: true });
        key('keydown', 'f', { altKey: true });
        expect(key('keyup', 'Alt').defaultPrevented).toBe(false);

        key('keydown', 'Alt');
        window.dispatchEvent(new Event('blur'));
        key('keyup', 'Alt');
        key('keyup', 'Shift');
        expect(withClass(el, 'focused')).toEqual([]);
    });

    it('does not take keyboard focus without items or while a context menu is open', () => {
        const empty = mount([]);
        press('F10');
        expect(keyboardNav(empty)).toBe(false);
        empty.remove();

        const el = mount();
        const menu = document.createElement('puter-context-menu');
        menu.items = [{ label: 'Copy' }];
        document.body.appendChild(menu);
        frame();
        press('F10');
        expect(withClass(el, 'focused')).toEqual([]);
    });

    it('leaves keys alone until it has keyboard focus', () => {
        const el = mount();
        expect(press('ArrowRight').defaultPrevented).toBe(false);
        expect(press('Enter').defaultPrevented).toBe(false);
        expect(withClass(el, 'focused')).toEqual([]);
        expect(dropdowns()).toEqual([]);
    });

    it('steps between buttons with the arrow keys, opening each dropdown', () => {
        const el = mount();
        press('F10');
        expect(press('ArrowRight').defaultPrevented).toBe(true);
        frame();
        expect(withClass(el, 'focused')).toEqual(['Edit']);
        expect(dropdownLabels()).toEqual([['Undo', 'Redo']]);
        // Arrowing across the bar does not enter the dropdown.
        expect(dropdownFocus()).toBeNull();
    });

    it('wraps from the first button to the last on ArrowLeft', () => {
        const el = mount();
        press('F10');
        press('ArrowLeft');
        expect(withClass(el, 'focused')).toEqual(['View']);
        expect(dropdownLabels()).toEqual([['Zoom']]);
    });

    it.each(['ArrowDown', 'Enter', ' '])('opens the focused dropdown on "%s" and focuses its first item', (name) => {
        const el = mount();
        press('F10');
        expect(press(name).defaultPrevented).toBe(true);
        frame();
        expect(withClass(el, 'active')).toEqual(['File']);
        expect(dropdownFocus()).toBe('New');
        expect(dropdowns()[0].shadowRoot.querySelector('.context-menu').classList.contains('keyboard-nav')).toBe(true);
    });

    it.each(['Escape', 'Tab'])('gives up keyboard focus on %s', (name) => {
        const el = mount();
        press('F10');
        expect(press(name).defaultPrevented).toBe(true);
        expect(withClass(el, 'focused')).toEqual([]);
        expect(press('ArrowRight').defaultPrevented).toBe(false);
    });

    it('passes other keys through while focused', () => {
        const el = mount();
        press('F10');
        expect(press('a').defaultPrevented).toBe(false);
        expect(withClass(el, 'focused')).toEqual(['File']);
    });

    it('moves to the neighbouring dropdown when an arrow key leaves the open one', () => {
        const el = mount();
        press('F10');
        press('ArrowDown');
        frame();
        press('ArrowRight');
        frame();
        expect(dropdownLabels()).toEqual([['Undo', 'Redo']]);
        expect(withClass(el, 'active')).toEqual(['Edit']);
        expect(withClass(el, 'focused')).toEqual(['Edit']);

        press('ArrowLeft');
        frame();
        press('ArrowLeft');
        frame();
        expect(dropdownLabels()).toEqual([['Zoom']]);
        expect(withClass(el, 'focused')).toEqual(['View']);
    });

    it('returns to the button when ArrowUp leaves the top of the dropdown', () => {
        const el = mount();
        press('F10');
        press('ArrowDown');
        frame();
        press('ArrowUp');
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'focused')).toEqual(['File']);
        expect(keyboardNav(el)).toBe(true);

        press('ArrowDown');
        frame();
        expect(dropdownFocus()).toBe('New');
    });

    it('gives up keyboard focus when the dropdown is dismissed with Escape', () => {
        const el = mount();
        press('F10');
        press('ArrowDown');
        frame();
        press('Escape');
        expect(dropdowns()).toEqual([]);
        expect(withClass(el, 'focused')).toEqual([]);
        expect(withClass(el, 'active')).toEqual([]);
    });

    it('runs a top-level action from the keyboard', () => {
        const action = vi.fn();
        const items = [{ label: 'File', items: [{ label: 'New' }] }, { label: 'Save', action }];
        const el = mount(items);
        const selected = selections(el);
        press('F10');
        press('ArrowRight');
        expect(action).toHaveBeenCalledTimes(1);
        expect(selected).toEqual([items[1]]);
        expect(dropdowns()).toEqual([]);
    });
});

describe('<puter-menubar> losing focus', () => {
    it('gives up keyboard focus on a press outside the menubar', () => {
        const el = mount();
        press('F10');
        pointerDownOn(button(el, 'Edit'));
        expect(withClass(el, 'focused')).toEqual(['File']);
        pointerDownOn(document.body);
        expect(withClass(el, 'focused')).toEqual([]);
        expect(press('ArrowRight').defaultPrevented).toBe(false);
    });

    it('gives up keyboard focus when focus moves to another element', () => {
        const el = mount();
        const input = document.createElement('input');
        document.body.appendChild(input);
        const focusIn = node => node.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));

        focusIn(input);
        press('F10');
        focusIn(button(el, 'Edit'));
        expect(withClass(el, 'focused')).toEqual(['File']);
        focusIn(input);
        expect(withClass(el, 'focused')).toEqual([]);
    });

    it('keeps an open dropdown when focus moves or the window blurs', () => {
        const el = mount();
        press('F10');
        press('ArrowDown');
        frame();
        document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
        window.dispatchEvent(new Event('blur'));
        expect(dropdownLabels()).toEqual([['New', 'Open']]);
        expect(withClass(el, 'active')).toEqual(['File']);
    });

    it('gives up keyboard focus when the window loses focus', () => {
        const el = mount();
        press('F10');
        window.dispatchEvent(new Event('blur'));
        expect(withClass(el, 'focused')).toEqual([]);
        expect(keyboardNav(el)).toBe(false);
    });

    it('closes its dropdown and stops listening once removed', () => {
        const el = mount();
        button(el, 'File').click();
        el.remove();
        expect(dropdowns()).toEqual([]);
        expect(press('F10').defaultPrevented).toBe(false);
        expect(tapAlt().defaultPrevented).toBe(false);
    });
});
