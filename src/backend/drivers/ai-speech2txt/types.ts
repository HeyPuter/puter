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

/** Types for the `puter-speech2txt` driver interface. */

import type { MeteringService } from '../../services/metering/MeteringService.js';
import type { loadFileInput } from '../util/fileInput.js';

/** The layers a provider needs to read its audio input and meter usage. */
export interface ISpeechToTextDeps {
    stores: Parameters<typeof loadFileInput>[0];
    fs: Parameters<typeof loadFileInput>[1];
    metering: MeteringService;
}

export interface ISpeechToTextModel {
    id: string;
    name: string;
    type: string;
    response_formats: string[];
    supports_prompt: boolean;
    supports_logprobs: boolean;
    supports_diarization?: boolean;
    supports_timestamp_granularities?: boolean;
    provider?: string;
}

export interface ITranscribeArgs {
    file?: unknown;
    provider?: string;
    model?: string;
    response_format?: string;
    language?: string;
    prompt?: string;
    temperature?: number;
    logprobs?: boolean;
    timestamp_granularities?: string[];
    chunking_strategy?: string;
    known_speaker_names?: string[];
    known_speaker_references?: unknown[];
    extra_body?: Record<string, unknown>;
    stream?: boolean;
    test_mode?: boolean;
    // Accepted by the xAI provider only.
    format?: boolean;
    diarize?: boolean;
    multichannel?: boolean;
    channels?: number;
    audio_format?: string;
    sample_rate?: number;
}

export interface ISpeechToTextProvider {
    readonly providerName: string;

    /** Models this provider exposes. */
    listModels(): Promise<ISpeechToTextModel[]>;

    /** Transcribe audio in its own language. */
    transcribe(args: ITranscribeArgs): Promise<unknown>;

    /** Transcribe audio, translating it to English. */
    translate(args: ITranscribeArgs): Promise<unknown>;

    /** Per-unit metering costs, aggregated by the driver. */
    getReportedCosts(): Record<string, unknown>[];
}
