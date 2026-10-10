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

import axios from 'axios';
import { OpenAI } from 'openai';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel, ICompleteArguments } from '../../types.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import {
    messagesHaveImageContent,
    modelSupportsVision,
} from '../../utils/mediaParts.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
    type UsageSource,
} from '../OpenAICompatProvider.js';
import {
    mapNeuralwattApiModel,
    NEURALWATT_DEFAULT_MODEL,
    NEURALWATT_ID_PREFIX,
    type NeuralwattAccountingMethod,
    type NeuralwattApiModel,
    type NeuralwattCost,
    type NeuralwattEnergy,
} from './models.js';

const DEFAULT_API_BASE_URL = 'https://api.neuralwatt.com/v1';

type NeuralwattUsage = OpenAI.Completions.CompletionUsage & {
    request_cost_usd?: number;
    energy_kwh?: number;
    energy_joules?: number;
    measurement_available?: boolean;
};

const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

export class NeuralwattProvider extends OpenAICompatProvider {
    #apiKey: string;

    #apiBaseUrl: string;

    /** The account's accounting method as last fetched. */
    #accountingMethod: NeuralwattAccountingMethod | undefined;

    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        const apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: apiBaseUrl,
                ...sdkClientOptions(),
            }),
            defaultModel: NEURALWATT_DEFAULT_MODEL,
            idPrefix: NEURALWATT_ID_PREFIX,
            passthrough: ['temperature'],
            // Vision models expect inline data URLs rather than remote
            // http(s) fetches for image_url parts.
            inlineImages: 'vision',
            // A stream's final chunk carries cost and energy beside `usage`.
            usageFromStreamChunk: (chunk: {
                usage?: NeuralwattUsage;
                cost?: NeuralwattCost;
                energy?: NeuralwattEnergy;
            }) => {
                if (!chunk.usage) return chunk.usage;
                return {
                    ...chunk.usage,
                    ...(typeof chunk.cost?.request_cost_usd === 'number'
                        ? { request_cost_usd: chunk.cost.request_cost_usd }
                        : {}),
                    ...(chunk.energy
                        ? {
                              energy_kwh: chunk.energy.energy_kwh,
                              energy_joules: chunk.energy.energy_joules,
                              measurement_available:
                                  chunk.energy.measurement_available,
                          }
                        : {}),
                };
            },
        });
        this.#apiKey = config.apiKey;
        this.#apiBaseUrl = apiBaseUrl;
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    #catalog = cachedRemoteCatalog({
        name: 'Neuralwatt catalog',
        fallback: [] as IChatModel[],
        fetch: async (signal) => {
            const resp = await axios.request({
                method: 'GET',
                url: `${this.#apiBaseUrl}/models`,
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                },
                signal,
            });
            const coerced: IChatModel[] = [];
            for (const model of (resp.data.data ??
                []) as NeuralwattApiModel[]) {
                if (model.metadata?.deprecated) continue;
                const mapped = mapNeuralwattApiModel(model);
                if (mapped) coerced.push(mapped);
            }
            return coerced;
        },
    });

    /**
     * The account's accounting method (`energy` | `token`) from `GET
     * /v1/quota`. Used only to annotate returned usage — billing always prefers
     * `cost.request_cost_usd` on the completion.
     */
    readonly getAccountingMethod = cachedRemoteCatalog({
        name: 'Neuralwatt quota',
        fallback: undefined as NeuralwattAccountingMethod | undefined,
        fetch: async (signal) => {
            const resp = await axios.request({
                method: 'GET',
                url: `${this.#apiBaseUrl}/quota`,
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                },
                signal,
            });
            const raw = resp.data?.balance?.accounting_method;
            return raw === 'energy' || raw === 'token' ? raw : undefined;
        },
    });

    override async complete(args: ICompleteArguments) {
        const model = await this.resolveModel(args.model);
        if (
            messagesHaveImageContent(args.messages ?? []) &&
            !modelSupportsVision(model)
        ) {
            throw new HttpError(
                400,
                `Model ${model.id} does not support image input`,
                { legacyCode: 'bad_request' },
            );
        }
        this.#accountingMethod = await this.getAccountingMethod();
        return super.complete(args);
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        // The catalog says which models take `reasoning_effort`.
        const effort = args.reasoning_effort ?? args.reasoning?.effort;
        return model.reasoning_effort === true && effort
            ? { ...params, reasoning_effort: effort }
            : params;
    }

    protected override meteredUsage(source: UsageSource) {
        // Non-streaming spreads the full completion into the source;
        // streaming merges top-level cost/energy onto `usage`.
        const usage = source.usage as NeuralwattUsage;
        const cost = source.cost as NeuralwattCost | undefined;
        const requestCostUsd =
            typeof cost?.request_cost_usd === 'number'
                ? cost.request_cost_usd
                : usage.request_cost_usd;
        const energy = (source.energy as NeuralwattEnergy | undefined) ?? {
            energy_kwh: usage.energy_kwh,
            energy_joules: usage.energy_joules,
            measurement_available: usage.measurement_available,
        };
        const measured = energy.measurement_available !== false;
        return {
            usage: {
                ...OpenAIUtil.splitCachedPrompt(usage),
                ...(measured && positive(energy.energy_kwh)
                    ? { energy_kwh: energy.energy_kwh }
                    : {}),
                ...(measured && positive(energy.energy_joules)
                    ? { energy_joules: energy.energy_joules }
                    : {}),
            },
            // Billed at `request_cost_usd` when Neuralwatt reports it, at the
            // catalog's token rates otherwise. Energy is recorded, never
            // priced.
            meterOptions:
                typeof requestCostUsd === 'number' &&
                Number.isFinite(requestCostUsd)
                    ? { authoritativeUsd: requestCostUsd }
                    : { costOverrides: { energy_kwh: 0, energy_joules: 0 } },
        };
    }

    protected override reportedUsage(usage: Record<string, number>) {
        return this.#accountingMethod
            ? { ...usage, accounting_method: this.#accountingMethod }
            : usage;
    }
}

export { NEURALWATT_ID_PREFIX, NEURALWATT_DEFAULT_MODEL };
