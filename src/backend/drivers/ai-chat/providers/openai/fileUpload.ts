import type { Actor } from '../../../../core/actor.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import { loadFileInput } from '../../../util/fileInput.js';

// Chat Completions doesn't support file inputs, so we inline files as
// base64 data URLs. 5MB is the practical cap before token counts and
// request payloads get out of hand.
export const MAX_FILE_SIZE = 5 * 1_000_000;

interface ContentPart {
    puter_path?: string;
    type?: string;
    text?: string;
    image_url?: { url: string };
    input_audio?: { data: string; format: string };
}

/**
 * Resolve any `puter_path` content parts into inline base64 data URLs.
 *
 * Rewrites each matching part in place: images become `image_url`, audio
 * becomes `input_audio`, and any error (too large, unsupported MIME,
 * missing file, permission denied) is swapped for a `text` part describing
 * the problem so the model can surface it to the user rather than the
 * request failing outright.
 */
export async function processPuterPathUploads(
    messages: Array<{ content?: unknown }>,
    stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
    actor: Actor | undefined,
): Promise<void> {
    const userId = Number(actor?.user?.id ?? NaN);

    const tasks: Array<Promise<void>> = [];
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as ContentPart[]) {
            if (!part || !part.puter_path) continue;
            tasks.push(processPart(part, stores, userId));
        }
    }
    await Promise.all(tasks);
}

async function processPart(
    part: ContentPart,
    stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
    userId: number,
): Promise<void> {
    const path = part.puter_path!;
    delete part.puter_path;

    if (!Number.isFinite(userId)) {
        setTextError(part, 'unauthenticated caller cannot resolve puter_path');
        return;
    }

    try {
        const loaded = await loadFileInput(stores, userId, path, {
            maxBytes: MAX_FILE_SIZE,
        });
        const mimeType = loaded.mimeType ?? 'application/octet-stream';
        const base64 = loaded.buffer.toString('base64');

        if (mimeType.startsWith('image/')) {
            part.type = 'image_url';
            part.image_url = { url: `data:${mimeType};base64,${base64}` };
            return;
        }
        if (mimeType.startsWith('audio/')) {
            part.type = 'input_audio';
            part.input_audio = {
                data: `data:${mimeType};base64,${base64}`,
                format: mimeType.split('/')[1],
            };
            return;
        }
        setTextError(part, 'input file has unsupported MIME type');
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

function setTextError(part: ContentPart, reason: string): void {
    delete part.image_url;
    delete part.input_audio;
    part.type = 'text';
    // "poor man's system prompt" — the model sees the error inline and can
    // explain to the user instead of silently dropping the attachment.
    part.text = `{error: ${reason}; the user did not write this message}`;
}
