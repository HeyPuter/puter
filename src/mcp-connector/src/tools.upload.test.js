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
import { setupPuterTestEnv } from '../../backend/testUtil.js';
import { TOOL_MAP } from './tools.js';

/**
 * The signed-upload tools talk to `/fs/*` over HTTP rather than through
 * puter.js, so the only thing that proves they work is a real round trip: mint
 * a URL, PUT bytes to it the way the emitted shell command would, finalize, and
 * read the file back. A stubbed API would just re-assert our own assumptions
 * about the request shape — which is the part most likely to be wrong.
 */
describe('signed upload tools', () => {
    let env;
    /** Stands in for the caller's puter.js instance — the tools only read these two. */
    let puter;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        puter = {
            APIOrigin: new URL(env.apiOrigin).origin,
            authToken: env.users.user.token,
        };
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (name, args) => TOOL_MAP.get(name).handler(puter, args);

    const homePath = (name) => `/${env.users.user.username}/Documents/${name}`;

    it('uploads a file out of band and finalizes it', async () => {
        const path = homePath(`signed-upload-${Date.now()}.txt`);
        const content = 'streamed straight to storage\n';
        const size = Buffer.byteLength(content);

        const started = await call('fs_start_upload', {
            path,
            size,
            local_path: './local.txt',
        });

        expect(started.upload_id).toEqual(expect.any(String));
        expect(started.url).toMatch(/^https?:\/\//);
        expect(started.content_type).toBe('text/plain');
        expect(new Date(started.expires_at).getTime()).toBeGreaterThan(Date.now());
        // The command has to carry the signed content type, or storage 403s.
        expect(started.upload_command).toContain("-H 'Content-Type: text/plain'");
        expect(started.upload_command).toContain("--upload-file './local.txt'");

        // What `upload_command` does, minus the shell.
        const put = await fetch(started.url, {
            method: 'PUT',
            headers: { 'Content-Type': started.content_type },
            body: content,
        });
        expect(put.status).toBe(200);

        // Not a file until it is completed.
        const completed = await call('fs_complete_upload', {
            upload_id: started.upload_id,
        });
        expect(completed.path).toBe(path);
        expect(completed.size).toBe(size);

        const readBack = await fetch(
            new URL(
                `/fs/read?path=${encodeURIComponent(path)}&auth_token=${env.users.user.token}`,
                env.apiOrigin,
            ),
        );
        expect(await readBack.text()).toBe(content);
    });

    it('guesses the content type from the destination extension', async () => {
        const started = await call('fs_start_upload', {
            path: homePath(`signed-upload-${Date.now()}.png`),
            size: 3,
        });
        expect(started.content_type).toBe('image/png');
        await call('fs_abort_upload', { upload_id: started.upload_id });
    });

    it('aborts an upload without creating a file', async () => {
        const path = homePath(`signed-abort-${Date.now()}.bin`);
        const started = await call('fs_start_upload', { path, size: 8 });

        const aborted = await call('fs_abort_upload', {
            upload_id: started.upload_id,
        });
        expect(aborted).toEqual({ success: true, aborted: started.upload_id });

        // Completing an aborted session must not resurrect the file.
        await expect(
            call('fs_complete_upload', { upload_id: started.upload_id }),
        ).rejects.toThrow();
    });

    it('rejects a file too large for a single-shot upload', async () => {
        // Past the server's single-PUT ceiling the backend switches to
        // multipart, which these tools deliberately do not implement.
        await expect(
            call('fs_start_upload', {
                path: homePath('signed-too-big.bin'),
                size: 1024 * 1024 * 1024,
            }),
        ).rejects.toThrow(/too large for a single-shot signed upload/);
    });
});
