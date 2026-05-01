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
 * Types for the `puter-video-generation` driver interface.
 */

export interface IVideoModel {
    id: string;
    name: string;
    puterId?: string;
    provider?: string;
    aliases?: string[];
    description?: string;
    version?: string;
    costs_currency?: string;
    index_cost_key?: string;
    output_cost_key?: string;
    costs?: Record<string, number>;
    durationSeconds?: number[] | null;
    dimensions?: string[] | null;
    defaultUsageKey?: string;
    organization?: string;
    model?: string;
    fps?: number[] | null;
    keyframes?: string[] | null;
    promptLength?: { min: number; max: number } | null;
    promptSupported?: boolean | null;
}

export interface IGenerateVideoParams {
    prompt: string;
    model?: string;
    provider?: string;
    test_mode?: boolean;
    seconds?: number | string;
    duration?: number | string;
    size?: string;
    resolution?: string;
    width?: number;
    height?: number;
    fps?: number;
    steps?: number;
    guidance_scale?: number;
    seed?: number;
    output_format?: string;
    output_quality?: number;
    negative_prompt?: string;
    reference_images?: string[];
    frame_images?: object[];
    last_frame?: string;
    metadata?: object;
    input_reference?: unknown;
    no_extra_params?: boolean;
}

export interface IVideoProvider {
    generate(params: IGenerateVideoParams): Promise<unknown>;
    models(): Promise<IVideoModel[]> | IVideoModel[];
    getDefaultModel(): string;
}
