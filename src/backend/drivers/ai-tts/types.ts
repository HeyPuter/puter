/**
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
 * Types for the `puter-tts` driver interface.
 */

export interface ITTSVoice {
    id: string;
    name: string;
    language?: {
        name: string;
        code: string;
    };
    description?: string;
    category?: string;
    provider: string;
    labels?: Record<string, string>;
    supported_models?: string[];
    supported_engines?: string[];
}

export interface ITTSEngine {
    id: string;
    name: string;
    provider: string;
    pricing_per_million_chars?: number;
}

export interface ISynthesizeArgs {
    text: string;
    voice?: string;
    model?: string;
    response_format?: string;
    output_format?: string;
    instructions?: string;
    ssml?: string;
    language?: string;
    engine?: string;
    voice_settings?: Record<string, unknown>;
    voiceSettings?: Record<string, unknown>;
    test_mode?: boolean;
    provider?: string;
}

export interface ITTSProvider {
    readonly providerName: string;

    /** List voices available from this provider. */
    listVoices(args?: Record<string, unknown>): Promise<ITTSVoice[]>;

    /** List engines/models available from this provider. */
    listEngines(): Promise<ITTSEngine[]>;

    /** Synthesize speech from text. Returns a DriverStreamResult. */
    synthesize(args: ISynthesizeArgs): Promise<unknown>;
}
