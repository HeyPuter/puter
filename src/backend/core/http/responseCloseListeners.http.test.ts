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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    RESPONSE_CLOSE_LISTENER_BUDGET,
    setupPuterTestEnv,
    trackResponseCloseListeners,
    type PuterTestEnv,
} from '../../testUtil.js';

/**
 * The routes that hold a response open the longest, where middleware, gates and
 * the handler each want to hear when it closes.
 */
describe('close listeners per response over HTTP', () => {
    let env: PuterTestEnv;
    let filePath = '';

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            meteringEnforcement: { subscriptions: false },
        } as never);
        const { username } = env.users.user;
        const user = await env.server.stores.user.getByUsername(username);
        filePath = `/${username}/Documents/close-listeners.txt`;
        await env.server.services.fs.write(user!.id, {
            fileMetadata: {
                path: filePath,
                size: 4096,
                contentType: 'text/plain',
            },
            fileContent: Buffer.alloc(4096, 97),
        });
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const streamedChat = {
        model: 'fake',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
    };
    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Origin: env.apiOrigin,
            },
            body: JSON.stringify(body),
        });

    const routes: Array<[string, string, () => Promise<Response>]> = [
        [
            'a streamed driver call',
            '/drivers/call',
            () =>
                post('/drivers/call', env.users.user.token, {
                    interface: 'puter-chat-completion',
                    service: 'ai-chat',
                    method: 'complete',
                    args: streamedChat,
                }),
        ],
        [
            'an Anthropic-style streamed completion',
            '/puterai/anthropic/v1/messages',
            () =>
                post(
                    '/puterai/anthropic/v1/messages',
                    env.users.user.apiToken,
                    streamedChat,
                ),
        ],
        [
            'an OpenAI-style streamed completion',
            '/puterai/openai/v1/chat/completions',
            () =>
                post(
                    '/puterai/openai/v1/chat/completions',
                    env.users.user.apiToken,
                    streamedChat,
                ),
        ],
        [
            'a file read',
            '/read',
            () => {
                const url = new URL('/read', env.apiOrigin);
                url.searchParams.set('file', filePath);
                return fetch(url, {
                    headers: {
                        Authorization: `Bearer ${env.users.user.token}`,
                    },
                });
            },
        ],
        [
            'a v2 file read',
            '/fs/read',
            () => {
                const url = new URL('/fs/read', env.apiOrigin);
                url.searchParams.set('path', filePath);
                return fetch(url, {
                    headers: {
                        Authorization: `Bearer ${env.users.user.token}`,
                    },
                });
            },
        ],
    ];

    it.each(routes)('%s stays within the budget', async (_name, path, call) => {
        const tracker = trackResponseCloseListeners();
        try {
            const response = await call();
            expect(response.status).toBe(200);
            await response.arrayBuffer();
        } finally {
            tracker.restore();
        }
        const peak = tracker.peak((req) => req.url?.split('?')[0] === path);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(RESPONSE_CLOSE_LISTENER_BUDGET);
    });
});
