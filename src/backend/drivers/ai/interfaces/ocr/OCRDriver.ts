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

import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import { awsCredentialsFrom } from '../../../../util/awsCredentials.js';
import { assertActorHasCredits } from '../../../../services/metering/enforcement.js';
import { PuterDriver } from '../../../types.js';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../../../../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../../shared/aiLimits.js';
import { assertScalarOptions } from '../../shared/scalarOptions.js';
import { resolveFileInput } from '../../../util/fileInput.js';
import {
    type ProviderCatalog,
    ProviderRegistry,
} from '../../shared/providerRegistry.js';
import { readProviderKey } from '../../../../util/aiProviderKey.js';
import {
    TEXTRACT_PAGE_USAGE_TYPE,
    TextractOcrProvider,
} from '../../providers/awsTextract/ocr/TextractOcrProvider.js';
import { MistralOcrProvider } from '../../providers/mistral/ocr/MistralOcrProvider.js';
import { badRequest } from './common.js';
import { OCR_COSTS } from './costs.js';
import {
    DEFAULT_OCR_MODEL,
    findOcrModel,
    OCR_MAX_INPUT_BYTES,
    RETIRED_OCR_MODELS,
    type OcrModel,
    type OcrProviderId,
} from './models.js';
import type { IOcrProvider, RecognizeArgs } from './types.js';

// Aliases callers may use in place of a canonical provider id. Resolved here
// rather than in the SDK so a new alias reaches every caller at once.
const OCR_CATALOG: ProviderCatalog = {
    label: 'OCR',
    ids: ['aws-textract', 'mistral'],
    defaultId: 'aws-textract',
    aliases: {
        aws: 'aws-textract',
        'aws-textract': 'aws-textract',
        textract: 'aws-textract',
        mistral: 'mistral',
        'mistral-ocr': 'mistral',
    },
};

const NOT_CONFIGURED: Record<OcrProviderId, string> = {
    'aws-textract': 'AWS credentials not configured',
    mistral: 'Mistral OCR not configured',
};

// Options the providers read as text, a number or a flag.
const SCALAR_OPTIONS = [
    'provider',
    'model',
    'documentAnnotationPrompt',
    'tableFormat',
    'imageLimit',
    'imageMinSize',
];

/**
 * Driver implementing `puter-ocr`, document OCR, with two providers:
 * `aws-textract` and `mistral`.
 */
export class OCRDriver extends PuterDriver {
    readonly driverInterface = 'puter-ocr';
    readonly driverName = 'ai-ocr';

    // Shared AI policy — see `drivers/ai/shared/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    /** Metering scoped to this driver. */
    get #aiMetering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            this.driverName,
        );
    }

    /**
     * Textract is reported at the configured region's first-tier rate. A call
     * that reads its file from a bucket in another region is billed at that
     * region's rate instead, which this per-usage-type report can't show.
     */
    override getReportedCosts() {
        return Object.entries(OCR_COSTS).map(([usageType, ucentsPerUnit]) => ({
            usageType,
            ucentsPerUnit:
                usageType === TEXTRACT_PAGE_USAGE_TYPE
                    ? (this.#textract?.reportedPageRate() ?? ucentsPerUnit)
                    : ucentsPerUnit,
            unit: 'page',
            source: 'driver:aiOcr',
        }));
    }

    // Older SDK bundles name the provider in the driver slot instead of
    // passing `{ provider }`; `#resolveModel` reads the requested alias
    // back off the Context.
    readonly driverAliases = [...OCR_CATALOG.ids];
    readonly isDefault = true;

    /** The registered Textract provider, whose live rate the cost report reads. */
    #textract: TextractOcrProvider | undefined;

    #providers = new ProviderRegistry<IOcrProvider>(OCR_CATALOG);

    override onServerStart() {
        const providers = this.config.providers ?? {};
        const metering = this.#aiMetering;

        const textract = providers['aws-textract'] as
            Record<string, unknown> | undefined;
        const textractAws = (textract?.aws ?? textract) as
            Record<string, unknown> | undefined;
        const textractCredentials = awsCredentialsFrom(textractAws);
        if (textractCredentials) {
            this.#textract = new TextractOcrProvider(metering, {
                credentials: textractCredentials,
                region:
                    (textractAws?.region as string | undefined) ??
                    (textract?.region as string | undefined),
            });
            this.#providers.register('aws-textract', this.#textract);
        }

        const mistralKey = readProviderKey(providers['mistral-ocr']);
        if (mistralKey) {
            try {
                this.#providers.register(
                    'mistral',
                    new MistralOcrProvider(metering, { apiKey: mistralKey }),
                );
            } catch (e) {
                console.warn(
                    '[OCRDriver] Failed to init Mistral:',
                    (e as Error).message,
                );
            }
        }
    }

    async recognize(args: RecognizeArgs) {
        assertScalarOptions(args, SCALAR_OPTIONS);
        if (args.test_mode) return sampleResponse();

        const model = this.#resolveModel(args);

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        const input = args.source ?? args.file;
        if (!input) throw badRequest('`source` is required');

        const provider = this.#providers.get(model.provider);
        if (!provider)
            throw new HttpError(500, NOT_CONFIGURED[model.provider], {
                legacyCode: 'internal_error',
            });

        // Cheap, cached check: reject a zero-balance actor before paying for
        // the file load and page estimate, which a real credit check would
        // reject anyway once it runs.
        await assertActorHasCredits(this.services.metering, actor, this.config);

        // A Puter file is resolved and access-checked here but read only if
        // the provider needs its bytes; Textract reads it straight from S3.
        const resolved = await resolveFileInput(
            this.stores,
            this.services.fs,
            actor,
            input,
            {
                acceptWebInput: true,
                maxBytes: OCR_MAX_INPUT_BYTES[model.provider],
            },
        );

        return provider.recognize(resolved, args, model, actor);
    }

    /**
     * Decide which model handles a call. A `model` picks its own provider; an
     * explicit `provider`, then the legacy driver alias the caller dispatched
     * through, then whichever provider is configured pick that provider's
     * default model.
     */
    #resolveModel(args: RecognizeArgs): OcrModel {
        const provider = args.provider
            ? (this.#providers.resolve(args.provider) as OcrProviderId)
            : undefined;

        if (args.model !== undefined) {
            if (typeof args.model !== 'string' || !args.model.trim())
                throw badRequest('`model` must be a non-empty string');
            const retired = RETIRED_OCR_MODELS[args.model.trim().toLowerCase()];
            if (retired)
                throw badRequest(
                    `${args.model} is no longer available: ${retired}`,
                );
            const model = findOcrModel(args.model);
            if (!model) throw badRequest(`Unknown OCR model: ${args.model}`);
            if (provider && model.provider !== provider)
                throw badRequest(
                    `OCR model ${args.model} is not served by provider ${args.provider}`,
                );
            return model;
        }

        const hinted =
            provider ?? this.#providers.normalize(Context.get('driverName'));
        if (!hinted && this.#providers.names().length === 0)
            throw new HttpError(500, 'No OCR provider configured', {
                legacyCode: 'internal_error',
            });
        const chosen = (hinted ?? this.#providers.defaultId()) as OcrProviderId;
        return findOcrModel(DEFAULT_OCR_MODEL[chosen])!;
    }
}

function sampleResponse() {
    return {
        model: 'test-mode',
        blocks: [
            {
                type: 'text/puter:sample-output',
                confidence: 1,
                text: 'test_mode is enabled; this is a sample OCR response.',
                page: 0,
            },
        ],
        text: 'test_mode is enabled; this is a sample OCR response.',
    };
}
