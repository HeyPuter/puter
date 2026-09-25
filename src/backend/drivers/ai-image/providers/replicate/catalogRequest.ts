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

import { HttpError } from '../../../../core/http/HttpError.js';
import {
    closestAspectRatio,
    expandAspectRatio,
    formatAspectRatio,
} from '../../imageDimensions.js';
import { assertInputImageString, toUrlOrDataUri } from '../../inputImage.js';
import type { IGenerateParams } from '../../types.js';
import type { ReplicateImageModel, ReplicateInputField } from './models.js';

const imageArrayKeys = [
    'input_images',
    'image_input',
    'images',
    'init_images',
    'style_reference_images',
    'references',
];
const singleImageKeys = [
    'input_image',
    'image',
    'image_prompt',
    'control_image',
    'redux_image',
    'init_image',
    'image_reference',
    'image_reference_url',
    'subject_reference',
];
const countKeys = [
    'num_outputs',
    'num_images',
    'number_of_images',
    'batch_size',
    'max_images',
    'num_samples',
];
const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });
// Driver-owned request fields never feed a native input directly, even when
// a schema key spells the same name (`image_size` camel-cases to `imageSize`).
const driverOwnedKeys = new Set([
    'imageSize',
    'ratio',
    'model',
    'provider',
    'test_mode',
    'puter_output_path',
    'providerOptions',
    'input_image_mime_type',
    'maskImage',
]);

function normalizeField(
    key: string,
    value: unknown,
    field: ReplicateInputField,
): unknown {
    if (field.enum) {
        const selected = field.enum.find((candidate) =>
            typeof candidate === 'string' && typeof value === 'string'
                ? candidate.toLowerCase() === value.trim().toLowerCase()
                : candidate === value,
        );
        if (selected === undefined)
            throw badRequest(`${key} must be one of: ${field.enum.join(', ')}`);
        value = selected;
    }
    if (field.type === 'integer' || field.type === 'number') {
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            (field.type === 'integer' && !Number.isInteger(value))
        ) {
            throw badRequest(`${key} must be a finite ${field.type}`);
        }
        if (
            (field.minimum !== undefined && value < field.minimum) ||
            (field.maximum !== undefined && value > field.maximum)
        ) {
            throw badRequest(`${key} is outside the supported range`);
        }
    } else if (field.type === 'array') {
        if (!Array.isArray(value)) throw badRequest(`${key} must be an array`);
        if (field.maxItems !== undefined && value.length > field.maxItems)
            throw badRequest(`${key} accepts at most ${field.maxItems} items`);
    } else if (field.type && typeof value !== field.type) {
        throw badRequest(`${key} must be a ${field.type}`);
    }
    if (
        typeof value === 'string' &&
        field.minLength &&
        value.length < field.minLength
    ) {
        throw badRequest(`${key} must not be empty`);
    }
    return value;
}

function nearestShape(
    value: { w: number; h: number },
    choices: (string | number | boolean)[],
): string | undefined {
    const shapes = choices.flatMap((choice) => {
        if (typeof choice !== 'string') return [];
        const match = /^(\d+)[:x](\d+)$/.exec(choice);
        return match
            ? [{ w: Number(match[1]), h: Number(match[2]), value: choice }]
            : [];
    });
    return shapes.length ? closestAspectRatio(value, shapes).value : undefined;
}

export function buildCatalogInput(
    model: ReplicateImageModel,
    params: IGenerateParams,
): Record<string, unknown> {
    const schema = model.inputSchema!;
    const providerOptions = params.providerOptions;
    if (
        providerOptions != null &&
        (typeof providerOptions !== 'object' || Array.isArray(providerOptions))
    ) {
        throw badRequest('providerOptions must be an object');
    }
    const native = (providerOptions ?? {}) as Record<string, unknown>;
    const input: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c: string) =>
            c.toUpperCase(),
        );
        const common = (name: string) =>
            driverOwnedKeys.has(name) ? undefined : params[name];
        const value =
            common(key) ??
            common(camelKey) ??
            native[key] ??
            native[camelKey] ??
            field.default;
        if (value !== undefined && value !== null) input[key] = value;
    }
    const promptKey =
        model.promptKey === undefined ? 'prompt' : model.promptKey;
    if (promptKey) input[promptKey] = params.prompt;
    if (params.quality != null && !schema.quality) {
        const tierKey = ['resolution', 'image_size', 'size'].find((key) =>
            schema[key]?.enum?.some(
                (v) => typeof v === 'string' && /^\d+(?:\.\d+)?[Kk]$/.test(v),
            ),
        );
        if (tierKey) input[tierKey] = params.quality;
    }
    if (params.output_megapixels != null) {
        const key = schema.output_megapixels
            ? 'output_megapixels'
            : schema.megapixels
              ? 'megapixels'
              : schema.resolution?.enum?.some(
                      (v) => typeof v === 'string' && v.endsWith(' MP'),
                  )
                ? 'resolution'
                : undefined;
        if (key)
            input[key] =
                key === 'resolution'
                    ? `${parseFloat(String(params.output_megapixels))} MP`
                    : String(params.output_megapixels);
    }
    const commonFields = {
        steps: [
            'steps',
            'num_inference_steps',
            'inference_steps',
            'ddim_steps',
        ],
        guidance: ['guidance', 'guidance_scale', 'scale'],
        negative_prompt: ['negative_prompt', 'n_prompt'],
        strength: ['strength', 'prompt_strength'],
    };
    for (const [option, keys] of Object.entries(commonFields)) {
        if (params[option] == null) continue;
        const key = keys.find((key) => schema[key]);
        if (key) input[key] = params[option];
    }
    if (params.response_format != null && schema.output_format)
        input.output_format = params.response_format;

    const multiKey = imageArrayKeys.find(
        (key) => schema[key]?.type === 'array',
    );
    const singleKey = singleImageKeys.find(
        (key) => schema[key]?.type === 'string',
    );
    const canonicalImages = params.input_images?.length
        ? params.input_images
        : params.input_image
          ? [params.input_image]
          : [];
    if (canonicalImages.length) {
        const isInpainting =
            singleKey &&
            schema.mask &&
            (params.maskImage != null || input.mask != null);
        if (multiKey && !isInpainting) input[multiKey] = canonicalImages;
        else if (singleKey) {
            if (canonicalImages.length !== 1)
                throw badRequest(`${model.id} accepts one input image`);
            input[singleKey] = canonicalImages[0];
        } else throw badRequest(`${model.id} does not support input images`);
    }
    if (params.maskImage != null) {
        if (!schema.mask)
            throw badRequest(`${model.id} does not support maskImage`);
        input.mask = params.maskImage;
    }
    for (const key of [
        ...imageArrayKeys,
        ...singleImageKeys,
        'mask',
        'super_resolution_refs',
        'controlnet_1_image',
        'controlnet_2_image',
        'controlnet_3_image',
        'style_reference',
        'character_reference',
    ]) {
        if (input[key] == null) continue;
        const values = Array.isArray(input[key])
            ? (input[key] as unknown[])
            : [input[key]];
        const normalized = values.map((value) =>
            toUrlOrDataUri(
                assertInputImageString(value, key),
                params.input_image_mime_type,
            ),
        );
        input[key] = Array.isArray(input[key]) ? normalized : normalized[0];
    }
    for (const key of countKeys) {
        if (schema[key]) input[key] = schema[key].type === 'string' ? '1' : 1;
    }
    if (schema.sequential_image_generation)
        input.sequential_image_generation = 'disabled';
    if (schema.image_set_mode) input.image_set_mode = false;

    const size = params.imageSize;
    const widthKey = schema.width
        ? 'width'
        : schema.image_width
          ? 'image_width'
          : undefined;
    const heightKey = schema.height
        ? 'height'
        : schema.image_height
          ? 'image_height'
          : undefined;
    if (size) {
        if (schema.aspect_ratio) {
            const choices = schema.aspect_ratio.enum;
            if (
                size.kind === 'pixels' &&
                widthKey &&
                heightKey &&
                choices?.includes('custom')
            )
                input.aspect_ratio = 'custom';
            else
                input.aspect_ratio = choices
                    ? (nearestShape(size, choices) ?? input.aspect_ratio)
                    : formatAspectRatio(size);
        }
        if (
            widthKey &&
            heightKey &&
            (!schema.aspect_ratio ||
                input.aspect_ratio === 'custom' ||
                !schema.aspect_ratio.enum)
        ) {
            const pixels =
                size.kind === 'pixels' ? size : expandAspectRatio(size);
            for (const [key, value] of [
                [widthKey, pixels.w],
                [heightKey, pixels.h],
            ] as const) {
                const field = schema[key];
                input[key] = Math.min(
                    field.maximum ?? 4096,
                    Math.max(field.minimum ?? 64, Math.round(value / 8) * 8),
                );
            }
        } else if (
            !schema.aspect_ratio ||
            String(input.aspect_ratio).toLowerCase() === 'not set'
        ) {
            const key = ['size', 'resolution', 'image_size'].find((k) =>
                schema[k]?.enum?.some(
                    (v) => typeof v === 'string' && /^\d+x\d+$/.test(v),
                ),
            );
            if (key)
                input[key] =
                    nearestShape(size, schema[key].enum!) ?? input[key];
        }
    }
    for (const key of model.requiredInputs ?? []) {
        if (
            input[key] == null ||
            input[key] === '' ||
            (Array.isArray(input[key]) && !(input[key] as unknown[]).length)
        )
            throw badRequest(`${model.id} requires ${key}`);
    }
    for (const [key, value] of Object.entries(input))
        input[key] = normalizeField(key, value, schema[key]);
    return input;
}

export function catalogImageInputs(input: Record<string, unknown>): string[] {
    return [...imageArrayKeys, ...singleImageKeys].flatMap((key) => {
        const value = input[key];
        return typeof value === 'string'
            ? [value]
            : Array.isArray(value)
              ? value.filter((v): v is string => typeof v === 'string')
              : [];
    });
}

export function catalogOutputMegapixels(
    input: Record<string, unknown>,
): number {
    for (const key of [
        'resolution',
        'size',
        'image_size',
        'output_megapixels',
        'megapixels',
    ]) {
        const value = input[key];
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const text = String(value);
        const pixels = /^(\d+)x(\d+)$/.exec(text);
        if (pixels) return (Number(pixels[1]) * Number(pixels[2])) / 1_000_000;
        const tier = /^(\d+(?:\.\d+)?)K$/i.exec(text);
        if (tier) return Number(tier[1]) ** 2;
        if (/^\d+(?:\.\d+)?(?: MP)?$/.test(text))
            return Number.parseFloat(text);
    }
    const w = Number(input.width ?? input.image_width);
    const h = Number(input.height ?? input.image_height);
    return w > 0 && h > 0 ? (w * h) / 1_000_000 : 1;
}

export function catalogCostComponents(
    model: ReplicateImageModel,
    input: Record<string, unknown>,
    usage: {
        inputMp: number;
        outputMp: number;
        seconds: number;
        outputCount?: number;
    },
) {
    const rate = model.billingRates?.find(
        (rate) =>
            !rate.when ||
            Object.entries(rate.when).every(
                ([key, value]) => input[key] === value,
            ),
    );
    if (!rate) throw badRequest(`Unsupported billing tier for ${model.id}`);
    const units: Record<string, number> = {
        output: usage.outputCount ?? 1,
        input_mp: usage.inputMp,
        output_mp: usage.outputMp,
        run: 1,
        second: usage.seconds,
        font: Array.isArray(input.font_urls) ? input.font_urls.length : 0,
    };
    return Object.entries(rate.costs).map(([key, cents]) => {
        const amount = units[key];
        if (
            !Number.isFinite(cents) ||
            cents < 0 ||
            !Number.isFinite(amount) ||
            amount < 0
        )
            throw badRequest(`Invalid billing quantity for ${model.id}`);
        return {
            usageType: `replicate:${model.id}:${key}`,
            usageAmount: amount,
            costOverride: Math.round(cents * amount * 1_000_000),
        };
    });
}
