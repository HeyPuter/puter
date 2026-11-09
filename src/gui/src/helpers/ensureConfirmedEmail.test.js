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

vi.mock('../UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));

const { default: ensureConfirmedEmail } = await import('./ensureConfirmedEmail.js');
const { default: UIWindowSaveAccount } = await import('../UI/UIWindowSaveAccount.js');
const { default: UIWindowEmailConfirmationRequired } = await import('../UI/UIWindowEmailConfirmationRequired.js');

beforeEach(() => {
    UIWindowSaveAccount.mockReset();
    UIWindowEmailConfirmationRequired.mockReset();
});

describe('ensureConfirmedEmail', () => {
    it('shows nothing for a confirmed email', async () => {
        window.user = { is_temp: false, email_confirmed: true };
        expect(await ensureConfirmedEmail('save it')).toBe(true);
        expect(UIWindowSaveAccount).not.toHaveBeenCalled();
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();
    });

    it.each([true, false])('asks an unconfirmed email for its code once, and answers %s as it does', async (answer) => {
        window.user = { is_temp: false, email_confirmed: false };
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(answer);
        expect(await ensureConfirmedEmail('save it')).toBe(answer);
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledTimes(1);
        expect(UIWindowSaveAccount).not.toHaveBeenCalled();
    });

    it('has a temporary account saved first, with the message given', async () => {
        window.user = { is_temp: true };
        UIWindowSaveAccount.mockResolvedValueOnce(false);
        expect(await ensureConfirmedEmail('save it')).toBe(false);
        expect(UIWindowSaveAccount).toHaveBeenCalledWith(expect.objectContaining({
            message: 'save it',
            send_confirmation_code: true,
        }));
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();
    });

    it('passes the window options to both windows', async () => {
        window.user = { is_temp: true };
        UIWindowSaveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email_confirmed: false };
            return true;
        });
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(true);
        await ensureConfirmedEmail('save it', { stay_on_top: true });
        expect(UIWindowSaveAccount.mock.calls[0][0].window_options).toEqual({
            backdrop: true,
            close_on_backdrop_click: false,
            stay_on_top: true,
        });
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledWith({ window_options: { stay_on_top: true } });
    });

    it('asks no code again from an account that confirmed it while saving', async () => {
        window.user = { is_temp: true };
        // Saving asked for the code, which marks window.user confirmed.
        UIWindowSaveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email_confirmed: true };
            return true;
        });
        expect(await ensureConfirmedEmail('save it')).toBe(true);
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();
    });

    it('asks a just-saved account for its code when saving left it unconfirmed', async () => {
        window.user = { is_temp: true };
        UIWindowSaveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email_confirmed: false };
            return true;
        });
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(true);
        expect(await ensureConfirmedEmail('save it')).toBe(true);
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledTimes(1);
    });

    it('answers a call made while the code window shows with that window, without a second one', async () => {
        window.user = { is_temp: false, email_confirmed: false };
        let answer;
        UIWindowEmailConfirmationRequired.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));
        const first = ensureConfirmedEmail('save it');
        const second = ensureConfirmedEmail('save it');
        await Promise.resolve();
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledTimes(1);
        answer(true);
        expect(await Promise.all([first, second])).toEqual([true, true]);
    });

    it('answers a call made while the save-account window shows with that window', async () => {
        window.user = { is_temp: true };
        let answer;
        UIWindowSaveAccount.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));
        const first = ensureConfirmedEmail('save it');
        const second = ensureConfirmedEmail('save it');
        expect(UIWindowSaveAccount).toHaveBeenCalledTimes(1);
        answer(false);
        expect(await Promise.all([first, second])).toEqual([false, false]);
    });

    it('opens a new window for a call made after the last one answered', async () => {
        window.user = { is_temp: false, email_confirmed: false };
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        expect(await ensureConfirmedEmail('save it')).toBe(false);
        expect(await ensureConfirmedEmail('save it')).toBe(true);
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledTimes(2);
    });
});
