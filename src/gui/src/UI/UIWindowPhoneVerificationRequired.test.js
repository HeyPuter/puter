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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        const el = document.createElement('div');
        el.className = `window ${opts.window_class}`;
        el.innerHTML = opts.body_content;
        el.onClose = opts.on_close;
        document.body.append(el);
        opts.onAppend?.(el);
        return el;
    }),
}));
vi.mock('./UIWindowCardVerificationRequired.js', () => ({ default: vi.fn(async () => false) }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindowPhoneVerificationRequired } = await import('./UIWindowPhoneVerificationRequired.js');
const { default: UIWindowCardVerificationRequired } = await import('./UIWindowCardVerificationRequired.js');

const win = () => jQuery('.window-confirm-phone-using-code');

const open = async (options) => {
    UIWindowPhoneVerificationRequired(options);
    await vi.waitFor(() => expect(win()).toHaveLength(1));
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = function () {
        this.each((_, el) => {
            el.remove();
            el.onClose?.();
        });
        return this;
    };
    globalThis.i18n = (key, vars) => (vars && ! Array.isArray(vars) && Object.keys(vars).length ? `${key}:${JSON.stringify(vars)}` : key);
    globalThis.html_encode = (value) => String(value);
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'token-1';
    window.user = {};
    window.handle401 = vi.fn();
    UIWindowCardVerificationRequired.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    delete jQuery.fn.close;
});

describe('UIWindowPhoneVerificationRequired with a number on file', () => {
    it('asks for no number and sends the code to the one on file', async () => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({});
            opts.complete?.();
        });
        await open({ phone_on_file: '42' });

        expect(win().find('.phone-number-entry').prop('hidden')).toBe(true);
        expect(win().find('.phone-step-1 .phone-subtitle').text()).toBe('phone_on_file_subtitle:{"digits":"42"}');
        expect(win().find('.phone-change-number-wrap').prop('hidden')).toBe(true);
        expect(win().find('.phone-lost-number-wrap').prop('hidden')).toBe(false);

        win().find('.phone-send-btn').trigger('click');
        await vi.waitFor(() => expect(ajax).toHaveBeenCalled());
        expect(ajax.mock.calls[0][0]).toMatchObject({
            url: 'https://api.puter.test/send-confirm-phone',
            data: JSON.stringify({}),
        });
        expect(win().find('.phone-target').text()).toBe('•••• 42');
    });

    it('reads the number from the signed-in user when the caller passes none', async () => {
        window.user = { phone_on_file: '07' };
        await open({});
        expect(win().find('.phone-number-entry').prop('hidden')).toBe(true);
    });

    it('opens the card path when the number is lost', async () => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({ card_fallback_available: true });
            opts.complete?.();
        });
        await open({ phone_on_file: '42' });
        win().find('.phone-step-1 .phone-lost-number').trigger('click');

        expect(ajax.mock.calls[0][0].data).toBe(JSON.stringify({ lostNumber: true }));
        await vi.waitFor(() => expect(UIWindowCardVerificationRequired).toHaveBeenCalled());
        expect(win().find('.phone-card-fallback').first().prop('hidden')).toBe(false);
    });

    it('shows the server message when there is no other way', async () => {
        // jsdom has no layout, so `:visible` matches nothing without this.
        const visible = jQuery.expr.pseudos.visible;
        jQuery.expr.pseudos.visible = (el) => el.style.display !== 'none';
        try {
            vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
                opts.error({ status: 409, responseJSON: { message: 'Email support.' } });
                opts.complete?.();
            });
            await open({ phone_on_file: '42' });
            win().find('.phone-step-1 .phone-lost-number').trigger('click');

            expect(win().find('.phone-step-1 .error').text()).toBe('Email support.');
            expect(UIWindowCardVerificationRequired).not.toHaveBeenCalled();
        } finally {
            jQuery.expr.pseudos.visible = visible;
        }
    });

    it('keeps the number field for an account without one', async () => {
        await open({});
        expect(win().find('.phone-number-entry').prop('hidden')).toBe(false);
        expect(win().find('.phone-step-1 .phone-lost-number')).toHaveLength(0);
        expect(win().find('.phone-change-number-wrap').prop('hidden')).toBe(false);
        expect(win().find('.phone-lost-number-wrap').prop('hidden')).toBe(true);
    });

    it('shows where the code went when the server says the account has a number on file', async () => {
        vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({ phone_on_file: '42' });
            opts.complete?.();
        });
        await open({});
        win().find('#phone-verif-input').val('4155550999');
        win().find('.phone-send-btn').trigger('click');

        await vi.waitFor(() => expect(win().find('.phone-target').text()).toBe('•••• 42'));
        expect(win().find('.phone-change-number-wrap').prop('hidden')).toBe(true);
        expect(win().find('.phone-lost-number-wrap').prop('hidden')).toBe(false);
    });
});
