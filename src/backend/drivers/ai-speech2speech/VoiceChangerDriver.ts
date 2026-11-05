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

import { pipeline, Readable, Transform } from 'node:stream';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DriverStreamResult } from '../meta.js';
import { OUTPUT_FORMATS } from '../ai-tts/providers/elevenlabs/ElevenLabsTTSProvider.js';
import { PuterDriver } from '../types.js';
import {
    type AiMeteringService,
    withAiCostFactor,
    withStreamedAiCharge,
} from '../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { loadFileInput } from '../util/fileInput.js';
import {
    type ProviderCatalog,
    ProviderRegistry,
    readProviderKey,
} from '../util/providerRegistry.js';
import { SAMPLE_AUDIO_URL } from '../util/testMode.js';
import { upstreamBodyStream, upstreamFetch } from '../util/upstreamErrors.js';
import { VOICE_CHANGER_COSTS } from './costs.js';

/**
 * Driver implementing `puter-speech2speech` — voice changer. Currently a single
 * provider (ElevenLabs).
 */

const DEFAULT_MODEL = 'eleven_multilingual_sts_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;
// Covers the upload as well as the conversion.
const CONVERT_TIMEOUT_MS = 10 * 60 * 1000;

const VOICE_CHANGER_CATALOG: ProviderCatalog = {
    label: 'Speech-to-speech',
    ids: ['elevenlabs'],
    defaultId: 'elevenlabs',
    aliases: { elevenlabs: 'elevenlabs' },
};

interface ElevenLabsConfig {
    apiKey: string;
    baseUrl: string;
    defaultVoiceId: string;
    defaultModelId: string;
}

interface ConvertArgs {
    audio: unknown;
    provider?: string;
    voice?: string;
    voice_id?: string;
    voiceId?: string;
    model?: string;
    model_id?: string;
    voice_settings?: unknown;
    voiceSettings?: unknown;
    seed?: number;
    remove_background_noise?: boolean;
    output_format?: string;
    file_format?: string;
    optimize_streaming_latency?: number;
    enable_logging?: boolean;
    test_mode?: boolean;
}

export class VoiceChangerDriver extends PuterDriver {
    readonly driverInterface = 'puter-speech2speech';
    readonly driverName = 'ai-speech2speech';
    // Older SDK bundles name the provider in the driver slot.
    readonly driverAliases = ['elevenlabs-voice-changer'];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    /** Metering scoped to this driver. Lazy: services wire up after drivers. */
    get #aiMetering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            this.driverName,
        );
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(VOICE_CHANGER_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Speech',
            }),
        );
    }

    #providers = new ProviderRegistry<ElevenLabsConfig>(VOICE_CHANGER_CATALOG);

    override onServerStart() {
        const elevenlabs = this.config.providers?.elevenlabs;
        const apiKey = readProviderKey(elevenlabs);
        if (!apiKey) return;
        this.#providers.register('elevenlabs', {
            apiKey,
            baseUrl:
                (elevenlabs?.apiBaseUrl as string | undefined) ??
                'https://api.elevenlabs.io',
            defaultVoiceId:
                (elevenlabs?.defaultVoiceId as string | undefined) ??
                DEFAULT_VOICE_ID,
            defaultModelId:
                (elevenlabs?.speechToSpeechModelId as string | undefined) ??
                DEFAULT_MODEL,
        });
    }

    async convert(
        args: ConvertArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        // Only one provider exists today, but naming a different one should
        // fail loudly rather than quietly convert with this one.
        const providerName = this.#providers.resolve(args.provider);

        if (args.test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio/mpeg' };
        }

        const elevenlabs = this.#providers.get(providerName);
        if (!elevenlabs) {
            throw new HttpError(500, 'ElevenLabs API key not configured', {
                legacyCode: 'internal_error',
            });
        }

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        if (!args.audio) {
            throw new HttpError(400, '`audio` is required', {
                legacyCode: 'bad_request',
            });
        }

        const loaded = await loadFileInput(
            this.stores,
            this.services.fs,
            actor,
            args.audio,
            { maxBytes: MAX_AUDIO_FILE_SIZE, acceptWebInput: true },
        );

        const modelId =
            args.model_id || args.model || elevenlabs.defaultModelId;
        const voiceId =
            args.voice_id ||
            args.voiceId ||
            args.voice ||
            elevenlabs.defaultVoiceId;
        if (!voiceId)
            throw new HttpError(400, '`voice` is required', {
                legacyCode: 'bad_request',
            });
        // `voiceId` lands in the request URL path; `modelId` lands in a
        // multipart field. Both are forwarded to ElevenLabs with our
        // long-lived API key, so anything other than a strict alphanumeric
        // shape lets a caller steer the request at a different endpoint or
        // inject parameters. ElevenLabs voice/model IDs are always
        // `[A-Za-z0-9_-]+` in practice.
        const ID_REGEX = /^[A-Za-z0-9_-]+$/;
        if (!ID_REGEX.test(voiceId))
            throw new HttpError(400, '`voice` must be alphanumeric', {
                legacyCode: 'bad_request',
            });
        if (!ID_REGEX.test(modelId))
            throw new HttpError(400, '`model` must be alphanumeric', {
                legacyCode: 'bad_request',
            });

        // The hold estimates seconds from the input at 128 kbps: compact audio
        // is under-held rather than refused. Usage is metered from the length
        // of the audio that comes back.
        const estimatedSeconds = Math.max(
            1,
            Math.ceil(loaded.buffer.byteLength / 16000),
        );
        const usageKey = `elevenlabs:${modelId}:second`;
        const ucentsPerSecond = VOICE_CHANGER_COSTS[usageKey] ?? 0;
        const estimatedCost = ucentsPerSecond * estimatedSeconds;

        const formData = new FormData();
        const blob = new Blob([loaded.buffer as BlobPart], {
            type: loaded.mimeType ?? 'application/octet-stream',
        });
        formData.append('audio', blob, loaded.filename);
        formData.append('model_id', modelId);

        const settings = args.voice_settings ?? args.voiceSettings;
        if (settings !== undefined && settings !== null) {
            formData.append(
                'voice_settings',
                typeof settings === 'string'
                    ? settings
                    : JSON.stringify(settings),
            );
        }
        if (args.seed !== undefined && args.seed !== null) {
            formData.append('seed', String(args.seed));
        }
        if (typeof args.remove_background_noise === 'boolean') {
            formData.append(
                'remove_background_noise',
                String(args.remove_background_noise),
            );
        }
        if (args.file_format) {
            formData.append('file_format', args.file_format);
        }

        const searchParams = new URLSearchParams();
        const outputFormat = args.output_format || DEFAULT_OUTPUT_FORMAT;
        if (outputFormat) searchParams.set('output_format', outputFormat);
        if (
            args.optimize_streaming_latency !== undefined &&
            args.optimize_streaming_latency !== null
        ) {
            searchParams.set(
                'optimize_streaming_latency',
                String(args.optimize_streaming_latency),
            );
        }
        if (args.enable_logging !== undefined && args.enable_logging !== null) {
            searchParams.set('enable_logging', String(args.enable_logging));
        }

        const url = new URL(
            `/v1/speech-to-speech/${voiceId}`,
            elevenlabs.baseUrl,
        );
        const search = searchParams.toString();
        if (search) url.search = search;

        const metering = this.#aiMetering;
        const output = measuredOutput(
            outputBytesPerSecond(outputFormat),
            outputFormat,
        );
        return withStreamedAiCharge(
            metering,
            actor,
            usageKey,
            estimatedCost,
            async (): Promise<DriverStreamResult> => {
                const response = await upstreamFetch(
                    'elevenlabs',
                    url,
                    {
                        method: 'POST',
                        headers: { 'xi-api-key': elevenlabs.apiKey },
                        body: formData,
                    },
                    {
                        providerLabel: 'ElevenLabs',
                        timeoutMs: CONVERT_TIMEOUT_MS,
                        stream: true,
                    },
                );
                return {
                    dataType: 'stream',
                    content_type:
                        response.headers.get('content-type') ?? 'audio/mpeg',
                    stream: output.measure(upstreamBodyStream(response)),
                };
            },
            async () => {
                const measured = await output.seconds;
                // A stream cut short was still converted in full upstream.
                const seconds =
                    measured.complete && measured.seconds
                        ? measured.seconds
                        : Math.max(measured.seconds ?? 0, estimatedSeconds);
                return metering.incrementUsage(
                    actor,
                    usageKey,
                    seconds,
                    ucentsPerSecond * seconds,
                );
            },
        );
    }
}

/**
 * Bytes per second of an ElevenLabs `output_format`. A format outside the
 * documented set is sized as the default, so a made-up bitrate can't shrink the
 * bill.
 */
export function outputBytesPerSecond(format: string): number {
    const known = OUTPUT_FORMATS.has(format) ? format : DEFAULT_OUTPUT_FORMAT;
    const [codec, rate, kbps] = known.split('_');
    if (codec === 'mp3' || codec === 'opus') return Number(kbps) * 125;
    if (codec === 'ulaw' || codec === 'alaw') return Number(rate);
    // pcm and wav: 16-bit mono.
    return Number(rate) * 2;
}

// Past this, a WAV whose data chunk hasn't started is billed by raw length.
const WAV_HEADER_MAX_BYTES = 64 * 1024;

/**
 * Where the samples of a RIFF/WAVE stream start, once `head` reaches its `data`
 * chunk; undefined until then, or if `head` isn't a WAV.
 */
export function wavDataOffset(head: Buffer): number | undefined {
    if (head.length < 12) return undefined;
    if (
        head.toString('ascii', 0, 4) !== 'RIFF' ||
        head.toString('ascii', 8, 12) !== 'WAVE'
    )
        return undefined;
    let offset = 12;
    while (offset + 8 <= head.length) {
        if (head.toString('ascii', offset, offset + 4) === 'data')
            return offset + 8;
        const size = head.readUInt32LE(offset + 4);
        offset += 8 + size + (size & 1);
    }
    return undefined;
}

const OGG_HEADER_BYTES = 27;
const NO_GRANULE = 2n ** 64n - 1n;

/**
 * Walks an Ogg Opus stream page by page as it arrives. Opus is variable
 * bitrate, so its length comes from the last page's granule position (48 kHz
 * samples, less the stream's pre-skip) rather than its byte count.
 */
export class OggOpusClock {
    #header = Buffer.alloc(0);
    #skip = 0;
    #firstBody: Buffer | undefined = Buffer.alloc(0);
    #firstBodyBytes = 0;
    #granule: bigint | undefined;
    #preSkip = 0;
    #broken = false;

    push(chunk: Buffer): void {
        let offset = 0;
        while (!this.#broken && offset < chunk.length) {
            if (this.#skip > 0) {
                const n = Math.min(this.#skip, chunk.length - offset);
                if (this.#firstBody && this.#firstBody.length < 19) {
                    this.#firstBody = Buffer.concat([
                        this.#firstBody,
                        chunk.subarray(offset, offset + n),
                    ]);
                }
                this.#skip -= n;
                offset += n;
                if (this.#skip === 0 && this.#firstBody) this.#readOpusHead();
                continue;
            }
            const want =
                this.#header.length < OGG_HEADER_BYTES
                    ? OGG_HEADER_BYTES
                    : OGG_HEADER_BYTES + this.#header[26]!;
            const n = Math.min(
                want - this.#header.length,
                chunk.length - offset,
            );
            this.#header = Buffer.concat([
                this.#header,
                chunk.subarray(offset, offset + n),
            ]);
            offset += n;
            if (this.#header.length < want) continue;
            if (this.#header.toString('ascii', 0, 4) !== 'OggS') {
                this.#broken = true;
                return;
            }
            if (want === OGG_HEADER_BYTES && this.#header[26]! > 0) continue;
            const granule = this.#header.readBigUInt64LE(6);
            if (granule !== NO_GRANULE) this.#granule = granule;
            let body = 0;
            for (const lacing of this.#header.subarray(OGG_HEADER_BYTES)) {
                body += lacing;
            }
            this.#header = Buffer.alloc(0);
            this.#skip = body;
            if (this.#firstBody) this.#firstBodyBytes = body;
        }
    }

    /** Whole seconds so far, once the stream has proven to be Ogg Opus. */
    get seconds(): number | undefined {
        if (this.#broken || this.#granule === undefined) return undefined;
        const samples = Number(this.#granule) - this.#preSkip;
        return samples > 0
            ? Math.max(1, Math.ceil(samples / 48_000))
            : undefined;
    }

    #readOpusHead(): void {
        const head = this.#firstBody!;
        this.#firstBody = undefined;
        if (
            this.#firstBodyBytes < 19 ||
            head.toString('ascii', 0, 8) !== 'OpusHead'
        ) {
            this.#broken = true;
            return;
        }
        this.#preSkip = head.readUInt16LE(10);
    }
}

/**
 * Counts the bytes of a converted stream. `seconds` settles when the stream
 * ends or closes: its length in whole seconds (undefined when nothing came
 * back), and whether the upstream sent all of it. A WAV's header isn't audio,
 * so it isn't counted; Opus is timed by its pages.
 */
function measuredOutput(bytesPerSecond: number, format: string) {
    let bytes = 0;
    let head: Buffer | undefined = format.startsWith('wav_')
        ? Buffer.alloc(0)
        : undefined;
    const opus = format.startsWith('opus_') ? new OggOpusClock() : undefined;
    let headerBytes = 0;
    let settle!: (measured: { seconds?: number; complete: boolean }) => void;
    const seconds = new Promise<{ seconds?: number; complete: boolean }>(
        (resolve) => {
            settle = resolve;
        },
    );
    const lengthOf = () => {
        const timed = opus?.seconds;
        if (timed !== undefined) return timed;
        const audio = bytes - headerBytes;
        return audio > 0
            ? Math.max(1, Math.ceil(audio / bytesPerSecond))
            : undefined;
    };
    const measure = (source: Readable): Readable => {
        const counter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                opus?.push(chunk);
                if (head) {
                    head = Buffer.concat([head, chunk]);
                    const offset = wavDataOffset(head);
                    if (offset !== undefined) headerBytes = offset;
                    if (
                        offset !== undefined ||
                        head.length >= WAV_HEADER_MAX_BYTES
                    )
                        head = undefined;
                }
                callback(null, chunk);
            },
            flush(callback) {
                settle({ seconds: lengthOf(), complete: true });
                callback();
            },
        });
        counter.once('close', () =>
            settle({ seconds: lengthOf(), complete: false }),
        );
        pipeline(source, counter, () => {});
        return counter;
    };
    return { measure, seconds };
}
