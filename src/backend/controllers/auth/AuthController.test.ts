/**
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { EventClient } from '../../clients/EventClient.js';
import { HttpError } from '../../core/http/HttpError.js';

let server: PuterServer;
let eventClient: EventClient;

beforeAll(async () => {
    server = await setupTestServer();
    eventClient = server.clients.event as unknown as EventClient;
});

afterAll(async () => {
    await server?.shutdown();
});

describe('puter.signup.validate event', () => {
    it('supports code in the validate event when allow is false', async () => {
        eventClient.on('puter.signup.validate', (_key, data) => {
            const event = data as {
                allow: boolean;
                message: string | null;
                code: string | null;
            };
            event.allow = false;
            event.message = 'Region not supported';
            event.code = 'region_blocked';
        });

        const validateEvent = {
            req: {},
            data: {},
            ip: '127.0.0.1',
            email: 'test@example.com',
            allow: true,
            no_temp_user: false,
            requires_email_confirmation: false,
            message: null as string | null,
            code: null as string | null,
        };

        await eventClient.emitAndWait(
            'puter.signup.validate',
            validateEvent,
            {},
        );

        expect(validateEvent.allow).toBe(false);
        expect(validateEvent.message).toBe('Region not supported');
        expect(validateEvent.code).toBe('region_blocked');

        // Verify the HttpError constructed from this event carries the code
        const err = new HttpError(
            403,
            validateEvent.message ?? 'Signup blocked',
            {
                legacyCode: 'forbidden',
                ...(validateEvent.code ? { code: validateEvent.code } : {}),
            },
        );
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe('Region not supported');
        expect(err.code).toBe('region_blocked');
    });

    it('omits code from HttpError when extension does not set it', async () => {
        const validateEvent = {
            req: {},
            data: {},
            ip: '127.0.0.1',
            email: 'nocode@example.com',
            allow: false,
            no_temp_user: false,
            requires_email_confirmation: false,
            message: 'Blocked',
            code: null as string | null,
        };

        const err = new HttpError(
            403,
            validateEvent.message ?? 'Signup blocked',
            {
                legacyCode: 'forbidden',
                ...(validateEvent.code ? { code: validateEvent.code } : {}),
            },
        );
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe('Blocked');
        expect(err.code).toBeUndefined();
    });
});
