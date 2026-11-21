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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { readBoundedBody } from '../../util/fileInput.js';

const MAX_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * `fetch` for a vendor SDK client. A 2xx answer labelled JSON whose body
 * doesn't parse comes back as a 502, which the SDK raises with a status. Left
 * alone, the SDKs throw a bare SyntaxError, and Mistral's leaves a rejected
 * promise nobody handles.
 */
export const jsonCheckedFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> => {
    const response = await (init == null ? fetch(input) : fetch(input, init));
    const type = response.headers?.get('content-type') ?? '';
    if (!response.ok || !/^application\/json\b/i.test(type)) return response;
    let text: string;
    try {
        text = (
            await readBoundedBody(response, MAX_JSON_RESPONSE_BYTES)
        ).toString('utf8');
        JSON.parse(text);
    } catch {
        return Response.json(
            {
                error: {
                    message: 'The provider returned an unreadable response',
                },
            },
            { status: 502 },
        );
    }
    return new Response(text, response);
};
