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

import { posix as pathPosix } from 'node:path';
import { assertNormalized } from '../../services/fs/resolveNode.js';
import { Readable } from 'node:stream';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { Actor } from '../../core/actor.js';
import { PuterDriver } from '../types.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { GeminiVideoProvider } from './providers/gemini/GeminiVideoProvider.js';
import { OpenAIVideoProvider } from './providers/openai/OpenAIVideoProvider.js';
import { TogetherVideoProvider } from './providers/together/TogetherVideoProvider.js';
import type {
    IGenerateVideoParams,
    IVideoModel,
    IVideoProvider,
} from './types.js';

const DEFAULT_PROVIDER = 'openai-video-generation';

/**
 * Driver implementing the `puter-video-generation` interface.
 *
 * Manages multiple upstream providers (OpenAI/Sora, Together, Gemini/Veo, ...)
 * and handles model resolution, provider routing, and parameter normalisation.
 * Each provider is a plain `IVideoProvider` -- the driver instantiates them
 * from config on boot.
 *
 * Providers handle their own metering internally.
 */
export class VideoGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-video-generation';
    readonly driverName = 'ai-video';
    // puter-js's `txt2vid` can pass a provider id via `options.driver`, so
    // alias all provider ids here. `generate` falls back to
    // `Context.driverName` when `args.provider` isn't supplied.
    readonly driverAliases = [
        'openai-video-generation',
        'together-video-generation',
        'gemini-video-generation',
    ];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, IVideoProvider> = {};
    #modelIdMap: Record<string, IVideoModel[]> = {};

    override onServerStart() {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // -- Interface methods ---------------------------------------------------

    async models() {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((model) => {
                const identity = `${model.provider}:${model.puterId || model.id}`;
                if (seen.has(identity)) return false;
                seen.add(identity);
                return true;
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return a.provider!.localeCompare(b.provider!);
            });
    }

    async list() {
        return (await this.models()).map((m) => m.puterId || m.id).sort();
    }

    override getReportedCosts(): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (const bucket of Object.values(this.#modelIdMap)) {
            for (const model of bucket) {
                const key = `${model.provider}:${model.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                for (const [costKey, raw] of Object.entries(
                    (model as { costs?: Record<string, number> }).costs ?? {},
                )) {
                    if (typeof raw !== 'number' || !Number.isFinite(raw))
                        continue;
                    out.push({
                        usageType: `${model.provider}:${model.id}:${costKey}`,
                        costValue: raw,
                        source: `driver:aiVideo/${model.provider}`,
                    });
                }
            }
        }
        return out;
    }

    async generate(args: IGenerateVideoParams) {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        const puterOutputPath = args.puter_output_path;
        delete args.puter_output_path;

        // Validate the output path early — before spending credits.
        let resolvedOutputPath: string | undefined;
        if (puterOutputPath) {
            const username = actor.user?.username;
            const userId = actor.user?.id;
            if (!userId || !username) {
                throw new HttpError(
                    400,
                    'User ID required for puter_output_path',
                    { legacyCode: 'bad_request' },
                );
            }
            resolvedOutputPath = this.#resolveOutputPath(
                puterOutputPath,
                username,
            );
            await this.#assertWriteAccess(actor, resolvedOutputPath);
        }

        if (args.model) {
            args.model = args.model.trim().toLowerCase();
        }

        const configuredProviders = Object.keys(this.#providers);
        if (configuredProviders.length === 0) {
            throw new Error('no video generation providers configured');
        }

        let intendedProvider =
            args.provider ??
            (Context.get('driverName') as string | undefined) ??
            '';

        if (!args.model && !intendedProvider) {
            intendedProvider = configuredProviders.includes(DEFAULT_PROVIDER)
                ? DEFAULT_PROVIDER
                : configuredProviders[0];
        }

        if (intendedProvider && !this.#providers[intendedProvider]) {
            intendedProvider = configuredProviders[0];
        }

        if (!args.model && intendedProvider) {
            args.model = this.#providers[intendedProvider].getDefaultModel();
        }

        const model = args.model
            ? this.#resolveModel(args.model, intendedProvider)
            : undefined;

        if (!model) {
            throw new HttpError(400, `Model not found: ${args.model}`, {
                legacyCode: 'bad_request',
            });
        }

        const provider = this.#providers[model.provider!];
        if (!provider) {
            throw new HttpError(
                500,
                `No provider found for model ${model.id}`,
                { legacyCode: 'internal_error' },
            );
        }

        // Validate / normalise duration
        if (model.durationSeconds?.length) {
            const requestedSeconds = args.seconds ?? args.duration;
            const normalizedSeconds =
                typeof requestedSeconds === 'string'
                    ? Number.parseInt(requestedSeconds, 10)
                    : requestedSeconds;
            const validSeconds = model.durationSeconds.includes(
                Number(normalizedSeconds),
            )
                ? normalizedSeconds
                : model.durationSeconds[0];
            args.seconds = validSeconds;
            args.duration = validSeconds;
        }

        // Validate / normalise dimensions
        if (model.dimensions?.length) {
            const requestedResolution =
                typeof args.size === 'string' && args.size.trim()
                    ? args.size
                    : typeof args.resolution === 'string' &&
                        args.resolution.trim()
                      ? args.resolution
                      : undefined;

            const normalizedResolution =
                requestedResolution &&
                model.dimensions.includes(requestedResolution)
                    ? requestedResolution
                    : model.dimensions[0];
            args.size = normalizedResolution;
            args.resolution = normalizedResolution;
        }

        const result = await provider.generate({
            ...args,
            model: model.id,
            provider: model.provider,
        });

        if (resolvedOutputPath) {
            return await this.#saveToFS(actor, result, resolvedOutputPath);
        }

        return result;
    }

    // -- Provider registration -----------------------------------------------

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.services.metering;

        // Same lenient reader as ImageGenerationDriver — accept
        // `apiKey || secret_key`, and fall back from the video-specific
        // provider key to the shared chat key when unset.
        const readKey = (
            ...cfgs: Array<Record<string, unknown> | undefined>
        ): string | undefined => {
            for (const cfg of cfgs) {
                if (!cfg) continue;
                const k =
                    (cfg.apiKey as string | undefined) ??
                    (cfg.secret_key as string | undefined);
                if (k) return k;
            }
            return undefined;
        };

        const openaiKey = readKey(
            providers['openai-video-generation'],
            providers['openai-completion'],
            providers['openai'],
        );
        if (openaiKey) {
            this.#providers['openai-video-generation'] =
                new OpenAIVideoProvider({ apiKey: openaiKey }, m);
        }

        const togetherKey = readKey(
            providers['together-video-generation'],
            providers['together-ai'],
        );
        if (togetherKey) {
            this.#providers['together-video-generation'] =
                new TogetherVideoProvider({ apiKey: togetherKey }, m);
        }

        const geminiKey = readKey(
            providers['gemini-video-generation'],
            providers['gemini'],
        );
        if (geminiKey) {
            this.#providers['gemini-video-generation'] =
                new GeminiVideoProvider({ apiKey: geminiKey }, m);
        }
    }

    // -- Model map -----------------------------------------------------------

    async #buildModelMap() {
        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];
            for (const model of await provider.models()) {
                model.id = model.id.trim().toLowerCase();
                if (model.puterId) {
                    model.puterId = model.puterId.trim().toLowerCase();
                }
                if (model.aliases) {
                    model.aliases = model.aliases.map((alias) =>
                        alias.trim().toLowerCase(),
                    );
                }
                if (!this.#modelIdMap[model.id]) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({
                    ...model,
                    provider: providerName,
                });

                if (model.puterId) {
                    if (model.aliases) {
                        model.aliases.push(model.puterId);
                    } else {
                        model.aliases = [model.puterId];
                    }

                    // Derive standard alias forms from puterId for model singularity:
                    // puterId "service:org/model" -> "org/model" and "model"
                    const withoutService = model.puterId.includes(':')
                        ? model.puterId.slice(model.puterId.indexOf(':') + 1)
                        : model.puterId;
                    if (!model.aliases.includes(withoutService)) {
                        model.aliases.push(withoutService);
                    }
                    const shortName = withoutService.includes('/')
                        ? withoutService.slice(withoutService.indexOf('/') + 1)
                        : withoutService;
                    if (
                        shortName !== withoutService &&
                        !model.aliases.includes(shortName)
                    ) {
                        model.aliases.push(shortName);
                    }
                }

                if (model.aliases) {
                    for (let alias of model.aliases) {
                        alias = alias.trim().toLowerCase();
                        if (!this.#modelIdMap[alias]) {
                            this.#modelIdMap[alias] =
                                this.#modelIdMap[model.id];
                            continue;
                        }
                        if (
                            this.#modelIdMap[alias] !==
                            this.#modelIdMap[model.id]
                        ) {
                            this.#modelIdMap[alias].push({
                                ...model,
                                provider: providerName,
                            });
                            this.#modelIdMap[model.id] =
                                this.#modelIdMap[alias];
                            continue;
                        }
                    }
                }

                // Sort: cheapest first
                this.#modelIdMap[model.id].sort((a, b) => {
                    const aCostKey =
                        a.index_cost_key ||
                        a.output_cost_key ||
                        Object.keys(a.costs || {})[0];
                    const bCostKey =
                        b.index_cost_key ||
                        b.output_cost_key ||
                        Object.keys(b.costs || {})[0];
                    const aCost = a.costs?.[aCostKey] ?? Infinity;
                    const bCost = b.costs?.[bCostKey] ?? Infinity;
                    return aCost - bCost;
                });
            }
        }
    }

    async #saveToFS(
        actor: Actor,
        result: unknown,
        resolvedPath: string,
    ): Promise<unknown> {
        const userId = actor.user!.id!;

        let buffer: Buffer;
        let contentType: string;

        if (typeof result === 'string') {
            if (result.startsWith('data:')) {
                const commaIdx = result.indexOf(',');
                const header = result.substring(0, commaIdx);
                contentType = header.match(/data:(.*?);/)?.[1] ?? 'video/mp4';
                buffer = Buffer.from(result.substring(commaIdx + 1), 'base64');
            } else {
                const response = await fetch(result);
                if (!response.ok) {
                    throw new HttpError(
                        502,
                        `Failed to fetch generated video for FS write: ${response.status}`,
                        { legacyCode: 'internal_error' },
                    );
                }
                contentType =
                    response.headers.get('content-type') ?? 'video/mp4';
                buffer = Buffer.from(await response.arrayBuffer());
            }
        } else if (result && typeof result === 'object' && 'stream' in result) {
            const streamResult = result as {
                stream: Readable;
                content_type: string;
            };
            contentType = streamResult.content_type || 'video/mp4';
            const chunks: Buffer[] = [];
            for await (const chunk of streamResult.stream) {
                chunks.push(
                    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                );
            }
            buffer = Buffer.concat(chunks);
        } else {
            throw new HttpError(
                500,
                'Unsupported video result format for puter_output_path',
                { legacyCode: 'internal_error' },
            );
        }

        await this.services.fs.write(userId, {
            fileMetadata: {
                path: resolvedPath,
                size: buffer.length,
                contentType,
                overwrite: true,
                createMissingParents: true,
            },
            fileContent: Readable.from(buffer),
        });

        // For stream results, reconstruct a new stream from the buffered data
        if (typeof result !== 'string') {
            return {
                stream: Readable.from(buffer),
                content_type: contentType,
            };
        }

        return result;
    }

    #resolveOutputPath(outputPath: string, username: string): string {
        let resolved = outputPath.trim();
        if (resolved === '~' || resolved.startsWith('~/')) {
            resolved = `/${username}${resolved.slice(1)}`;
        }
        assertNormalized(resolved);
        if (!resolved.startsWith('/')) {
            resolved = `/${resolved}`;
        }
        if (resolved.length > 1 && resolved.endsWith('/')) {
            resolved = resolved.slice(0, -1);
        }
        return resolved;
    }

    async #assertWriteAccess(
        actor: Actor,
        resolvedPath: string,
    ): Promise<void> {
        if (resolvedPath === '/') {
            throw new HttpError(400, 'Cannot write to root path', {
                legacyCode: 'cannot_write_to_root',
            });
        }
        const parentPath = pathPosix.dirname(resolvedPath);
        if (parentPath === '/') {
            throw new HttpError(400, 'Cannot write to root path', {
                legacyCode: 'cannot_write_to_root',
            });
        }

        const pathToCheck = parentPath;
        const fsService = this.services.fs;
        let ancestorsCache: Promise<
            Array<{ uid: string; path: string }>
        > | null = null;
        const canWrite = await this.services.acl.check(
            actor,
            {
                path: pathToCheck,
                resolveAncestors() {
                    if (!ancestorsCache) {
                        ancestorsCache =
                            fsService.getAncestorChain(pathToCheck);
                    }
                    return ancestorsCache;
                },
            },
            'write',
        );
        if (!canWrite) {
            throw new HttpError(403, 'Write access denied for destination', {
                legacyCode: 'access_denied',
            });
        }
    }

    #resolveModel(modelId: string, provider?: string): IVideoModel | null {
        const models = this.#modelIdMap[modelId?.trim().toLowerCase()];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];

        // Prefer exact primary ID match over alias matches
        const exactIdMatch = models.find(
            (m) => m.id === modelId && m.provider === provider,
        );
        if (exactIdMatch) return exactIdMatch;

        const exactPuterIdMatch = models.find(
            (m) => m.puterId === modelId && m.provider === provider,
        );
        if (exactPuterIdMatch) return exactPuterIdMatch;

        return models.find((m) => m.provider === provider) ?? models[0];
    }
}
