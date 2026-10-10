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

import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { internalAuthGate } from './internalAuth';

const run = (secret: string | undefined, header?: string): unknown => {
    let outcome: unknown = 'not called';
    internalAuthGate(() => secret)(
        {
            headers:
                header === undefined ? {} : { 'x-puter-internal-auth': header },
        } as unknown as Request,
        {} as Response,
        (err?: unknown) => {
            outcome = err;
        },
    );
    return outcome;
};

describe('internalAuthGate', () => {
    it('passes the configured secret through', () => {
        expect(run('s3cret', 's3cret')).toBeUndefined();
    });

    it('refuses a wrong, shorter or missing secret with 403', () => {
        for (const header of ['wrong!', 's3cre', 's3cret-longer', undefined]) {
            expect(run('s3cret', header)).toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        }
    });

    it('refuses everything when no secret is configured', () => {
        expect(run(undefined, '')).toMatchObject({ statusCode: 403 });
        expect(run('', '')).toMatchObject({ statusCode: 403 });
    });
});
