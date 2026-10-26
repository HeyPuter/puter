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

globalThis.i18n = (key) => key;

const { default: ensure_can_publish } = await import('./ensureCanPublish.js');
const { default: UIWindowSaveAccount } = await import('../UI/UIWindowSaveAccount.js');
const { default: UIWindowEmailConfirmationRequired } = await import('../UI/UIWindowEmailConfirmationRequired.js');

beforeEach(() => {
    UIWindowSaveAccount.mockReset();
    UIWindowEmailConfirmationRequired.mockReset();
});

describe('ensure_can_publish', () => {
    it('lets anyone through when verification is not required', async () => {
        window.user = { is_temp: true };
        expect(await ensure_can_publish(false)).toBe(true);
        expect(UIWindowSaveAccount).not.toHaveBeenCalled();
    });

    it('has a temporary account saved first', async () => {
        window.user = { is_temp: true };
        UIWindowSaveAccount.mockResolvedValueOnce(false);
        expect(await ensure_can_publish(true)).toBe(false);
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();

        // Saving replaces window.user with the saved, confirmed account.
        UIWindowSaveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email_confirmed: true };
            return true;
        });
        expect(await ensure_can_publish(true)).toBe(true);
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();
    });

    it('still has a just-saved account confirm its email when saving left it unconfirmed', async () => {
        window.user = { is_temp: true };
        UIWindowSaveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email_confirmed: false };
            return true;
        });
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(false);
        expect(await ensure_can_publish(true)).toBe(false);
        expect(UIWindowEmailConfirmationRequired).toHaveBeenCalledTimes(1);
    });

    it('has an unconfirmed email confirmed first', async () => {
        window.user = { is_temp: false, email_confirmed: false };
        UIWindowEmailConfirmationRequired.mockResolvedValueOnce(false);
        expect(await ensure_can_publish(true)).toBe(false);
        expect(UIWindowSaveAccount).not.toHaveBeenCalled();
    });

    it('lets a confirmed account through', async () => {
        window.user = { is_temp: false, email_confirmed: true };
        expect(await ensure_can_publish(true)).toBe(true);
        expect(UIWindowEmailConfirmationRequired).not.toHaveBeenCalled();
    });
});
