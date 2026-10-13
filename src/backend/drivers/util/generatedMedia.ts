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

import { posix as pathPosix } from 'node:path';
import { Readable } from 'node:stream';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { ACLService } from '../../services/acl/ACLService.js';
import type { FSService } from '../../services/fs/FSService.js';
import {
    expandTildePath,
    normalizeAbsolutePath,
} from '../../services/fs/resolveNode.js';
import { secureFetch } from '../../util/secureHttp.js';
import { dataUriBytes, parseDataUri } from './dataUri.js';

/**
 * Where a generation's `puter_output_path` lands, checked before any credits
 * are spent: an absolute path (`~` expanded) whose parent the actor can write.
 */
export async function resolveOutputPath(
    services: { acl: ACLService; fs: FSService },
    actor: Actor,
    outputPath: string,
): Promise<string> {
    const username = actor.user?.username;
    if (!actor.user?.id || !username) {
        throw new HttpError(400, 'User ID required for puter_output_path', {
            legacyCode: 'bad_request',
        });
    }
    const resolved = normalizeAbsolutePath(
        expandTildePath(outputPath, username),
    );
    const parentPath = pathPosix.dirname(resolved);
    if (resolved === '/' || parentPath === '/') {
        throw new HttpError(400, 'Cannot write to root path', {
            legacyCode: 'cannot_write_to_root',
        });
    }

    let ancestors: Promise<Array<{ uid: string; path: string }>> | null = null;
    const canWrite = await services.acl.check(
        actor,
        {
            path: parentPath,
            resolveAncestors() {
                ancestors ??= services.fs.getAncestorChain(parentPath);
                return ancestors;
            },
        },
        'write',
    );
    if (!canWrite) {
        throw new HttpError(403, 'Write access denied for destination', {
            legacyCode: 'access_denied',
        });
    }
    return resolved;
}

/**
 * Writes a generated image or video (a data URI, or a provider-minted URL) to
 * `path` in the actor's filesystem.
 */
export async function saveGeneratedMediaToFS(
    fsService: FSService,
    actor: Actor,
    result: unknown,
    path: string,
    media: { noun: 'image' | 'video'; defaultType: string },
): Promise<void> {
    if (typeof result !== 'string') {
        throw new HttpError(
            500,
            `Unsupported ${media.noun} result format for puter_output_path`,
            { legacyCode: 'internal_error' },
        );
    }

    let buffer: Buffer;
    let contentType: string;
    const dataUri = parseDataUri(result, media.defaultType);
    if (dataUri) {
        buffer = dataUriBytes(dataUri);
        contentType = dataUri.mimeType;
    } else {
        // Provider-minted URL, but fetched with the same SSRF guards as the
        // input paths: it reaches an unauthenticated GET whose body lands in
        // the user's filesystem. skipProxy because generated media is ours to
        // download directly, not user input to screen.
        const response = await secureFetch(result, { skipProxy: true });
        if (!response.ok) {
            throw new HttpError(
                502,
                `Failed to fetch generated ${media.noun} for FS write: ${response.status}`,
                { legacyCode: 'internal_error' },
            );
        }
        contentType = response.headers.get('content-type') ?? media.defaultType;
        buffer = Buffer.from(await response.arrayBuffer());
    }

    await fsService.write(actor.user!.id!, {
        fileMetadata: {
            path,
            size: buffer.length,
            contentType,
            overwrite: true,
            createMissingParents: true,
        },
        fileContent: Readable.from(buffer),
    });
}
