// @vitest-environment jsdom
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthGlobals, tick } from './authTestSetup.js';

const { default: openAuthFlow, activeAuthFlow, authFlowOptions, authHeadHtml, joinAuthFlow, navigateAfterSignIn } = await import('./authFlow.js');

const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const backdropClick = () => {
    const el = $('.auth-dialog-overlay').last().get(0);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
};

beforeEach(() => {
    resetAuthGlobals();
    activeAuthFlow()?.finish(false);
});

describe('openAuthFlow', () => {
    it('mounts one card over everything, not a window', async () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<h1 class="auth-title">A</h1>' });
        await tick();
        expect($('.auth-dialog-overlay.dashboard-dialog-overlay')).toHaveLength(1);
        expect($('.window')).toHaveLength(0);
        expect($('.auth-dialog').attr('aria-labelledby')).toBe($('.auth-title').attr('id'));
    });

    it('shows as a page, without ✕, for cover pages and every popup', () => {
        openAuthFlow({ page: true }).finish(false);
        window.embedded_in_popup = true;
        const flow = openAuthFlow();
        expect(flow.page).toBe(true);
        expect($('.auth-dialog-overlay').last().hasClass('auth-dialog-page')).toBe(true);
    });

    it('lets ✕ and Escape dismiss a dialog, settling false', async () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input>' });
        key($('.auth-dialog input').get(0), 'Escape');
        await expect(flow.result).resolves.toBe(false);
        expect(activeAuthFlow()).toBeNull();

        const second = openAuthFlow();
        second.push({ name: 'a', html: '' });
        $('.dashboard-dialog-close').last().trigger('click');
        await expect(second.result).resolves.toBe(false);
    });

    it('keeps a page up: no ✕, Escape and backdrop do nothing', async () => {
        const flow = openAuthFlow({ page: true });
        flow.push({ name: 'a', html: '<input>' });
        await tick();
        expect($('.dashboard-dialog-close')).toHaveLength(0);
        key($('.auth-dialog input').get(0), 'Escape');
        backdropClick();
        expect(flow.isClosed()).toBe(false);
    });

    it('ignores the backdrop unless asked, so a stray click keeps typed credentials', async () => {
        const kept = openAuthFlow();
        kept.push({ name: 'a', html: '' });
        await tick();
        backdropClick();
        expect(kept.isClosed()).toBe(false);
        kept.finish(false);

        const closing = openAuthFlow({ closeOnBackdrop: true });
        closing.push({ name: 'a', html: '' });
        await tick();
        backdropClick();
        await expect(closing.result).resolves.toBe(false);
    });

    it('holds Escape while busy; only ✕ dismisses then', async () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input>' });
        flow.setBusy(true);
        key($('.auth-dialog input').get(0), 'Escape');
        expect(flow.isClosed()).toBe(false);
        $('.dashboard-dialog-close').trigger('click');
        await expect(flow.result).resolves.toBe(false);
    });

    it('keeps typed keys from reaching the desktop shortcuts on the document', () => {
        const flow = openAuthFlow({ page: true });
        flow.push({ name: 'a', html: '<input>' });
        const seen = vi.fn();
        document.addEventListener('keydown', seen);
        key($('.auth-dialog input').get(0), 'Delete');
        key($('.auth-dialog input').get(0), 'Enter');
        document.removeEventListener('keydown', seen);
        expect(seen).not.toHaveBeenCalled();
    });

    it('keeps focus in the card while busy, since a locked field would drop it to the page', () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input>' });
        const el_input = $('.auth-dialog input').get(0);
        el_input.focus();
        flow.setBusy(true);
        el_input.disabled = true;
        expect(document.activeElement).toBe($('.auth-dialog').get(0));
    });

    it('hands focus back to where it was once busy ends, so Enter can retry', () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input class="one"><input class="two">' });
        const el_two = $('.auth-dialog .two').get(0);
        el_two.focus();
        flow.setBusy(true);
        el_two.disabled = true;
        el_two.disabled = false;
        flow.setBusy(false);
        expect(document.activeElement).toBe(el_two);

        // A screen that moved focus on its own keeps it there.
        flow.setBusy(true);
        $('.auth-dialog .one').get(0).focus();
        flow.setBusy(false);
        expect(document.activeElement).toBe($('.auth-dialog .one').get(0));
    });

    it('keeps focus in the card when the backdrop is pressed', async () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input>' });
        const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
        $('.auth-dialog-overlay').get(0).dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
        $('.auth-dialog-overlay').get(0).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(flow.isClosed()).toBe(false);

        const inside = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
        $('.auth-dialog input').get(0).dispatchEvent(inside);
        expect(inside.defaultPrevented).toBe(false);
    });

    it('stacks screens, keeping what was typed, with Back and goTo', () => {
        const flow = openAuthFlow();
        flow.push({ name: 'login', html: '<input class="typed">' });
        $('.typed').val('kept');
        expect($('.auth-dialog-back').prop('hidden')).toBe(true);

        const left = vi.fn();
        flow.push({ name: 'signup', html: '<p>signup</p>', onLeave: left });
        expect($('[data-screen="login"]').prop('hidden')).toBe(true);
        expect($('.auth-dialog-back').prop('hidden')).toBe(false);

        flow.back();
        expect(left).toHaveBeenCalledOnce();
        expect($('[data-screen="signup"]')).toHaveLength(0);
        expect($('[data-screen="login"]').prop('hidden')).toBe(false);
        expect($('.typed').val()).toBe('kept');

        flow.push({ name: 'signup', html: '' });
        flow.push({ name: 'recover', html: '' });
        expect(flow.goTo('login')).toBe(true);
        expect($('.auth-screen')).toHaveLength(1);
        expect(flow.goTo('nope')).toBe(false);
    });

    it('marks the card scrolled while the showing screen is, so the bar covers what passes under it', () => {
        const flow = openAuthFlow();
        const scroll = (screen, top) => {
            const el = $(`[data-screen="${screen}"] .auth-body`).get(0);
            el.scrollTop = top;
            el.dispatchEvent(new Event('scroll'));
        };
        flow.push({ name: 'a', html: '<div class="auth-body"></div>' });
        expect($('.auth-dialog').hasClass('auth-dialog-scrolled')).toBe(false);
        scroll('a', 40);
        expect($('.auth-dialog').hasClass('auth-dialog-scrolled')).toBe(true);
        flow.push({ name: 'b', html: '<div class="auth-body"></div>' });
        expect($('.auth-dialog').hasClass('auth-dialog-scrolled')).toBe(false);
        flow.back();
        expect($('.auth-dialog').hasClass('auth-dialog-scrolled')).toBe(true);
        scroll('a', 0);
        expect($('.auth-dialog').hasClass('auth-dialog-scrolled')).toBe(false);
    });

    it('offers Back on a first screen that asks for it', () => {
        const flow = openAuthFlow({ page: true });
        const back = vi.fn();
        flow.push({ name: 'only', html: '', onBack: back });
        expect($('.auth-dialog-back').prop('hidden')).toBe(false);
        $('.auth-dialog-back').trigger('click');
        expect(back).toHaveBeenCalledOnce();
    });

    it('tells waiting screens when the flow closes', () => {
        const flow = openAuthFlow();
        const left = vi.fn();
        flow.push({ name: 'a', html: '', onLeave: left });
        flow.finish(true);
        expect(left).toHaveBeenCalledOnce();
    });

    it('lets a second prompt join the open flow instead of stacking another card', async () => {
        expect(joinAuthFlow()).toBeNull();
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '' });
        const joined = joinAuthFlow();
        expect($('.auth-dialog')).toHaveLength(1);
        flow.finish(true);
        await expect(joined).resolves.toBe(true);
    });

    it('leaves the field being typed in when a second prompt joins', () => {
        const flow = openAuthFlow();
        flow.push({ name: 'a', html: '<input class="first"><input class="second">' });
        $('.second').get(0).focus();
        joinAuthFlow();
        expect(document.activeElement).toBe($('.second').get(0));

        // Focus that wandered off the card is brought back to it.
        $('.second').get(0).blur();
        joinAuthFlow();
        expect($('.auth-dialog').get(0).contains(document.activeElement)).toBe(true);
    });
});

describe('authHeadHtml', () => {
    it('makes the logo a keyboard-reachable way out only on a cover page', () => {
        const page = openAuthFlow({ page: true });
        const $page_head = $(authHeadHtml(page, 'Log in'));
        expect($page_head.find('a.auth-logo-link').attr('href')).toBe('/');
        expect($page_head.find('.auth-logo').attr('alt')).toBe('Puter');
        page.finish(false);

        const dialog = openAuthFlow();
        const $dialog_head = $(authHeadHtml(dialog, 'Log in'));
        expect($dialog_head.find('a')).toHaveLength(0);
        expect($dialog_head.find('.auth-logo').attr('alt')).toBe('');
    });

    it('explains the opener in a sign-in popup unless told not to', () => {
        window.embedded_in_popup = true;
        window.openerOrigin = 'https://builder.puter.com';
        const flow = openAuthFlow();
        const $notice = $(authHeadHtml(flow, 'Log in')).find('.auth-opener-notice');
        expect($notice).toHaveLength(1);
        expect($notice.text()).toContain('builder.puter.com');
        expect($(authHeadHtml(flow, 'Log in', { openerNotice: false })).find('.auth-opener-notice')).toHaveLength(0);
    });
});

describe('authFlowOptions', () => {
    it('defaults to reloading on success, to the page the flow started on', () => {
        const options = authFlowOptions();
        expect(options.reload_on_success).toBe(true);
        expect(options.redirect_url).toBe(window.location.href);
        expect(options.show_signup_button).toBe(true);
        expect(options.send_confirmation_code).toBe(false);
    });

    it('keeps an explicit empty redirect', () => {
        expect(authFlowOptions({ redirect_url: '' }).redirect_url).toBe('');
    });
});

describe('navigateAfterSignIn', () => {
    const withLocation = (href, run) => {
        const original = window.location;
        const replace = vi.fn();
        const reload = vi.fn();
        delete window.location;
        window.location = { href, replace, reload };
        const spy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
        let states;
        try {
            run();
        } finally {
            window.location = original;
            states = spy.mock.calls.map((call) => call[2]);
            spy.mockRestore();
        }
        return { replace, reload, states };
    };

    it('goes to another page by replacing this one', () => {
        const { replace, reload } = withLocation('https://puter.test/action/login', () => {
            navigateAfterSignIn('/');
        });
        expect(replace).toHaveBeenCalledWith('/');
        expect(reload).not.toHaveBeenCalled();
    });

    // Replacing with a hash-only change would scroll, never reload.
    it('reloads when only the hash would change, as on a dashboard tab', () => {
        const { replace, reload, states } = withLocation('https://puter.test/#files', () => {
            navigateAfterSignIn('https://puter.test/#files');
        });
        expect(replace).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledOnce();
        expect(states).toEqual(['https://puter.test/#files']);
    });
});
