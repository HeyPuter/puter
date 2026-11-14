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

import { pipeline, type Readable, Transform } from 'node:stream';
import { DEFAULT_OUTPUT_FORMAT, OUTPUT_FORMATS } from '../outputFormats.js';

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
export function measuredOutput(bytesPerSecond: number, format: string) {
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
