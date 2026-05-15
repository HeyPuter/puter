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

import crypto from 'node:crypto';
import { posix as pathPosix } from 'node:path';
import { assertNormalized } from '../../services/fs/resolveNode.js';
import { Readable } from 'node:stream';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { Actor } from '../../core/actor.js';
import { PuterDriver } from '../types.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { CloudflareImageProvider } from './providers/cloudflare/CloudflareImageProvider.js';
import { GeminiImageProvider } from './providers/gemini/GeminiImageProvider.js';
import { OpenAiImageProvider } from './providers/openai/OpenAiImageProvider.js';
import { ReplicateImageGenerationProvider } from './providers/replicate/ReplicateImageGenerationProvider.js';
import { TogetherImageProvider } from './providers/together/TogetherImageProvider.js';
import { XAIImageProvider } from './providers/xai/XAIImageProvider.js';
import type { IGenerateParams, IImageModel, IImageProvider } from './types.js';

/**
 * Driver implementing the `puter-image-generation` interface.
 *
 * Manages multiple upstream providers and routes `generate()` calls
 * based on the requested model. Mirrors ChatCompletionDriver's pattern:
 * providers are instantiated from config on boot, a model map is built
 * from each provider's declared models, and calls are dispatched.
 *
 * Output is a URL string (web URL or data URI) — no streaming, no
 * TypedValue wrapper.
 */
export class ImageGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-image-generation';
    readonly driverName = 'ai-image';
    // puter-js's `txt2img` falls through `options.driver` into the
    // driver-name slot (e.g. `xai-image-generation`), so alias all provider
    // ids here. `generate` falls back to `Context.driverName` when
    // `args.provider` isn't supplied.
    readonly driverAliases = [
        'openai-image-generation',
        'gemini-image-generation',
        'together-image-generation',
        'cloudflare-image-generation',
        'xai-image-generation',
        'replicate-image-generation',
    ];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, IImageProvider> = {};
    #modelIdMap: Record<string, IImageModel[]> = {};

    override onServerStart() {
        this.#registerProviders();
        this.#buildModelMap();
    }

    async models() {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((m) => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return (a.provider ?? '').localeCompare(b.provider ?? '');
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
                        source: `driver:aiImage/${model.provider}`,
                    });
                }
            }
        }
        return out;
    }

    async generate(args: IGenerateParams): Promise<string> {
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

        let modelId = args.model?.trim().toLowerCase();
        let intendedProvider =
            args.provider ?? (Context.get('driverName') as string | undefined);

        // Default: first registered provider's default model if none given
        if (!modelId && !intendedProvider) {
            intendedProvider = Object.keys(this.#providers)[0];
        }
        if (!modelId && intendedProvider) {
            modelId = this.#providers[intendedProvider]?.getDefaultModel();
        }
        if (!modelId)
            throw new HttpError(400, 'Missing `model`', {
                legacyCode: 'bad_request',
            });

        const model = this.#resolveModel(modelId, intendedProvider);
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

        // `width`/`height` or `aspect_ratio` -> `ratio: {w,h}`
        this.#normalizeRatio(args);

        // Audit log for abuse / billing. Fired before the upstream call
        // so a failed generate still shows up in the log (prompt_block
        // uses this to track user-by-user image prompts).
        const completionId = crypto.randomUUID();
        this.clients.event.emit(
            'ai.log.image',
            {
                actor,
                completionId,
                parameters: args,
                intended_service: model.id,
                model_used: model.id,
                service_used: model.provider!,
            },
            {},
        );

        const result = await provider.generate({
            ...args,
            model: model.id,
            provider: model.provider,
        });

        if (resolvedOutputPath) {
            await this.#saveToFS(actor, result, resolvedOutputPath);
        }

        return result;
    }

    #normalizeRatio(parameters: IGenerateParams) {
        if (parameters.ratio) return;

        const w = parameters.width as number | undefined;
        const h = parameters.height as number | undefined;
        if (typeof w === 'number' && typeof h === 'number') {
            parameters.ratio = { w, h };
            delete parameters.width;
            delete parameters.height;
            return;
        }

        const ar = parameters.aspect_ratio as string | undefined;
        if (typeof ar === 'string' && ar.includes(':')) {
            const [aw, ah] = ar.split(':').map(Number);
            if (
                Number.isFinite(aw) &&
                Number.isFinite(ah) &&
                aw > 0 &&
                ah > 0
            ) {
                parameters.ratio = { w: aw, h: ah };
                delete parameters.aspect_ratio;
                return;
            }
        }
    }

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.services.metering;

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
            providers['openai-image-generation'],
            providers['openai-completion'],
            providers['openai'],
        );
        if (openaiKey) {
            this.#providers['openai-image-generation'] =
                new OpenAiImageProvider({ apiKey: openaiKey }, m);
        }

        const geminiKey = readKey(
            providers['gemini-image-generation'],
            providers['gemini'],
        );
        if (geminiKey) {
            this.#providers['gemini-image-generation'] =
                new GeminiImageProvider({ apiKey: geminiKey }, m);
        }

        const togetherKey = readKey(
            providers['together-image-generation'],
            providers['together-ai'],
        );
        if (togetherKey) {
            this.#providers['together-image-generation'] =
                new TogetherImageProvider({ apiKey: togetherKey }, m);
        }

        const cloudflare = (providers['cloudflare-image-generation'] ??
            providers['cloudflare-workers-ai-image'] ??
            providers['cloudflare-workers-ai']) as
            | Record<string, unknown>
            | undefined;
        const cfToken =
            (cloudflare?.apiToken as string | undefined) ??
            (cloudflare?.apiKey as string | undefined) ??
            (cloudflare?.secret_key as string | undefined);
        const cfAccount =
            (cloudflare?.accountId as string | undefined) ??
            (cloudflare?.account_id as string | undefined);
        if (cfToken && cfAccount) {
            this.#providers['cloudflare-image-generation'] =
                new CloudflareImageProvider(
                    {
                        apiToken: cfToken,
                        accountId: cfAccount,
                        apiBaseUrl: cloudflare?.apiBaseUrl as
                            | string
                            | undefined,
                    },
                    m,
                );
        }

        const xaiKey = readKey(
            providers['xai-image-generation'],
            providers['xai'],
        );
        if (xaiKey) {
            this.#providers['xai-image-generation'] = new XAIImageProvider(
                { apiKey: xaiKey },
                m,
            );
        }

        const replicateKey = readKey(providers['replicate-image-generation']);
        if (replicateKey) {
            this.#providers['replicate-image-generation'] =
                new ReplicateImageGenerationProvider(
                    { apiKey: replicateKey },
                    m,
                );
        }
    }

    async #buildModelMap() {
        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];
            for (const model of await provider.models()) {
                model.id = model.id.trim().toLowerCase();
                if (!this.#modelIdMap[model.id]) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({
                    ...model,
                    provider: providerName,
                });

                if (model.puterId) {
                    model.aliases = model.aliases
                        ? [...model.aliases, model.puterId]
                        : [model.puterId];
                }
                if (model.aliases) {
                    for (let alias of model.aliases) {
                        alias = alias.trim().toLowerCase();
                        if (!this.#modelIdMap[alias]) {
                            this.#modelIdMap[alias] =
                                this.#modelIdMap[model.id];
                        } else if (
                            this.#modelIdMap[alias] !==
                            this.#modelIdMap[model.id]
                        ) {
                            this.#modelIdMap[alias].push({
                                ...model,
                                provider: providerName,
                            });
                            this.#modelIdMap[model.id] =
                                this.#modelIdMap[alias];
                        }
                    }
                }
            }
        }
    }

    async #saveToFS(
        actor: Actor,
        result: string,
        resolvedPath: string,
    ): Promise<void> {
        const userId = actor.user!.id!;

        let buffer: Buffer;
        let contentType: string;

        if (result.startsWith('data:')) {
            const commaIdx = result.indexOf(',');
            const header = result.substring(0, commaIdx);
            contentType =
                header.match(/data:(.*?);/)?.[1] ?? 'application/octet-stream';
            buffer = Buffer.from(result.substring(commaIdx + 1), 'base64');
        } else {
            const response = await fetch(result);
            if (!response.ok) {
                throw new HttpError(
                    502,
                    `Failed to fetch generated image for FS write: ${response.status}`,
                    { legacyCode: 'internal_error' },
                );
            }
            contentType =
                response.headers.get('content-type') ??
                'application/octet-stream';
            buffer = Buffer.from(await response.arrayBuffer());
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

    #resolveModel(modelId: string, provider?: string): IImageModel | null {
        const models = this.#modelIdMap[modelId];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];
        return models.find((m) => m.provider === provider) ?? models[0];
    }
}
