/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'html-entities';

const ACME = { uid: 't-1', name: 'Acme', handle: 'acme' };

let shareRecipientPicker;
let forget_colleagues;
let forget_recent_recipients;

beforeAll(async () => {
    const jquery = await import('../lib/jquery-3.6.1/jquery-3.6.1.min.js');
    globalThis.$ = globalThis.jQuery = jquery.default ?? window.jQuery;
    globalThis.html_encode = (str) => encode(str);
    await import('../i18n/i18n.js'); // installs window.i18n
    globalThis.i18n = window.i18n;
    // The list scrolls its active row into view; jsdom has no such method.
    Element.prototype.scrollIntoView ??= () => {};

    ({ default: shareRecipientPicker } = await import('./shareRecipientPicker.js'));
    ({ forget_colleagues } = await import('./shareTeams.js'));
    ({ forget_recent_recipients } = await import('./shareRecents.js'));
});

/** Every picker this test mounted, so none outlives its case. */
let mounted = [];

/** Renders the markup both dialogs share and attaches a picker to it. */
const mount = (opts = {}) => {
    document.body.innerHTML = `
        <div class="host">
            <div class="row">
                <input type="text" class="recipient" />
                <select class="mode"><option value="read">read</option></select>
            </div>
        </div>`;
    const $input = $('.recipient');
    const picker = shareRecipientPicker({
        $input,
        $row: $('.row'),
        ...opts,
    });
    mounted.push(picker);
    return { picker, $input };
};

const document_mousedown_count = () =>
    ($._data(document, 'events')?.mousedown ?? []).length;

const options = () => $('.share-suggest-option').toArray()
    .map((el) => $(el).find('.share-suggest-name').text());

/** Lets the picker's data load (colleagues + recents) and repaint. */
const settle = async () => {
    for ( let i = 0; i < 6; i++ ) await Promise.resolve();
};

beforeEach(() => {
    window.user = { username: 'me' };
    forget_colleagues();
    forget_recent_recipients();
    globalThis.puter = {
        teams: {
            listMembers: vi.fn(async () => [
                { username: 'me' },
                { username: 'bob' },
                { username: 'carol' },
            ]),
        },
        kv: {
            get: vi.fn(async () => [
                { kind: 'invite', id: 'ann@example.com', name: 'ann@example.com' },
            ]),
            set: vi.fn(async () => true),
        },
    };
});

afterEach(() => {
    mounted.forEach((picker) => picker.destroy());
    mounted = [];
    document.body.innerHTML = '';
});

describe('opening the list', () => {
    it('stays shut until the field is actually used', async () => {
        const { $input } = mount();
        // Both dialogs focus this field as they open; that must not unfurl a
        // list over everything else before the user has looked at the dialog.
        $input.trigger('focus');
        await settle();
        expect($('.share-suggest').prop('hidden')).toBe(true);
    });

    it('offers teams, colleagues and past recipients on a click', async () => {
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();

        expect($('.share-suggest').prop('hidden')).toBe(false);
        expect(options()).toEqual(['ann@example.com', 'Acme', 'bob', 'carol']);
        // Never the signed-in user themselves.
        expect(options()).not.toContain('me');
    });

    it('narrows to what is typed', async () => {
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();

        $input.val('ca').trigger('input');
        expect(options()).toEqual(['carol']);
    });

    it('closes rather than showing an empty box, since typed text is enough', async () => {
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();

        $input.val('nobody-here').trigger('input');
        expect($('.share-suggest').prop('hidden')).toBe(true);
    });

    it('floats off the row instead of taking part in the layout', async () => {
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();

        // Opening must not push anything down: the panel hangs off the row,
        // which the anchor class makes a positioning context.
        expect($('.row').hasClass('share-suggest-anchor')).toBe(true);
        expect($('.share-suggest').parent().is('.row')).toBe(true);
        // The list is capped to the room around the field, not left to grow.
        expect($('.share-suggest-list').get(0).style.maxHeight).toMatch(/px$/);
    });

    it('leaves out whoever the access list already covers', async () => {
        const { picker, $input } = mount({ excluded: () => ['user:bob', 'team:t-1'] });
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();

        expect(options()).toEqual(['ann@example.com', 'carol']);
    });
});

describe('choosing someone', () => {
    const open = async (opts) => {
        const mounted = mount(opts);
        mounted.picker.setTeams([ACME]);
        mounted.$input.trigger('click');
        await settle();
        return mounted;
    };

    it('hands a team to the share call by uid, not by name', async () => {
        const { picker } = await open();
        $('.share-suggest-option').eq(1).trigger('click');

        expect(picker.recipient()).toMatchObject({
            value: { team: 't-1' },
            label: 'Acme',
        });
    });

    it('hands a typed address over untouched', async () => {
        const { picker, $input } = mount();
        $input.val('  someone@example.com  ').trigger('input');
        expect(picker.recipient()).toMatchObject({
            value: 'someone@example.com',
            picked: null,
        });
    });

    it('resolves to nothing while the field is empty', () => {
        const { picker } = mount();
        expect(picker.recipient()).toBe(null);
    });

    it('locks the field, so a team name cannot be edited into a username', async () => {
        const { $input } = await open();
        $('.share-suggest-option').eq(1).trigger('click');

        expect($input.val()).toBe('Acme');
        expect($input.prop('readonly')).toBe(true);
        expect($('.share-suggest-clear').prop('hidden')).toBe(false);
        // Sharing with a team reaches everyone in it, which is worth saying.
        expect($('.share-suggest-note').prop('hidden')).toBe(false);
    });

    it('unlocks on the clear button and offers the list again', async () => {
        const { picker } = await open();
        $('.share-suggest-option').eq(1).trigger('click');
        $('.share-suggest-clear').trigger('click');

        expect(picker.recipient()).toBe(null);
        expect($('.recipient').prop('readonly')).toBe(false);
        expect($('.share-suggest-note').prop('hidden')).toBe(true);
        expect($('.share-suggest').prop('hidden')).toBe(false);
    });

    it('unlocks on Backspace rather than reading as a dead key', async () => {
        const { picker, $input } = await open();
        $('.share-suggest-option').eq(1).trigger('click');
        $input.trigger($.Event('keydown', { key: 'Backspace' }));

        expect(picker.recipient()).toBe(null);
        expect($input.prop('readonly')).toBe(false);
    });

    it('replaces the choice when the user just types over it', async () => {
        const { $input } = await open();
        $('.share-suggest-option').eq(1).trigger('click');
        $input.trigger($.Event('keydown', { key: 'x' }));

        // Unlocked and emptied inside the keydown, so the browser's own
        // insertion of that keystroke lands in a field holding just it.
        expect($input.prop('readonly')).toBe(false);
        expect($input.val()).toBe('');
    });

    it('tells the dialog whenever the field resolves to something new', async () => {
        const onChange = vi.fn();
        const { $input } = await open({ onChange });
        onChange.mockClear();

        $input.val('bo').trigger('input');
        expect(onChange).toHaveBeenCalledTimes(1);
        $('.share-suggest-option').eq(0).trigger('click');
        expect(onChange).toHaveBeenCalledTimes(2);
    });
});

describe('keyboard', () => {
    const open = async () => {
        const mounted = mount();
        mounted.picker.setTeams([ACME]);
        mounted.$input.trigger('click');
        await settle();
        return mounted;
    };

    const press = ($input, key, extra = {}) => {
        const event = $.Event('keydown', { key, ...extra });
        $input.trigger(event);
        return event;
    };

    it('walks the list with the arrow keys and takes the row on Enter', async () => {
        const { picker, $input } = await open();
        press($input, 'ArrowDown');
        press($input, 'ArrowDown');

        expect($('.share-suggest-option').eq(1).attr('aria-selected')).toBe('true');
        expect($input.attr('aria-activedescendant'))
            .toBe($('.share-suggest-option').eq(1).attr('id'));

        press($input, 'Enter');
        expect(picker.recipient().label).toBe('Acme');
    });

    it('wraps around the ends rather than stopping dead', async () => {
        const { $input } = await open();
        press($input, 'ArrowUp');
        expect($('.share-suggest-option').last().attr('aria-selected')).toBe('true');
        press($input, 'ArrowDown');
        expect($('.share-suggest-option').eq(0).attr('aria-selected')).toBe('true');
    });

    it('leaves Enter to the form when no row is highlighted', async () => {
        const { $input } = await open();
        const event = press($input, 'Enter');
        expect(event.isDefaultPrevented()).toBe(false);
    });

    it('spends the first Escape on the list, not on the dialog', async () => {
        const { $input } = await open();
        const event = press($input, 'Escape');

        expect($('.share-suggest').prop('hidden')).toBe(true);
        // The dialogs close on Escape from the document; this one must not reach it.
        expect(event.isPropagationStopped()).toBe(true);

        const second = press($input, 'Escape');
        expect(second.isPropagationStopped()).toBe(false);
    });

    it('closes on Tab so the list does not follow focus away', async () => {
        const { $input } = await open();
        press($input, 'Tab');
        expect($('.share-suggest').prop('hidden')).toBe(true);
    });
});

describe('recording who was shared with', () => {
    it('files a chosen team under its uid', async () => {
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();
        $('.share-suggest-option').eq(1).trigger('click');

        picker.remember(picker.recipient(), [{ entryUid: 'e-1' }]);
        await settle();
        expect(puter.kv.set).toHaveBeenCalledWith('recent_share_recipients', [
            { kind: 'team', id: 't-1', name: 'Acme' },
            { kind: 'invite', id: 'ann@example.com', name: 'ann@example.com' },
        ]);
    });

    it('files a typed address under the username the backend resolved', async () => {
        const { picker, $input } = mount();
        $input.val('bob@example.com').trigger('input');

        picker.remember(picker.recipient(), [{ holder: 'bob', isNew: true }]);
        await settle();
        expect(puter.kv.set.mock.calls[0][1][0])
            .toEqual({ kind: 'user', id: 'bob', name: 'bob' });
    });

    it('files an invitation under the address it went to', async () => {
        const { picker, $input } = mount();
        $input.val('new@example.com').trigger('input');

        picker.remember(picker.recipient(), [
            { pending: true, recipientEmail: 'new@example.com' },
        ]);
        await settle();
        expect(puter.kv.set.mock.calls[0][1][0])
            .toEqual({ kind: 'invite', id: 'new@example.com', name: 'new@example.com' });
    });

    it('records nothing when there was no recipient', async () => {
        const { picker } = mount();
        picker.remember(null);
        await settle();
        expect(puter.kv.set).not.toHaveBeenCalled();
    });
});

describe('teardown', () => {
    it('stops listening on the document when the dialog closes', async () => {
        const before = document_mousedown_count();
        const { picker, $input } = mount();
        picker.setTeams([ACME]);
        $input.trigger('click');
        await settle();
        expect(document_mousedown_count()).toBe(before + 1);

        picker.destroy();
        expect($('.share-suggest').prop('hidden')).toBe(true);
        // A stray document handler would keep the detached dialog alive.
        expect(document_mousedown_count()).toBe(before);
    });
});
