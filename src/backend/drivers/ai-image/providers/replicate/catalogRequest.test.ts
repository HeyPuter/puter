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

import { describe, expect, it } from 'vitest';
import { ADDITIONAL_REPLICATE_IMAGE_MODELS } from './catalog.js';
import {
    buildCatalogInput,
    catalogCostComponents,
    catalogImageInputs,
    catalogOutputMegapixels,
} from './catalogRequest.js';
import type { IGenerateParams } from '../../types.js';

const getModel = (id: string) =>
    ADDITIONAL_REPLICATE_IMAGE_MODELS.find((model) => model.id === id)!;
const prompt = 'A blue cup on a table';
const image = 'data:image/png;base64,aGVsbG8=';
const cost = (id: string, params: Partial<IGenerateParams>, seconds = 12.5) => {
    const model = getModel(id);
    const input = buildCatalogInput(model, { prompt, ...params });
    return catalogCostComponents(model, input, {
        inputMp: 0,
        outputMp: catalogOutputMegapixels(input),
        seconds,
    }).reduce((sum, c) => sum + c.costOverride, 0);
};

describe('priced Replicate catalog', () => {
    it.each(
        ADDITIONAL_REPLICATE_IMAGE_MODELS.map(
            (model) => [model.id, model] as const,
        ),
    )(
        '%s builds a valid request and a finite credit estimate',
        (_id, model) => {
            const params: IGenerateParams = { prompt };
            for (const key of model.requiredInputs ?? []) {
                if (key === 'prompt' || key === 'instruction') continue;
                params[key] =
                    model.inputSchema![key]?.type === 'array'
                        ? [image]
                        : key.includes('image')
                          ? image
                          : key === 'workflow_json'
                            ? '{"1":{}}'
                            : 'fixture';
            }
            const input = buildCatalogInput(model, params);
            const components = catalogCostComponents(model, input, {
                inputMp: 1,
                outputMp: catalogOutputMegapixels(input),
                seconds: 60,
            });
            expect(components.length).toBeGreaterThan(0);
            expect(
                components.every(
                    (c) =>
                        Number.isFinite(c.costOverride) && c.costOverride >= 0,
                ),
            ).toBe(true);
            expect(components.some((c) => c.costOverride > 0)).toBe(true);
            expect(model.priceSource).toBe(
                `https://replicate.com/${model.id}#pricing`,
            );
        },
    );

    it('maps common prompt, image, mask, steps, and format fields to native inputs', () => {
        const input = buildCatalogInput(
            getModel('black-forest-labs/flux-fill-dev'),
            {
                prompt,
                input_image: image,
                maskImage: image,
                steps: 20,
                response_format: 'png',
                num_outputs: 8,
            },
        );
        expect(input).toMatchObject({
            prompt,
            image,
            mask: image,
            num_inference_steps: 20,
            output_format: 'png',
            num_outputs: 1,
        });
        expect(catalogImageInputs(input)).toEqual([image]);
    });

    it('maps instruction prompts and case-insensitive resolution tiers before billing', () => {
        const input = buildCatalogInput(
            getModel('sourceful/riverflow-2.0-pro'),
            { prompt, quality: '4k', input_images: [image] },
        );
        expect(input).toMatchObject({
            instruction: prompt,
            resolution: '4K',
            init_images: [image],
        });
        expect(
            cost('sourceful/riverflow-2.0-pro', {
                quality: '4K',
                fontUrls: ['https://example.com/font.woff'],
            }),
        ).toBe(36_000_000);
    });

    it('prices each supported image tier and rejects unknown tiers', () => {
        expect(cost('google/nano-banana-2', { quality: '2k' })).toBe(
            10_100_000,
        );
        expect(cost('openai/gpt-image-2', { quality: 'HIGH' })).toBe(
            12_800_000,
        );
        expect(() => cost('google/nano-banana-2', { quality: '3K' })).toThrow(
            /resolution/,
        );
    });

    it('prices runtime in seconds rather than charging an example-image price', () => {
        expect(cost('stability-ai/sdxl', {}, 12.5)).toBe(1_218_750);
        expect(cost('stability-ai/sdxl', {}, 25)).toBe(2_437_500);
    });

    it('includes run and input/output megapixel charges', () => {
        const model = getModel('black-forest-labs/flux-2-max');
        const input = buildCatalogInput(model, { prompt });
        const components = catalogCostComponents(model, input, {
            inputMp: 2,
            outputMp: 3,
            seconds: 1,
        });
        expect(components.reduce((sum, c) => sum + c.costOverride, 0)).toBe(
            19_000_000,
        );
    });

    it('normalizes abstract and pixel sizes into supported native dimensions', () => {
        const model = getModel('black-forest-labs/flux-2-flex');
        expect(
            buildCatalogInput(model, {
                prompt,
                imageSize: { kind: 'aspect', w: 17, h: 10 },
            }).aspect_ratio,
        ).toBe('16:9');
        expect(
            buildCatalogInput(model, {
                prompt,
                imageSize: { kind: 'pixels', w: 1536, h: 1024 },
            }),
        ).toMatchObject({ aspect_ratio: 'custom', width: 1536, height: 1024 });
    });

    it.each(
        ADDITIONAL_REPLICATE_IMAGE_MODELS.filter(
            (model) => model.inputSchema!.image_size,
        ).map((model) => [model.id, model] as const),
    )(
        '%s keeps the driver size object out of its native image_size input',
        (_id, model) => {
            const params: IGenerateParams = {
                prompt,
                imageSize: { kind: 'aspect', w: 16, h: 9 },
                ratio: { w: 16, h: 9 },
            };
            for (const key of model.requiredInputs ?? []) {
                if (key !== 'prompt') params[key] = image;
            }
            const input = buildCatalogInput(model, params);
            expect(input.image_size).toBe(
                model.inputSchema!.image_size.default,
            );
            expect(input).not.toHaveProperty('imageSize');
            expect(input).not.toHaveProperty('ratio');
        },
    );

    it('rejects required references, unsupported images, invalid arrays and empty workflows before inference', () => {
        expect(() =>
            buildCatalogInput(getModel('black-forest-labs/flux-canny-pro'), {
                prompt,
            }),
        ).toThrow(/control_image/);
        expect(() =>
            buildCatalogInput(getModel('bytedance/sdxl-lightning-4step'), {
                prompt,
                input_image: image,
            }),
        ).toThrow(/does not support/);
        expect(() =>
            buildCatalogInput(getModel('google/nano-banana-2'), {
                prompt,
                image_input: 42,
            }),
        ).toThrow(/image_input/);
        expect(() =>
            buildCatalogInput(getModel('comfyui/any-comfyui-workflow'), {
                prompt,
            }),
        ).toThrow(/workflow_json/);
    });

    it('never forwards caller API credentials or enables an unpriced fallback', () => {
        expect(
            buildCatalogInput(getModel('openai/gpt-image-2'), {
                prompt,
                openai_api_key: 'caller-value',
            }),
        ).not.toHaveProperty('openai_api_key');
        expect(() =>
            buildCatalogInput(getModel('google/nano-banana-pro'), {
                prompt,
                allow_fallback_model: true,
            }),
        ).toThrow(/allow_fallback_model/);
    });

    it('rejects unsupported billing quantities', () => {
        const model = getModel('black-forest-labs/flux-2-max');
        expect(() =>
            catalogCostComponents(model, buildCatalogInput(model, { prompt }), {
                inputMp: Number.NaN,
                outputMp: 1,
                seconds: 1,
            }),
        ).toThrow(/billing quantity/);
    });
});

describe('Replicate native options', () => {
    it.each([
        ['quiverai/arrow-1.1', 'references', [image]],
        ['luma/photon-flash', 'image_reference', image],
        ['minimax/image-01', 'subject_reference', image],
    ])('maps canonical references for %s', (id, key, expected) => {
        const input = buildCatalogInput(getModel(id as string), {
            prompt,
            input_image: image,
        });
        expect(input[key as string]).toEqual(expected);
        expect(catalogImageInputs(input)).toContain(image);
    });

    it('maps common sampling controls to each model schema', () => {
        const control = buildCatalogInput(
            getModel('jagilley/controlnet-scribble'),
            {
                prompt,
                input_image: image,
                steps: 12,
                guidance: 5,
                negative_prompt: 'blurry',
            },
        );
        expect(control).toMatchObject({
            ddim_steps: 12,
            scale: 5,
            n_prompt: 'blurry',
        });
        const sdxl = buildCatalogInput(getModel('stability-ai/sdxl'), {
            prompt,
            steps: 12,
            guidance: 5,
            strength: 0.4,
        });
        expect(sdxl).toMatchObject({
            num_inference_steps: 12,
            guidance_scale: 5,
            prompt_strength: 0.4,
        });
    });

    it('uses the edit image with a mask and style references without a mask', () => {
        const model = getModel('ideogram-ai/ideogram-v3-balanced');
        const edit = buildCatalogInput(model, {
            prompt,
            input_image: image,
            maskImage: image,
        });
        expect(edit).toMatchObject({ image, mask: image });
        expect(edit.style_reference_images).toBeUndefined();
        const style = buildCatalogInput(model, { prompt, input_image: image });
        expect(style.style_reference_images).toEqual([image]);
        expect(style.image).toBeUndefined();
    });

    it('requests one control-guided sample', () => {
        expect(
            buildCatalogInput(getModel('jagilley/controlnet-scribble'), {
                prompt,
                input_image: image,
                providerOptions: { numSamples: 4 },
            }).num_samples,
        ).toBe('1');
    });

    it('accepts camelCase native options without mutating them and gives common options precedence', () => {
        const providerOptions = Object.freeze({
            outputFormat: 'png',
            resolution: '4K',
        });
        const input = buildCatalogInput(getModel('google/nano-banana-2'), {
            prompt,
            quality: '2k',
            providerOptions,
        });
        expect(input).toMatchObject({ output_format: 'png', resolution: '2K' });
        expect(providerOptions).toEqual({
            outputFormat: 'png',
            resolution: '4K',
        });
    });

    it('rejects non-object native options', () => {
        expect(() =>
            buildCatalogInput(getModel('google/nano-banana-2'), {
                prompt,
                providerOptions: [],
            }),
        ).toThrow(/providerOptions must be an object/);
    });
});

describe('Replicate catalog availability', () => {
    it.each([
        'imagen-3-fast',
        'imagen-3',
        'imagen-4-fast',
        'imagen-4-ultra',
        'imagen-4',
    ])(
        'excludes retired Google %s even while its listing still publishes a price',
        (name) => {
            expect(
                ADDITIONAL_REPLICATE_IMAGE_MODELS.some(
                    (model) => model.id === `google/${name}`,
                ),
            ).toBe(false);
        },
    );

    it('requires the reference omitted from the SDXL ControlNet API required list', () => {
        expect(() =>
            buildCatalogInput(getModel('fermatresearch/sdxl-controlnet-lora'), {
                prompt,
            }),
        ).toThrow(/requires image/);
        expect(
            buildCatalogInput(getModel('fermatresearch/sdxl-controlnet-lora'), {
                prompt,
                input_image: image,
            }).image,
        ).toBe(image);
    });
});
