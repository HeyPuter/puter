import Anthropic, { toFile } from '@anthropic-ai/sdk';
import type { Actor } from '../../../../core/actor.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import { loadFileInput } from '../../../util/fileInput.js';

export const FILES_API_BETA = 'files-api-2025-04-14';
// Claude's documented per-file cap is 500MB, but pulling huge objects
// through base64 token counting is impractical — cap at 30MB like v1.
const MAX_FILE_SIZE = 30 * 1_000_000;

interface ContentPart {
    puter_path?: string;
    type?: string;
    text?: string;
    source?: { type: string; file_id: string };
}

export interface ClaudeUploadResult {
    /** File IDs uploaded this request; caller deletes them after completion. */
    fileIds: string[];
}

/**
 * Resolve any `puter_path` content parts by uploading the referenced FS
 * entries to Anthropic's Files API and rewriting each part to reference the
 * returned `file_id`. Parts that fail (too large, missing, etc.) are swapped
 * for an inline `text` error so the model can explain rather than the whole
 * request failing.
 *
 * Callers MUST pass `betas: [FILES_API_BETA]` on the subsequent
 * `beta.messages.create`/`.stream` call when any files were uploaded, and
 * should clean up via `anthropic.beta.files.delete(id)` in their finally path.
 */
export async function processPuterPathUploads(
    anthropic: Anthropic,
    messages: Array<{ content?: unknown }>,
    stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
    fsService: FSService,
    actor: Actor | undefined,
): Promise<ClaudeUploadResult> {
    const parts: ContentPart[] = [];
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as ContentPart[]) {
            if (part?.puter_path) parts.push(part);
        }
    }
    if (parts.length === 0) return { fileIds: [] };

    const fileIds: string[] = [];
    await Promise.all(
        parts.map((part) =>
            processPart(part, anthropic, stores, fsService, actor, fileIds),
        ),
    );
    return { fileIds };
}

async function processPart(
    part: ContentPart,
    anthropic: Anthropic,
    stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
    fsService: FSService,
    actor: Actor | undefined,
    fileIds: string[],
): Promise<void> {
    const path = part.puter_path!;
    delete part.puter_path;

    if (!actor?.user?.id) {
        setTextError(part, 'unauthenticated caller cannot resolve puter_path');
        return;
    }

    try {
        const loaded = await loadFileInput(stores, fsService, actor, path, {
            maxBytes: MAX_FILE_SIZE,
        });
        const mimeType = loaded.mimeType ?? 'application/octet-stream';
        const uploaded = await anthropic.beta.files.upload({
            file: await toFile(loaded.buffer, loaded.filename, {
                type: mimeType,
            }),
            betas: [FILES_API_BETA],
        });
        fileIds.push(uploaded.id);

        part.type = contentBlockTypeForMime(mimeType);
        part.source = { type: 'file', file_id: uploaded.id };
    } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 413) {
            setTextError(
                part,
                `input file exceeded maximum of ${MAX_FILE_SIZE} bytes`,
            );
            return;
        }
        const message = (err as Error)?.message || 'failed to read input file';
        setTextError(part, message);
    }
}

// Mirrors the table at https://docs.claude.com/en/docs/build-with-claude/files
function contentBlockTypeForMime(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('text/')) return 'document';
    if (mimeType === 'application/pdf' || mimeType === 'application/x-pdf') {
        return 'document';
    }
    return 'container_upload';
}

function setTextError(part: ContentPart, reason: string): void {
    delete part.source;
    part.type = 'text';
    part.text = `{error: ${reason}; the user did not write this message}`;
}
