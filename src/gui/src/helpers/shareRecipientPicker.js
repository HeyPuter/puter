/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { avatarHue, avatarInitial } from './shareAvatar.js';
import { colleagues_for_sharing } from './shareTeams.js';
import { recent_recipients, remember_recipient } from './shareRecents.js';
import { build_suggestions, recipient_for } from './shareSuggest.js';

// Turns the sharing dialogs' recipient field into one control for every kind of
// recipient: a colleague, a whole team, someone shared with before, or an
// address typed from scratch. Shared by both dialogs so the two can't drift;
// each styles the `share-suggest-*` classes through its own tokens.

const teamIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const clearIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// Distinguishes one open dialog's listbox from another's, since the field
// points at it by id.
let picker_seq = 0;

/**
 * What the field currently resolves to.
 *
 * @typedef {Object} ChosenRecipient
 * @property {string|{ team: string }} value - What to hand `puter.fs.share`
 * @property {string} label - What to call them on screen
 * @property {import('./shareSuggest.js').Suggestion|null} picked - The offer
 *   that was chosen, or null when the address was typed
 */

/**
 * Wires a suggesting combobox onto an existing recipient `<input>`.
 *
 * The field is locked once an offer is chosen — a team is shared with by uid,
 * so its name left loose in an editable field would be sent as a username. Any
 * printable key, Backspace or the clear button unlocks it again.
 *
 * @param {Object} opts
 * @param {jQuery} opts.$input - The recipient field, already in the document
 * @param {jQuery} opts.$row - The row holding it; the list opens below this
 * @param {() => Iterable<string>} [opts.excluded] - Keys already on the access
 *   list, which are not worth offering again
 * @param {() => void} [opts.onChange] - Called whenever the field resolves to
 *   something different (for the Share button's enabled state)
 * @returns {{
 *   recipient: () => ChosenRecipient|null,
 *   setTeams: (teams: Array<Object>) => void,
 *   remember: (chosen: ChosenRecipient|null, created?: Array<Object>) => void,
 *   clear: () => void,
 *   close: () => void,
 *   destroy: () => void,
 * }}
 */
export default function shareRecipientPicker ({
    $input,
    $row,
    excluded = () => [],
    onChange = () => {},
}) {
    const list_id = `share-suggest-list-${++picker_seq}`;

    const $field = $('<div class="share-suggest-field"></div>');
    // Both dialogs focus this field as they open, and an element that leaves
    // the document — which is what moving it into the wrapper does — takes its
    // focus with it. Put it back rather than leaving the caller to notice.
    const had_focus = document.activeElement === $input.get(0);
    $input.before($field);
    $field.append($input);
    if ( had_focus ) $input.get(0)?.focus({ preventScroll: true });
    const $clear = $(`<button type="button" class="share-suggest-clear" hidden
        aria-label="${i18n('share_clear_recipient')}" title="${i18n('share_clear_recipient')}">${clearIcon}</button>`);
    $field.append($clear);

    const $panel = $(`<div class="share-suggest" hidden>
        <ul class="share-suggest-list" id="${list_id}" role="listbox" aria-label="${i18n('share_suggestions')}"></ul>
    </div>`);
    const $note = $(`<p class="share-suggest-note" hidden>${i18n('share_team_note')}</p>`);
    // The list floats over what is below it rather than pushing it down: a
    // dialog that grows and shrinks under the cursor is worse than one that is
    // briefly covered. It goes *inside* the row so the row is its containing
    // block — as a sibling it would resolve against whatever is positioned
    // further up — and being out of flow, the row's own layout is untouched.
    $row.addClass('share-suggest-anchor').append($panel).after($note);

    // The class is what the locked-field styling hangs on: each dialog's own
    // input rules match at a specificity a bare descendant selector loses to.
    $input
        .addClass('share-suggest-input')
        .attr('role', 'combobox')
        .attr('aria-expanded', 'false')
        .attr('aria-controls', list_id)
        .attr('aria-autocomplete', 'list');

    /** @type {Array<Object>} */ let teams = [];
    /** @type {Array<Object>} */ let members = [];
    /** @type {Array<Object>} */ let recents = [];
    /** @type {Promise<void>|null} */ let loading = null;
    let loaded = false;
    // Bumped whenever the teams change, so a load started for the old set
    // cannot land on top of the new one.
    let load_gen = 0;
    let destroyed = false;

    /** @type {import('./shareSuggest.js').Suggestion|null} */ let picked = null;
    /** @type {import('./shareSuggest.js').Suggestion[]} */ let shown = [];
    let active = -1;
    let open = false;

    // -- Data --

    /** Loaded on first use, not on open: a dialog nobody types in costs nothing. */
    const ensure_loaded = () => {
        if ( loading ) return loading;
        const gen = ++load_gen;
        loading = Promise.all([
            colleagues_for_sharing(teams),
            recent_recipients(),
        ]).then(([colleagues, seen]) => {
            if ( gen !== load_gen ) return;
            members = colleagues;
            recents = seen;
            loaded = true;
        }).catch(() => {
            // Neither source rejects in practice; an empty list is the answer
            // either way, and the field still takes a typed address.
            if ( gen === load_gen ) loaded = true;
        });
        return loading;
    };

    const current_suggestions = () => build_suggestions({
        query: String($input.val() ?? ''),
        teams,
        members,
        recents,
        exclude: excluded(),
        self: window.user?.username ?? null,
    });

    // -- Placement --

    // What the list needs beyond its own rows: the gap under the row, the
    // panel's border and padding, and a little air at the clipping edge.
    const CHROME = 24;
    // How tall the list may grow before it scrolls, matching the CSS ceiling.
    const MAX_HEIGHT = 232;
    const MIN_HEIGHT = 120;

    /**
     * The box the list has to stay inside: the viewport, narrowed to the
     * nearest ancestor that clips — the modal's scrolling body in one dialog
     * and the window's in the other. Both bound it, and a dialog dragged low
     * on a short screen has a clipping ancestor that reaches past the fold.
     */
    const clip_box = () => {
        const bottom = window.innerHeight || 0;
        let el = $row.get(0)?.parentElement;
        while ( el && el !== document.body ) {
            const style = getComputedStyle(el);
            if ( /auto|scroll|hidden/.test(`${style.overflowY}${style.overflowX}`) ) {
                const box = el.getBoundingClientRect();
                return {
                    top: Math.max(box.top, 0),
                    bottom: Math.min(box.bottom, bottom),
                };
            }
            el = el.parentElement;
        }
        return { top: 0, bottom };
    };

    /**
     * Fits the open list to the room around the field. Being out of the flow,
     * it would otherwise be cut off by that clipping ancestor rather than
     * scroll; where below is too tight and above is roomier, it opens upwards.
     */
    const place = () => {
        const row = $row.get(0)?.getBoundingClientRect();
        if ( ! row ) return;
        const clip = clip_box();
        const below = clip.bottom - row.bottom - CHROME;
        const above = row.top - clip.top - CHROME;
        const up = below < MIN_HEIGHT && above > below;
        $panel.toggleClass('share-suggest-above', up);
        $panel.find('.share-suggest-list').css(
            'max-height',
            `${Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, up ? above : below)))}px`,
        );
    };

    // -- Rendering --

    /** The muted second line: what this row is. `i18n` encodes unless told not to. */
    const sub_line = (suggestion, encode) => {
        if ( suggestion.kind === 'team' ) return i18n('share_suggest_team', {}, encode);
        if ( suggestion.teamName ) {
            return i18n('share_suggest_in_team', { team: suggestion.teamName }, encode);
        }
        return suggestion.recent ? i18n('share_suggest_recent', {}, encode) : '';
    };

    const option_html = (suggestion, index) => {
        const name = html_encode(suggestion.name);
        const sub = sub_line(suggestion, true);
        // The name alone reads as bare text to a screen reader, which cannot
        // tell a team from a person; the label spells out which this is.
        const raw_sub = sub_line(suggestion, false);
        const aria = raw_sub ? `${suggestion.name} — ${raw_sub}` : suggestion.name;
        const mark = suggestion.kind === 'team'
            ? `<span class="share-suggest-avatar share-suggest-avatar-team" aria-hidden="true">${teamIcon}</span>`
            : `<span class="share-suggest-avatar" style="--share-avatar-hue: ${avatarHue(suggestion.name)}" aria-hidden="true">${html_encode(avatarInitial(suggestion.name))}</span>`;
        return `<li class="share-suggest-option" role="option" aria-selected="false"
                id="${list_id}-${index}" data-index="${index}" aria-label="${html_encode(aria)}">
                ${mark}
                <span class="share-suggest-text">
                    <span class="share-suggest-name">${name}</span>
                    ${sub ? `<span class="share-suggest-sub">${sub}</span>` : ''}
                </span>
            </li>`;
    };

    const paint_active = () => {
        $panel.find('.share-suggest-option').each(function (index) {
            const on = index === active;
            $(this).toggleClass('share-suggest-active', on).attr('aria-selected', on ? 'true' : 'false');
        });
        $input.attr(
            'aria-activedescendant',
            active >= 0 ? `${list_id}-${active}` : null,
        );
    };

    const render = () => {
        if ( destroyed ) return;
        if ( ! loaded ) {
            shown = [];
            active = -1;
            $panel.find('.share-suggest-list')
                .html(`<li class="share-suggest-loading" role="presentation">${i18n('share_suggest_loading')}</li>`);
            $panel.prop('hidden', false);
            $input.attr('aria-expanded', 'true');
            place();
            paint_active();
            return;
        }
        shown = current_suggestions();
        // Nothing to offer is not worth a panel saying so: what the user typed
        // is a perfectly good recipient, and an empty box would only cover it.
        if ( shown.length === 0 ) return close();
        active = -1;
        $panel.find('.share-suggest-list')
            .html(shown.map((suggestion, index) => option_html(suggestion, index)).join(''));
        $panel.prop('hidden', false);
        $input.attr('aria-expanded', 'true');
        place();
        paint_active();
    };

    // -- Opening and closing --

    const open_list = () => {
        if ( picked ) return;
        open = true;
        render();
        if ( ! loaded ) ensure_loaded().then(() => { if ( open ) render(); });
    };

    const close = () => {
        open = false;
        active = -1;
        $panel.prop('hidden', true);
        $input.attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
    };

    const move = (step) => {
        if ( shown.length === 0 ) return;
        active = active < 0
            ? (step > 0 ? 0 : shown.length - 1)
            : (active + step + shown.length) % shown.length;
        paint_active();
        $panel.find('.share-suggest-option').eq(active).get(0)
            ?.scrollIntoView?.({ block: 'nearest' });
    };

    // -- Choosing --

    const pick = (suggestion) => {
        if ( ! suggestion ) return;
        picked = suggestion;
        $input.val(suggestion.name).prop('readonly', true).attr('aria-readonly', 'true');
        $field.addClass('share-suggest-picked');
        $clear.prop('hidden', false);
        $note.prop('hidden', suggestion.kind !== 'team');
        close();
        $input.get(0)?.focus({ preventScroll: true });
        onChange();
    };

    /** Empties the field and hands it back to the keyboard. */
    const unpick = ({ focus = true } = {}) => {
        if ( ! picked ) return;
        picked = null;
        $input.prop('readonly', false).removeAttr('aria-readonly').val('');
        $field.removeClass('share-suggest-picked');
        $clear.prop('hidden', true);
        $note.prop('hidden', true);
        if ( focus ) $input.get(0)?.focus({ preventScroll: true });
        onChange();
    };

    // -- Input wiring --

    // Opened by a real interaction, not by focus: both dialogs focus this field
    // as they open, and a list unfurled before the user has looked at the
    // dialog would push everything else out of view.
    $input.on('click', () => open_list());

    $input.on('input', () => {
        open_list();
        onChange();
    });

    $input.on('keydown', (e) => {
        if ( e.key === 'ArrowDown' ) {
            e.preventDefault();
            if ( picked ) return;
            if ( open ) move(1);
            else open_list();
            return;
        }
        if ( e.key === 'ArrowUp' ) {
            e.preventDefault();
            if ( open ) move(-1);
            return;
        }
        if ( e.key === 'Enter' ) {
            if ( open && active >= 0 ) {
                // Enter chooses the highlighted row; it must not also submit
                // the form with whatever half-typed text is in the field.
                e.preventDefault();
                pick(shown[active]);
            }
            return;
        }
        if ( e.key === 'Escape' ) {
            if ( ! open ) return;
            // The dialogs close on Escape from the document; a list that is up
            // spends the first press.
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if ( e.key === 'Tab' ) {
            close();
            return;
        }
        if ( ! picked ) return;
        if ( e.key === 'Backspace' || e.key === 'Delete' ) {
            e.preventDefault();
            unpick();
            open_list();
            return;
        }
        // Typing over a locked field replaces what was chosen, rather than
        // reading as a dead key. Unlocking here lets this keystroke land.
        if ( e.key.length === 1 && ! e.metaKey && ! e.ctrlKey && ! e.altKey ) {
            unpick({ focus: false });
        }
    });

    $clear.on('click', () => {
        unpick();
        open_list();
    });

    // Down first, so the field doesn't blur out from under the click.
    $panel.on('mousedown', '.share-suggest-option', (e) => e.preventDefault());
    $panel.on('click', '.share-suggest-option', function () {
        pick(shown[Number($(this).attr('data-index'))]);
    });

    const on_document_mousedown = (e) => {
        if ( ! open ) return;
        if ( $field.get(0)?.contains(e.target) || $panel.get(0)?.contains(e.target) ) return;
        close();
    };
    $(document).on(`mousedown.${list_id}`, on_document_mousedown);
    // The list follows the row on its own; only how much room it has changes.
    $(window).on(`resize.${list_id}`, () => { if ( open ) place(); });

    // -- What the dialog needs from it --

    const recipient = () => {
        if ( picked ) {
            return { value: recipient_for(picked), label: picked.name, picked };
        }
        const typed = String($input.val() ?? '').trim();
        return typed === '' ? null : { value: typed, label: typed, picked: null };
    };

    /**
     * What to file a successful share under. A typed address that turned out to
     * belong to an account is filed under the username the backend resolved, so
     * it lines up with the access list next time.
     */
    const entry_for = (chosen, created) => {
        if ( chosen.picked ) {
            return { kind: chosen.picked.kind, id: chosen.picked.id, name: chosen.picked.name };
        }
        const made = (Array.isArray(created) ? created : []).find(Boolean);
        if ( made?.pending && made.recipientEmail ) {
            return { kind: 'invite', id: made.recipientEmail, name: made.recipientEmail };
        }
        if ( made?.holder ) {
            return { kind: 'user', id: made.holder, name: made.holder };
        }
        const typed = String(chosen.value);
        return { kind: typed.includes('@') ? 'invite' : 'user', id: typed, name: typed };
    };

    return {
        recipient,

        setTeams: (next) => {
            teams = Array.isArray(next) ? next : [];
            // The roster follows from the teams, so it has to be looked up again.
            loading = null;
            loaded = false;
            if ( open ) open_list();
        },

        remember: (chosen, created) => {
            if ( ! chosen ) return;
            const entry = entry_for(chosen, created);
            // The dialog stays usable whether or not the store takes it, so
            // this neither blocks nor reports.
            remember_recipient(entry).then((next) => { recents = next; }).catch(() => {});
        },

        clear: () => {
            unpick({ focus: false });
            $input.val('');
            close();
            onChange();
        },

        close,

        destroy: () => {
            destroyed = true;
            close();
            $(document).off(`mousedown.${list_id}`);
            $(window).off(`resize.${list_id}`);
        },
    };
}
