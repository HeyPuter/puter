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

import { requiredInputModalities } from './mediaParts.js';
import type {
    IChatModel,
    ICompleteArguments,
    ModelCost,
    ServiceSpeed,
} from '../types.js';

export const lowerServiceSpeed = (speed: ServiceSpeed): ServiceSpeed =>
    speed === 'ultrafast' ? 'fast' : 'standard';

const tokenRates = (costs: ModelCost, multiplier: number): ModelCost =>
    Object.fromEntries(
        Object.entries(costs).map(([key, value]) => [
            key,
            key !== 'tokens' &&
            /token|^prompt$|^completion$|^input_cache_/.test(key)
                ? value * multiplier
                : value,
        ]),
    );

export const serviceSpeedCosts = (
    model: IChatModel,
    speed: 'fast' | 'ultrafast',
): ModelCost | undefined => {
    if (model.serviceSpeeds && !model.serviceSpeeds.includes(speed))
        return undefined;
    const rates = model.serviceSpeedRates?.[speed];
    return typeof rates === 'number'
        ? tokenRates(model.costs, rates)
        : rates
          ? { ...model.costs, ...rates }
          : undefined;
};

export interface ServiceSpeedSelection {
    model: IChatModel;
    args: ICompleteArguments;
    speed: ServiceSpeed;
}

/** Select only an equivalent model from the same provider's loaded catalog. */
export const selectServiceSpeed = (
    model: IChatModel,
    args: ICompleteArguments,
    findVariant: (id: string) => IChatModel | undefined,
    offers: Partial<Record<'fast' | 'ultrafast', IChatModel>> = {},
): ServiceSpeedSelection => {
    if (args.serviceSpeed === undefined)
        return { model, args, speed: 'standard' };
    const provider = model.provider;
    const fast =
        offers.fast?.costs ??
        (provider === 'gemini' &&
        (requiredInputModalities(args.messages).some(
            (modality) => !['text', 'image'].includes(modality),
        ) ||
            args.messages.some(
                (message) =>
                    Array.isArray(message.content) &&
                    message.content.some(
                        (part: Record<string, unknown>) =>
                            part &&
                            [
                                'input_audio',
                                'audio_url',
                                'document',
                                'file',
                                'input_file',
                            ].includes(String(part.type)),
                    ),
            ))
            ? undefined
            : serviceSpeedCosts(model, 'fast'));
    const ultra =
        offers.ultrafast?.costs ?? serviceSpeedCosts(model, 'ultrafast');
    let speed = args.serviceSpeed;
    const variantId = model.serviceSpeedVariants?.fast;
    const variant =
        offers.fast && offers.fast.id !== model.id
            ? offers.fast
            : variantId
              ? findVariant(variantId)
              : undefined;
    while (speed !== 'standard') {
        if (speed === 'ultrafast' && ultra) break;
        if (speed === 'fast' && (fast || variant)) break;
        speed = lowerServiceSpeed(speed);
    }
    const request: ICompleteArguments = {
        ...args,
        serviceSpeed: speed,
        speed: undefined,
        service_tier: undefined,
    };
    if (speed === 'fast' && variant) {
        return {
            model: { ...variant, release_date: model.release_date },
            args: request,
            speed,
        };
    }
    if (provider === 'gemini' && fast)
        request.service_tier = speed === 'fast' ? 'priority' : 'standard';
    else if (provider === 'claude')
        request.speed = speed === 'fast' ? 'fast' : 'standard';
    else if (provider === 'mistral')
        request.service_tier = speed === 'fast' ? 'auto' : 'default';
    else if (
        provider === 'minimax' &&
        model.serviceSpeedRates?.fast !== undefined
    )
        request.service_tier = speed === 'fast' ? 'priority' : 'standard';
    else if (fast || ultra)
        request.service_tier =
            speed === 'ultrafast'
                ? 'ultrafast'
                : speed === 'fast'
                  ? 'priority'
                  : 'default';
    if (
        speed === 'standard' &&
        [
            'openai-completion',
            'openai-responses',
            'azure-openai',
            'azure-openai-responses',
            'openrouter',
        ].includes(provider ?? '')
    )
        request.service_tier = 'default';
    const selectedCosts =
        speed === 'ultrafast' ? ultra : speed === 'fast' ? fast : undefined;
    return {
        args: request,
        speed,
        model: selectedCosts
            ? {
                  ...model,
                  costs: selectedCosts,
                  pricingOverrides: model.pricingOverrides?.map((override) => ({
                      ...override,
                      costs: Object.fromEntries(
                          Object.entries(override.costs).map(([key, value]) => [
                              key,
                              model.costs[key] > 0
                                  ? (value *
                                        (selectedCosts[key] ??
                                            model.costs[key])) /
                                    model.costs[key]
                                  : value,
                          ]),
                      ),
                  })),
                  serviceSpeedPricing: {
                      speed,
                      standardCosts: model.costs,
                      standardOverrides: model.pricingOverrides,
                      fastCosts: fast,
                      ultrafastCosts: ultra,
                  },
              }
            : model,
    };
};

/** The response is authoritative; an absent tier never earns a premium. */
export const servedServiceSpeed = (
    source: Record<string, unknown>,
): ServiceSpeed => {
    const usage = source.usage as Record<string, unknown> | undefined;
    const tier =
        usage?.speed ??
        usage?.serviceTier ??
        usage?.service_tier ??
        source.service_tier;
    return tier === 'ultrafast'
        ? 'ultrafast'
        : tier === 'fast' || tier === 'priority'
          ? 'fast'
          : 'standard';
};

export const serviceSpeedBillingModel = (
    model: IChatModel,
    speed: ServiceSpeed,
): IChatModel => {
    const pricing = model.serviceSpeedPricing;
    if (!pricing || pricing.speed === speed) return model;
    const costs =
        speed === 'fast'
            ? (pricing.fastCosts ?? pricing.standardCosts)
            : pricing.standardCosts;
    return {
        ...model,
        costs,
        pricingOverrides: pricing.standardOverrides?.map((override) => ({
            ...override,
            costs: Object.fromEntries(
                Object.entries(override.costs).map(([key, value]) => [
                    key,
                    pricing.standardCosts[key] > 0
                        ? (value * (costs[key] ?? pricing.standardCosts[key])) /
                          pricing.standardCosts[key]
                        : value,
                ]),
            ),
        })),
    };
};

/** Retry only failures that explicitly concern admission to the faster tier. */
export const isServiceSpeedUnavailable = (
    error: unknown,
    variant = false,
): boolean => {
    const e = error as {
        status?: number;
        statusCode?: number;
        message?: unknown;
        error?: { message?: unknown };
    };
    const status = e?.status ?? e?.statusCode;
    const message = e?.error?.message ?? e?.message ?? '';
    if (typeof message !== 'string') return false;
    if (
        variant &&
        [400, 404].includes(status ?? 0) &&
        /model.*(?:not found|not exist|unavailable)/i.test(message)
    )
        return true;
    return (
        [400, 403, 429, 503].includes(status ?? 0) &&
        /fast mode|ultrafast|service[_ ]?tier|priority (?:tier|processing|capacity)|speed parameter/i.test(
            message,
        ) &&
        /unavailable|unsupported|not support|rate.limit|quota|capacity|not enabled|not allowed|access|exceed|invalid value/i.test(
            message,
        )
    );
};
