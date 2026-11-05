/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { describe, expect, it } from 'vitest';
import { isReservedUsername, reserveUsernames } from './reservedUsernames';

describe('isReservedUsername', () => {
    it('reserves the role mailboxes, whatever the case', () => {
        for (const name of [
            'abuse',
            'postmaster',
            'Hostmaster',
            'WEBMASTER',
            'security',
            'noc',
        ]) {
            expect(isReservedUsername(name)).toBe(true);
        }
    });

    it('leaves ordinary names free', () => {
        expect(isReservedUsername('rn_free_name')).toBe(false);
    });

    it('reserves names registered at runtime, whatever the case', () => {
        expect(isReservedUsername('rn_staff')).toBe(false);
        reserveUsernames(['RN_Staff']);
        expect(isReservedUsername('rn_staff')).toBe(true);
        expect(isReservedUsername('RN_STAFF')).toBe(true);
    });
});
