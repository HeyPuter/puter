// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterContextMenu from './PuterContextMenu.js';

const ROW = 28;
const MENU_WIDTH = 200;
const rectAt = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
});

// jsdom lays nothing out: a menu is 200px wide at its host's left/top, with 28px rows.
const layout = function () {
    const menu = this.closest('.context-menu');
    if ( ! menu ) return rectAt(0, 0, 0, 0);
    const host = menu.getRootNode().host;
    // A menu replaced by a re-render is no longer in a shadow root.
    if ( ! host ) return rectAt(0, 0, 0, 0);
    const left = parseFloat(host.style.left) || 0;
    const top = parseFloat(host.style.top) || 0;
    if ( this === menu ) return rectAt(left, top, MENU_WIDTH, ROW * menu.children.length);
    const row = [...menu.children].indexOf(this.closest('.menu-item'));
    return rectAt(left, top + row * ROW, MENU_WIDTH, ROW);
};

const ITEMS = () => [
    { label: 'Open' },
    { label: 'Share', items: [{ label: 'Email' }, { label: 'Link' }] },
    { label: 'Export', items: [{ label: 'PDF' }, { label: 'PNG' }] },
    '-',
    { label: 'Delete', danger: true },
    { label: 'Locked', disabled: true },
];

// One frame: lets the deferred outside-press listener and the overflow check run.
const frame = () => vi.advanceTimersByTime(20);

const openMenu = (items = ITEMS(), attributes = {}) => {
    const el = document.createElement('puter-context-menu');
    el.items = items;
    for ( const [name, value] of Object.entries(attributes) ) el.setAttribute(name, String(value));
    document.body.appendChild(el);
    frame();
    return el;
};

const rows = el => [...el.shadowRoot.querySelectorAll('.menu-item')];
const labelOf = node => node.querySelector('.label')?.textContent ?? null;
const labels = el => rows(el).map(labelOf);
const row = (el, label) => rows(el).find(node => labelOf(node) === label);
const focused = (el) => {
    const node = el.shadowRoot.querySelector('.menu-item.focused');
    return node ? labelOf(node) : null;
};
const menuRoot = el => el.shadowRoot.querySelector('.context-menu');
const submenus = () => [...document.querySelectorAll('puter-context-menu[data-submenu]')];
const openMenus = () => document.querySelectorAll('puter-context-menu').length;

const press = (key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
};
const hover = node => node.dispatchEvent(new MouseEvent('mouseenter'));
const leave = node => node.dispatchEvent(new MouseEvent('mouseleave'));
const moveMouse = (clientX, clientY) =>
    document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
const pointerDownOn = node => node.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));

/** Collects the events a menu fires, as [type, detail] pairs. */
const record = (el, ...types) => {
    const seen = [];
    for ( const type of types ) el.addEventListener(type, event => seen.push([type, event.detail]));
    return seen;
};

// Opens Share's submenu by hover and returns it.
const hoverOpenShare = (el) => {
    hover(row(el, 'Share'));
    vi.advanceTimersByTime(200);
    frame();
    return submenus()[0];
};

beforeAll(() => {
    if ( ! customElements.get('puter-context-menu') ) customElements.define('puter-context-menu', PuterContextMenu);
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
    vi.unstubAllGlobals();
});

describe('<puter-context-menu> rendering', () => {
    it('renders items, separators, and item states', () => {
        const el = openMenu([
            { label: 'Open' },
            { separator: true },
            { label: 'Delete', type: 'danger' },
            '-',
            { label: 'Locked', disabled: true },
            { label: 'More', items: [{ label: 'Inner' }] },
        ]);
        expect(labels(el)).toEqual(['Open', null, 'Delete', null, 'Locked', 'More']);
        expect(rows(el).filter(node => node.classList.contains('divider'))).toHaveLength(2);
        expect(row(el, 'Delete').classList.contains('danger')).toBe(true);
        expect(row(el, 'Locked').classList.contains('disabled')).toBe(true);
        expect(row(el, 'More').querySelector('.submenu-arrow')).not.toBeNull();
        expect(row(el, 'Open').querySelector('.submenu-arrow')).toBeNull();
        // No item has an icon or a check, so no icon column is reserved.
        expect(el.shadowRoot.querySelector('.icon, .check')).toBeNull();
    });

    it('renders icons and checks, and keeps labels aligned on items without one', () => {
        const el = openMenu([
            { label: 'Inline', icon: '<svg data-kind="inline"></svg>' },
            { label: 'Linked', icon: 'https://cdn.example.com/a"b.png' },
            { label: 'On', checked: true },
            { label: 'Off', checked: false },
            { label: 'Plain' },
        ]);
        expect(row(el, 'Inline').querySelector('.icon svg').dataset.kind).toBe('inline');
        expect(row(el, 'Linked').querySelector('.icon img').getAttribute('src')).toBe('https://cdn.example.com/a"b.png');
        expect(row(el, 'On').querySelector('.check').textContent).toBe('✓');
        expect(row(el, 'Off').querySelector('.check').textContent).toBe('');
        expect(row(el, 'Plain').querySelector('.icon').innerHTML).toBe('');
    });

    it('escapes labels', () => {
        const el = openMenu([{ label: '<img src=x onerror=alert(1)>' }]);
        expect(rows(el)[0].querySelector('img')).toBeNull();
        expect(labels(el)).toEqual(['<img src=x onerror=alert(1)>']);
    });

    it('re-renders when items are replaced, and treats a missing list as empty', () => {
        const el = openMenu([{ label: 'Old' }]);
        el.items = [{ label: 'New' }, { label: 'Newer' }];
        expect(labels(el)).toEqual(['New', 'Newer']);
        expect(el.items).toHaveLength(2);
        el.items = null;
        expect(rows(el)).toEqual([]);
        expect(el.items).toEqual([]);
    });

    const shortcutsOf = el => rows(el).map(node => node.querySelector('.shortcut')?.textContent ?? null);
    const SHORTCUTS = [
        { label: 'Save', shortcut: 'Mod+S' },
        { label: 'Duplicate', shortcut: '⇧⌘D' },
        { label: 'Close', shortcut: 'Control + Option + W' },
        { label: 'Lock', shortcut: 'Win+L' },
        { label: 'Find', shortcut: '⌃⌥F' },
        { label: 'None' },
    ];

    it('spells shortcuts out on non-Apple platforms', () => {
        vi.stubGlobal('navigator', { platform: 'Win32', userAgent: '' });
        expect(shortcutsOf(openMenu(SHORTCUTS))).toEqual([
            'Ctrl+S', 'Shift+Ctrl+D', 'Ctrl+Alt+W', 'Win+L', 'Ctrl+Alt+F', null,
        ]);
    });

    it.each([
        ['platform string', { platform: 'MacIntel', userAgent: '' }],
        ['client hints', { platform: 'Win32', userAgentData: { platform: 'macOS' } }],
        ['user agent', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }],
    ])('uses modifier glyphs on Apple platforms, detected by %s', (_name, navigatorLike) => {
        vi.stubGlobal('navigator', navigatorLike);
        expect(shortcutsOf(openMenu(SHORTCUTS))).toEqual([
            '⌘S', '⇧⌘D', '⌃⌥W', '⌘L', '⌃⌥F', null,
        ]);
    });

    it('follows the forced theme, then the system preference', () => {
        expect(openMenu(ITEMS(), { theme: 'dark' }).classList.contains('puter-theme-dark')).toBe(true);
        expect(openMenu().classList.contains('puter-theme-dark')).toBe(false);

        vi.stubGlobal('matchMedia', query => ({
            matches: query.includes('dark'),
            addEventListener: () => {},
            removeEventListener: () => {},
        }));
        expect(openMenu().classList.contains('puter-theme-dark')).toBe(true);
        expect(openMenu(ITEMS(), { theme: 'light' }).classList.contains('puter-theme-dark')).toBe(false);
    });
});

describe('<puter-context-menu> placement', () => {
    it('opens at the given point', () => {
        const el = openMenu(ITEMS(), { x: 120, y: 80 });
        expect([el.style.left, el.style.top]).toEqual(['120px', '80px']);
    });

    it('opens at the origin without a point', () => {
        const el = openMenu();
        expect([el.style.left, el.style.top]).toEqual(['0px', '0px']);
    });

    it('flips left and shifts up when it would overflow the viewport', () => {
        const el = openMenu(ITEMS(), { x: window.innerWidth - 50, y: window.innerHeight - 20 });
        expect(el.style.left).toBe(`${window.innerWidth - 50 - MENU_WIDTH}px`);
        expect(el.style.top).toBe(`${window.innerHeight - 6 * ROW - 10}px`);
    });

    it('opens a submenu to the right of its item', () => {
        const el = openMenu(ITEMS(), { x: 100, y: 50 });
        const sub = hoverOpenShare(el);
        expect(labels(sub)).toEqual(['Email', 'Link']);
        expect([sub.style.left, sub.style.top]).toEqual([`${100 + MENU_WIDTH + 2}px`, `${50 + ROW}px`]);
    });

    it('opens a submenu to the left, shifted up, when there is no room', () => {
        vi.stubGlobal('innerWidth', 600);
        vi.stubGlobal('innerHeight', 120);
        const el = openMenu(ITEMS(), { x: 300, y: 0 });
        row(el, 'Export').click();
        frame();
        const sub = submenus()[0];
        expect([sub.style.left, sub.style.top]).toEqual([`${300 - MENU_WIDTH - 2}px`, `${120 - 2 * ROW - 10}px`]);
    });

    it('carries a forced theme into submenus', () => {
        const el = openMenu(ITEMS(), { theme: 'dark' });
        row(el, 'Share').click();
        expect(submenus()[0].getAttribute('theme')).toBe('dark');
        expect(submenus()[0].classList.contains('puter-theme-dark')).toBe(true);
    });
});

describe('<puter-context-menu> selection', () => {
    it('runs the action, reports the item, and closes', () => {
        const action = vi.fn();
        const items = [{ label: 'Rename', action }, { label: 'Open' }];
        const el = openMenu(items);
        const events = record(el, 'select', 'close');
        row(el, 'Rename').click();
        expect(action).toHaveBeenCalledTimes(1);
        expect(events).toEqual([['select', items[0]], ['close', {}]]);
        expect(el.isConnected).toBe(false);
    });

    it('reports an item that has no action', () => {
        const items = [{ label: 'Open' }];
        const el = openMenu(items);
        const events = record(el, 'select');
        row(el, 'Open').click();
        expect(events).toEqual([['select', items[0]]]);
    });

    it('ignores clicks on disabled items and separators', () => {
        const el = openMenu();
        const events = record(el, 'select', 'close');
        row(el, 'Locked').click();
        rows(el)[3].click();
        expect(events).toEqual([]);
        expect(el.isConnected).toBe(true);
    });

    it('opens a submenu on click instead of selecting, and keeps it on a second click', () => {
        const el = openMenu();
        const events = record(el, 'select', 'close');
        row(el, 'Share').click();
        const sub = submenus()[0];
        expect(labels(sub)).toEqual(['Email', 'Link']);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(true);
        row(el, 'Share').click();
        expect(submenus()).toEqual([sub]);
        expect(events).toEqual([]);
    });

    it('keeps the submenu open through a press and click on its parent item', () => {
        const el = openMenu();
        row(el, 'Share').click();
        frame();
        const sub = submenus()[0];

        pointerDownOn(row(el, 'Share'));
        row(el, 'Share').click();

        expect(submenus()).toEqual([sub]);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(true);
    });

    it('reports a submenu selection on the root menu and closes the whole chain', () => {
        const items = ITEMS();
        const action = vi.fn();
        items[1].items[1].action = action;
        const el = openMenu(items);
        const events = record(el, 'select', 'close');
        row(el, 'Share').click();
        row(submenus()[0], 'Link').click();
        expect(action).toHaveBeenCalledTimes(1);
        expect(events).toEqual([['select', items[1].items[1]], ['close', {}]]);
        expect(openMenus()).toBe(0);
    });

    it('closes on a press outside, but not on a press inside the menu or its submenus', () => {
        const el = openMenu([
            { label: 'Share', items: [{ label: 'More', items: [{ label: 'Deep' }] }] },
        ]);
        row(el, 'Share').click();
        frame();
        const sub = submenus()[0];
        row(sub, 'More').click();
        frame();
        const deep = submenus()[1];
        expect(labels(deep)).toEqual(['Deep']);

        pointerDownOn(deep);
        expect(openMenus()).toBe(3);
        // A press on a menu further up is that menu's to act on.
        pointerDownOn(sub);
        pointerDownOn(el);
        expect(openMenus()).toBe(3);

        const events = record(el, 'close');
        pointerDownOn(document.body);
        expect(events).toEqual([['close', {}]]);
        expect(openMenus()).toBe(0);
    });

    it('stops listening to the document once removed', () => {
        const el = openMenu();
        const events = record(el, 'close');
        el.remove();
        pointerDownOn(document.body);
        expect(press('Escape').defaultPrevented).toBe(false);
        expect(events).toEqual([]);
    });
});

describe('<puter-context-menu> keyboard', () => {
    it('moves focus with the arrow keys, skipping separators and disabled items', () => {
        const el = openMenu();
        expect(focused(el)).toBeNull();
        const visited = [];
        for ( let i = 0; i < 5; i++ ) {
            press('ArrowDown');
            visited.push(focused(el));
        }
        expect(visited).toEqual(['Open', 'Share', 'Export', 'Delete', 'Open']);
        expect(menuRoot(el).classList.contains('keyboard-nav')).toBe(true);
    });

    it('starts from the last item on ArrowUp, and jumps with Home and End', () => {
        const el = openMenu();
        press('ArrowUp');
        expect(focused(el)).toBe('Delete');
        press('ArrowUp');
        expect(focused(el)).toBe('Export');
        press('Home');
        expect(focused(el)).toBe('Open');
        press('End');
        expect(focused(el)).toBe('Delete');
    });

    it('consumes the keys it handles and leaves host shortcuts alone', () => {
        const el = openMenu();
        expect(press('ArrowDown').defaultPrevented).toBe(true);
        expect(press('s', { metaKey: true }).defaultPrevented).toBe(false);
        expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press('s', { altKey: true }).defaultPrevented).toBe(false);
        expect(press('F5').defaultPrevented).toBe(false);
        expect(focused(el)).toBe('Open');
    });

    it.each(['Enter', ' '])('activates the focused item on "%s"', (key) => {
        const items = ITEMS();
        const el = openMenu(items);
        const events = record(el, 'select');
        press(key);
        expect(events).toEqual([]);
        press('ArrowDown');
        press(key);
        expect(events).toEqual([['select', items[0]]]);
        expect(el.isConnected).toBe(false);
    });

    it.each(['Escape', 'Tab'])('closes on %s', (key) => {
        const el = openMenu();
        const events = record(el, 'select', 'close');
        expect(press(key).defaultPrevented).toBe(true);
        expect(events).toEqual([['close', {}]]);
        expect(el.isConnected).toBe(false);
    });

    it('focuses items by typing their first letters', () => {
        const el = openMenu();
        press('s');
        expect(focused(el)).toBe('Share');
        // "se" matches nothing, so the latest letter starts a new search.
        press('E');
        expect(focused(el)).toBe('Export');
        vi.advanceTimersByTime(500);
        press('o');
        press('p');
        expect(focused(el)).toBe('Open');
        vi.advanceTimersByTime(500);
        expect(press('z').defaultPrevented).toBe(false);
        expect(press('z').defaultPrevented).toBe(false);
        expect(focused(el)).toBe('Open');
    });

    it('cycles through items sharing a first letter', () => {
        const el = openMenu([{ label: 'Paste' }, { label: 'Print' }, { label: 'Open' }]);
        const visited = [];
        for ( let i = 0; i < 3; i++ ) {
            press('p');
            visited.push(focused(el));
            vi.advanceTimersByTime(500);
        }
        expect(visited).toEqual(['Print', 'Paste', 'Print']);
    });

    it('has nothing to focus when every item is disabled', () => {
        const el = openMenu([{ label: 'Locked', disabled: true }, '-']);
        press('ArrowDown');
        press('Home');
        press('End');
        expect(press('l').defaultPrevented).toBe(false);
        expect(focused(el)).toBeNull();
    });

    it('asks its owner to navigate when an arrow key leaves the root menu', () => {
        const el = openMenu();
        const events = record(el, 'puter-menu-navigate');
        press('ArrowLeft');
        press('ArrowRight');
        press('ArrowDown');
        press('ArrowUp');
        expect(events.map(([, detail]) => detail.direction)).toEqual(['left', 'right', 'up']);
        expect(focused(el)).toBe('Open');
        expect(el.isConnected).toBe(true);
    });

    it('opens the focused submenu with ArrowRight and focuses its first item', () => {
        const el = openMenu();
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        frame();
        const sub = submenus()[0];
        expect(focused(sub)).toBe('Email');
        expect(menuRoot(sub).classList.contains('keyboard-nav')).toBe(true);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(true);
        expect(focused(el)).toBeNull();

        // The deepest open menu owns the keyboard.
        press('ArrowDown');
        expect(focused(sub)).toBe('Link');
        expect(focused(el)).toBeNull();
    });

    it('returns to the parent item with ArrowLeft', () => {
        const el = openMenu();
        const navigations = record(el, 'puter-menu-navigate');
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        frame();
        // Inside a submenu, ArrowRight on a plain item goes nowhere.
        press('ArrowRight');
        expect(submenus()).toHaveLength(1);

        press('ArrowLeft');
        expect(submenus()).toEqual([]);
        expect(focused(el)).toBe('Share');
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(false);
        expect(navigations).toEqual([]);
    });

    it.each(['Escape', 'Tab'])('closes only the submenu on %s and hands the keyboard back', (key) => {
        const el = openMenu();
        const events = record(el, 'close');
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        frame();

        press(key);
        expect(submenus()).toEqual([]);
        expect(events).toEqual([]);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(false);

        press('ArrowDown');
        expect(focused(el)).not.toBeNull();
        // The item opens its submenu again.
        row(el, 'Share').click();
        expect(submenus()).toHaveLength(1);
    });

    it('selects from a submenu with Enter', () => {
        const items = ITEMS();
        const el = openMenu(items);
        const events = record(el, 'select', 'close');
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        frame();
        press('Enter');
        expect(events).toEqual([['select', items[1].items[0]], ['close', {}]]);
        expect(openMenus()).toBe(0);
    });

    it('lets the mouse take over from the keyboard once it moves', () => {
        const el = openMenu();
        press('ArrowDown');
        expect(menuRoot(el).classList.contains('keyboard-nav')).toBe(true);
        moveMouse(10, 10);
        expect(menuRoot(el).classList.contains('keyboard-nav')).toBe(false);
    });
});

describe('<puter-context-menu> hover', () => {
    it('highlights the hovered item and clears it when the cursor leaves the menu', () => {
        const el = openMenu();
        press('ArrowDown');
        hover(row(el, 'Delete'));
        expect(focused(el)).toBe('Delete');
        leave(menuRoot(el));
        expect(focused(el)).toBeNull();
    });

    it('drops the highlight over a separator or a disabled item', () => {
        const el = openMenu();
        hover(row(el, 'Open'));
        hover(rows(el)[3]);
        expect(focused(el)).toBeNull();
        hover(row(el, 'Open'));
        hover(row(el, 'Locked'));
        expect(focused(el)).toBeNull();
    });

    it('opens a submenu after a short hover, and not if the cursor leaves first', () => {
        const el = openMenu();
        hover(row(el, 'Share'));
        expect(focused(el)).toBe('Share');
        vi.advanceTimersByTime(150);
        expect(submenus()).toEqual([]);
        leave(row(el, 'Share'));
        vi.advanceTimersByTime(500);
        expect(submenus()).toEqual([]);

        hover(row(el, 'Share'));
        vi.advanceTimersByTime(200);
        expect(labels(submenus()[0])).toEqual(['Email', 'Link']);
    });

    it('swaps submenus at once when another submenu item is hovered', () => {
        const el = openMenu();
        hoverOpenShare(el);
        hover(row(el, 'Export'));
        expect(submenus().map(labels)).toEqual([['PDF', 'PNG']]);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(false);
        expect(row(el, 'Export').classList.contains('has-open-submenu')).toBe(true);
    });

    it('closes the submenu shortly after another item is hovered', () => {
        const el = openMenu();
        hoverOpenShare(el);
        hover(row(el, 'Open'));
        expect(focused(el)).toBe('Open');
        expect(submenus()).toHaveLength(1);
        vi.advanceTimersByTime(50);
        expect(submenus()).toEqual([]);
        expect(row(el, 'Share').classList.contains('has-open-submenu')).toBe(false);
    });

    it('closes the submenu when a separator or disabled item is hovered', () => {
        const el = openMenu();
        hoverOpenShare(el);
        hover(row(el, 'Locked'));
        expect(submenus()).toEqual([]);
        expect(focused(el)).toBeNull();
    });

    it('keeps the submenu while the cursor is over it or its parent item', () => {
        const el = openMenu();
        const sub = hoverOpenShare(el);

        // Parent item to submenu: leaving the item starts a close the submenu cancels.
        leave(row(el, 'Share'));
        hover(sub);
        vi.advanceTimersByTime(500);
        expect(submenus()).toEqual([sub]);

        // No mouseenter reached the submenu, but the cursor is inside its box.
        moveMouse(MENU_WIDTH + 50, ROW + 10);
        leave(row(el, 'Share'));
        vi.advanceTimersByTime(500);
        expect(submenus()).toEqual([sub]);

        // Back over the parent item.
        moveMouse(100, ROW + 10);
        leave(sub);
        vi.advanceTimersByTime(500);
        expect(submenus()).toEqual([sub]);
    });

    it('closes the submenu once the cursor leaves it for elsewhere', () => {
        const el = openMenu();
        const sub = hoverOpenShare(el);
        moveMouse(600, 400);
        leave(sub);
        vi.advanceTimersByTime(50);
        expect(submenus()).toEqual([]);
    });

    it('leaves a submenu parent alone on mouseleave when its submenu is not open', () => {
        const el = openMenu();
        hoverOpenShare(el);
        leave(row(el, 'Export'));
        vi.advanceTimersByTime(500);
        expect(submenus()).toHaveLength(1);
    });
});

// Share's submenu sits at x=202, y=28..84. A cursor moving right from Export's
// row (y=56..84) while closing in on that edge is heading for the submenu.
describe('<puter-context-menu> diagonal travel toward an open submenu', () => {
    const headForSubmenu = () => {
        moveMouse(50, 80);
        moveMouse(120, 70);
    };
    const stopShortOfSubmenu = () => {
        moveMouse(120, 75);
        moveMouse(120, 80);
    };
    const traversing = el => menuRoot(el).classList.contains('safe-traverse');

    it('does not swap submenus while the cursor crosses another submenu item', () => {
        const el = openMenu();
        const sub = hoverOpenShare(el);
        headForSubmenu();
        hover(row(el, 'Export'));
        expect(traversing(el)).toBe(true);
        expect(focused(el)).toBeNull();
        vi.advanceTimersByTime(100);
        expect(submenus()).toEqual([sub]);

        // Reaching the submenu ends the traversal and keeps it open.
        hover(sub);
        vi.advanceTimersByTime(1000);
        expect(traversing(el)).toBe(false);
        expect(submenus()).toEqual([sub]);
        expect(focused(el)).toBeNull();
    });

    it('commits to the crossed submenu item once the cursor stops heading for the old one', () => {
        const el = openMenu();
        hoverOpenShare(el);
        headForSubmenu();
        hover(row(el, 'Export'));
        vi.advanceTimersByTime(100);
        stopShortOfSubmenu();
        vi.advanceTimersByTime(300);
        expect(traversing(el)).toBe(false);
        expect(submenus().map(labels)).toEqual([['PDF', 'PNG']]);
        expect(row(el, 'Export').classList.contains('has-open-submenu')).toBe(true);
    });

    it('defers the highlight of a plain item crossed on the way', () => {
        // Rows: Share (0..28) with its submenu at y=0..56, then Open (28..56).
        const el = openMenu([{ label: 'Share', items: [{ label: 'Email' }, { label: 'Link' }] }, { label: 'Open' }]);
        hover(row(el, 'Share'));
        vi.advanceTimersByTime(200);
        frame();
        moveMouse(50, 50);
        moveMouse(120, 40);
        hover(row(el, 'Open'));
        expect(traversing(el)).toBe(true);
        expect(focused(el)).toBeNull();
        expect(submenus()).toHaveLength(1);

        vi.advanceTimersByTime(100);
        moveMouse(120, 45);
        moveMouse(120, 50);
        vi.advanceTimersByTime(300);
        expect(submenus()).toEqual([]);
        expect(focused(el)).toBe('Open');
        expect(traversing(el)).toBe(false);
    });

    it('keeps the submenu while the cursor crosses a separator or disabled item', () => {
        const el = openMenu();
        const sub = hoverOpenShare(el);
        headForSubmenu();
        hover(rows(el)[3]);
        expect(traversing(el)).toBe(true);
        expect(submenus()).toEqual([sub]);
        hover(row(el, 'Locked'));
        expect(submenus()).toEqual([sub]);

        vi.advanceTimersByTime(100);
        stopShortOfSubmenu();
        vi.advanceTimersByTime(300);
        expect(submenus()).toEqual([]);
        expect(traversing(el)).toBe(false);
    });

    it('judges the direction of travel against the edge a left-opening submenu faces', () => {
        vi.stubGlobal('innerWidth', 600);
        // The menu sits at x=300..500, so Share's submenu opens leftwards at x=98..298, y=0..56.
        const el = openMenu([
            { label: 'Share', items: [{ label: 'Email' }, { label: 'Link' }] },
            { label: 'Open' },
        ], { x: 300, y: 0 });
        row(el, 'Share').click();
        frame();
        const sub = submenus()[0];
        expect(sub.style.left).toBe('98px');

        moveMouse(450, 50);
        moveMouse(380, 40);
        hover(row(el, 'Open'));
        expect(traversing(el)).toBe(true);
        expect(submenus()).toEqual([sub]);
    });
});

describe('<puter-context-menu> on small screens', () => {
    const backdrop = () => [...document.body.children].find(node => node.tagName === 'DIV');

    beforeEach(() => {
        vi.stubGlobal('innerWidth', 400);
    });

    it('opens as a bottom sheet over a backdrop', () => {
        const el = openMenu(ITEMS(), { x: 120, y: 80 });
        expect(el.classList.contains('sheet-mode')).toBe(true);
        expect(el.style.left).toBe('');
        expect(backdrop().style.opacity).toBe('1');
    });

    it('also opens as a sheet on a touch device narrower than a tablet', () => {
        vi.stubGlobal('innerWidth', 700);
        vi.stubGlobal('matchMedia', query => ({
            matches: query === '(pointer: coarse)',
            addEventListener: () => {},
            removeEventListener: () => {},
        }));
        expect(openMenu().classList.contains('sheet-mode')).toBe(true);
        vi.stubGlobal('innerWidth', 800);
        expect(openMenu().classList.contains('sheet-mode')).toBe(false);
    });

    it('slides out and removes the backdrop when the backdrop is tapped', () => {
        const el = openMenu();
        const events = record(el, 'close');
        const shade = backdrop();
        shade.click();
        expect(events).toEqual([['close', {}]]);
        expect(el.classList.contains('sheet-closing')).toBe(true);
        expect(shade.style.opacity).toBe('0');
        expect(el.isConnected).toBe(true);
        vi.advanceTimersByTime(250);
        expect(el.isConnected).toBe(false);
        expect(shade.isConnected).toBe(false);
    });

    it('replaces the sheet with the submenu sheet, sharing one backdrop', () => {
        const el = openMenu();
        row(el, 'Share').click();
        frame();
        const sub = submenus()[0];
        expect(sub.classList.contains('sheet-mode')).toBe(true);
        expect(el.style.display).toBe('none');
        expect([...document.body.children].filter(node => node.tagName === 'DIV')).toHaveLength(1);
        // Sheets stack below their parent item rather than beside it.
        expect([sub.style.left, sub.style.top]).toEqual(['0px', `${2 * ROW + 2}px`]);

        // A tap leaves the item on touch devices; that must not close the submenu.
        leave(row(el, 'Share'));
        vi.advanceTimersByTime(500);
        expect(submenus()).toEqual([sub]);
    });

    it('brings the parent sheet back when the submenu is dismissed with ArrowLeft', () => {
        const el = openMenu();
        row(el, 'Share').click();
        frame();
        press('ArrowLeft');
        expect(submenus()).toEqual([]);
        expect(el.style.display).toBe('');
        expect(focused(el)).toBe('Share');
    });

    it('brings the parent sheet back when the submenu closes on Escape', () => {
        const el = openMenu();
        row(el, 'Share').click();
        frame();
        press('Escape');
        vi.advanceTimersByTime(250);
        expect(submenus()).toEqual([]);
        expect(el.style.display).toBe('');
        expect(backdrop()).toBeDefined();
    });

    it('closes the hidden parent without animating it when a submenu item is chosen', () => {
        const items = ITEMS();
        const el = openMenu(items);
        const events = record(el, 'select', 'close');
        row(el, 'Share').click();
        frame();
        const sub = submenus()[0];
        row(sub, 'Email').click();
        expect(events).toEqual([['select', items[1].items[0]], ['close', {}]]);
        expect(el.isConnected).toBe(false);
        // The visible submenu sheet is the one that slides out.
        expect(sub.classList.contains('sheet-closing')).toBe(true);
        vi.advanceTimersByTime(250);
        expect(openMenus()).toBe(0);
        expect(backdrop()).toBeUndefined();
    });

    it('keeps a submenu sheet inside a very small viewport', () => {
        vi.stubGlobal('innerWidth', 150);
        vi.stubGlobal('innerHeight', 100);
        const el = openMenu();
        row(el, 'Export').click();
        frame();
        const sub = submenus()[0];
        expect([sub.style.left, sub.style.top]).toEqual(['0px', `${100 - 2 * ROW - 10}px`]);
    });
});
