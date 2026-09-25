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

/**
 * Token estimates for prompts we haven't sent yet and completions the upstream
 * never told us the size of.
 *
 * Two things use these and neither can be exact: the credit gate, which has to
 * decide whether a request is affordable before anyone has counted its tokens,
 * and the fallback charge for a stream that produced output but no usage
 * report. Both are better served by a rough number than by the zero they would
 * otherwise use — a prompt whose cost is estimated at nothing is a prompt that
 * passes every gate.
 */

import { estimateTextTokens } from '../../util/tokenEstimate.js';

// Re-exported so existing consumers keep one import site for all estimators.
export { estimateTextTokens } from '../../util/tokenEstimate.js';

/** Tokens per byte of an inline (base64) attachment; see `attachmentTokens`. */
const ATTACHMENT_BYTES_PER_TOKEN = 150;

/**
 * What an attachment we can't measure is assumed to cost — a remote URL, or a
 * `puter_path` we haven't read yet. Roughly a full-frame image at Anthropic's
 * `(w*h)/750`, which is the largest an image gets before providers downscale.
 */
const UNMEASURED_ATTACHMENT_TOKENS = 1500;

/** Base64 carries 3 bytes in every 4 characters. */
const BASE64_BYTES_PER_CHAR = 3 / 4;

/** Characters per token, for output we only ever saw as text. */
const OUTPUT_CHARS_PER_TOKEN = 4;

type ContentPart = Record<string, unknown>;

/** Bytes an inline data URI or bare base64 payload decodes to. */
const inlineBytes = (value: string): number => {
    const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
    const payload = comma === -1 ? value : value.slice(comma + 1);
    return Math.floor(payload.length * BASE64_BYTES_PER_CHAR);
};

/**
 * Tokens an attachment is worth, from whatever we can see of it.
 *
 * Inline payloads are measured; anything referenced by URL or FS path is
 * charged the flat unmeasured estimate rather than nothing, because "we can't
 * see it" and "it's free" are not the same answer.
 */
const attachmentTokens = (value: unknown): number => {
    if (typeof value !== 'string' || value === '') {
        return UNMEASURED_ATTACHMENT_TOKENS;
    }
    if (value.startsWith('data:') || !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        // A data URI, or something that isn't a URI at all — a bare base64
        // payload or an FS path. Only the first is measurable; a short string
        // measures short, which the floor below covers.
        const bytes = inlineBytes(value);
        return Math.max(
            Math.ceil(bytes / ATTACHMENT_BYTES_PER_TOKEN),
            value.startsWith('data:') ? 0 : UNMEASURED_ATTACHMENT_TOKENS,
        );
    }
    return UNMEASURED_ATTACHMENT_TOKENS;
};

/**
 * Tokens one normalized content part is worth.
 *
 * Every part shape any provider accepts has to land somewhere here: the text
 * ones on the text estimator, the rest on `attachmentTokens`. A part nobody
 * recognises is charged the unmeasured estimate — the alternative is a content
 * type nobody has taught the gate about arriving for free.
 */
const partTokens = (part: unknown): number => {
    if (typeof part === 'string') return estimateTextTokens(part);
    if (!part || typeof part !== 'object') return 0;

    const p = part as ContentPart;

    if (typeof p.text === 'string') return estimateTextTokens(p.text);

    // Model-output shapes replayed as history: Anthropic thinking blocks,
    // our own streamed `reasoning` chunks, OpenAI refusals. All text — they
    // must not fall through to the attachment default below, which would
    // price a few sentences of reasoning like a full-frame image.
    if (typeof p.thinking === 'string') return estimateTextTokens(p.thinking);
    if (typeof p.reasoning === 'string') {
        return estimateTextTokens(p.reasoning);
    }
    if (typeof p.refusal === 'string') return estimateTextTokens(p.refusal);

    // OpenAI-style `{ image_url: { url } }` (or the flattened string form).
    if (p.image_url) {
        const url =
            typeof p.image_url === 'string'
                ? p.image_url
                : (p.image_url as ContentPart).url;
        return attachmentTokens(url);
    }

    // Anthropic-style `{ source: { data | url } }`.
    if (p.source && typeof p.source === 'object') {
        const source = p.source as ContentPart;
        return attachmentTokens(source.data ?? source.url ?? source.file_id);
    }

    // Puter's own reference — resolved to an upload by the provider, so its
    // size isn't knowable here.
    if (p.puter_path) return UNMEASURED_ATTACHMENT_TOKENS;

    if (typeof p.data === 'string' || typeof p.b64_json === 'string') {
        return attachmentTokens(p.data ?? p.b64_json);
    }

    // Tool traffic: arguments and results are text once serialized.
    if (p.type === 'tool_use' && p.input !== undefined) {
        return estimateTextTokens(
            typeof p.input === 'string' ? p.input : JSON.stringify(p.input),
        );
    }
    if (p.type === 'tool_result') {
        return estimateTextTokens(
            typeof p.content === 'string'
                ? p.content
                : JSON.stringify(p.content ?? ''),
        );
    }
    if (p.type === 'compaction') {
        return estimateTextTokens(String(p.encrypted_content ?? ''));
    }

    return UNMEASURED_ATTACHMENT_TOKENS;
};

/**
 * Tokens a prompt is worth, across every content part it carries.
 *
 * Text-only prompts land on the same v1 number the gate has always used. What
 * changes for a multimodal prompt is that its attachments count for something:
 * reading only `text` fields made a request carrying twenty frames of video
 * look like an empty one, and an empty request is affordable to an account with
 * nothing left.
 */
export const estimatePromptTokens = (messages: unknown): number => {
    if (!Array.isArray(messages)) return 0;

    let tokens = 0;
    for (const message of messages) {
        if (typeof message === 'string') {
            tokens += estimateTextTokens(message);
            continue;
        }
        if (!message || typeof message !== 'object') continue;

        const content = (message as ContentPart).content;
        if (typeof content === 'string') {
            tokens += estimateTextTokens(content);
        } else if (Array.isArray(content)) {
            for (const part of content) tokens += partTokens(part);
        } else if (content) {
            tokens += partTokens(content);
        }
    }
    return tokens;
};

/**
 * Tokens a completion we only saw as streamed characters is worth. For a stream
 * that ended without a usage report, this is what it gets billed on.
 */
export const estimateOutputTokens = (chars: number): number => {
    if (!Number.isFinite(chars) || chars <= 0) return 0;
    return Math.ceil(chars / OUTPUT_CHARS_PER_TOKEN);
};
