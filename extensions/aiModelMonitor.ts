import axios from 'axios';
import { createHash } from 'node:crypto';
import { extension } from '@heyputer/backend/src/extensions';
import { PuterService } from '@heyputer/backend/src/services/types.js';
import type { JobRunContext } from '@heyputer/backend/src/services/jobs/JobScheduler.js';
import { readProviderKey } from '@heyputer/backend/src/util/aiProviderKey.js';
import { runWithConcurrencyLimit } from '@heyputer/backend/src/util/concurrency.js';

const EVERY_MS = 30 * 60_000;
const MAX_PAGES = 1_000;
const MAX_MODELS = 20_000;

type Format = 'openai' | 'claude' | 'gemini' | 'elevenlabs' | 'replicate';
interface ModelEndpoint {
    provider: string;
    name: string;
    configKeys: string[];
    baseUrl: string;
    format?: Format;
}

const ENDPOINTS: ModelEndpoint[] = [
    {
        provider: 'openai',
        name: 'OpenAI',
        configKeys: [
            'openai-completion',
            'openai',
            'openai-tts',
            'openai-image-generation',
            'openai-speech-to-text',
        ],
        baseUrl: 'https://api.openai.com/v1',
    },
    {
        provider: 'azure',
        name: 'Azure',
        configKeys: ['azure-openai'],
        baseUrl: '',
    },
    {
        provider: 'claude',
        name: 'Anthropic',
        configKeys: ['claude'],
        baseUrl: 'https://api.anthropic.com/v1',
        format: 'claude',
    },
    {
        provider: 'gemini',
        name: 'Google Gemini',
        configKeys: [
            'gemini',
            'gemini-image-generation',
            'gemini-video-generation',
            'gemini-tts',
        ],
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        format: 'gemini',
    },
    {
        provider: 'groq',
        name: 'Groq',
        configKeys: ['groq'],
        baseUrl: 'https://api.groq.com/openai/v1',
    },
    {
        provider: 'deepseek',
        name: 'DeepSeek',
        configKeys: ['deepseek'],
        baseUrl: 'https://api.deepseek.com',
    },
    {
        provider: 'mistral',
        name: 'Mistral',
        configKeys: ['mistral'],
        baseUrl: 'https://api.mistral.ai/v1',
    },
    {
        provider: 'moonshot',
        name: 'Moonshot',
        configKeys: ['moonshot'],
        baseUrl: 'https://api.moonshot.ai/v1',
    },
    {
        provider: 'minimax',
        name: 'MiniMax',
        configKeys: ['minimax', 'minimax-video-generation'],
        baseUrl: 'https://api.minimax.io/v1',
    },
    {
        provider: 'zai',
        name: 'Z.ai',
        configKeys: ['zai'],
        baseUrl: 'https://api.z.ai/api/paas/v4',
    },
    {
        provider: 'byteplus',
        name: 'BytePlus',
        configKeys: ['byteplus'],
        baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    },
    {
        provider: 'hoonify',
        name: 'Hoonify',
        configKeys: ['hoonify'],
        baseUrl: 'https://api.hoonify.ai/v1',
    },
    {
        provider: 'meta',
        name: 'Meta',
        configKeys: ['meta'],
        baseUrl: 'https://api.meta.ai/v1',
    },
    {
        provider: 'elevenlabs',
        name: 'ElevenLabs',
        configKeys: ['elevenlabs'],
        baseUrl: 'https://api.elevenlabs.io/v1',
        format: 'elevenlabs',
    },
    {
        provider: 'replicate',
        name: 'Replicate',
        configKeys: ['replicate-image-generation'],
        baseUrl: 'https://api.replicate.com/v1',
        format: 'replicate',
    },
];

interface Snapshot {
    source: string;
    models: string[];
}

export class AIModelMonitorService extends PuterService {
    override onServerStart(): void {
        this.services.jobs.register('ai-model-monitor', {
            every: EVERY_MS,
            scope: 'fleet',
            run: (ctx) => this.scan(ctx),
        });
    }

    async scan({ signal }: JobRunContext): Promise<void> {
        const targets = ENDPOINTS.flatMap((endpoint) =>
            endpoint.configKeys.map((configKey) => ({
                ...endpoint,
                configKey,
            })),
        );
        await runWithConcurrencyLimit(targets, 4, async (endpoint) => {
            signal.throwIfAborted();
            const config = this.config.providers[endpoint.configKey];
            const apiKey = readProviderKey(config);
            if (!apiKey || config?.enabled === false) return;
            const baseUrl =
                config?.apiURL ?? config?.apiBaseUrl ?? endpoint.baseUrl;
            if (!baseUrl) return;
            const format =
                endpoint.format === 'gemini' && config?.apiBaseUrl
                    ? 'openai'
                    : (endpoint.format ?? 'openai');
            const url = `${baseUrl.replace(/\/$/, '')}/models`;
            const source = createHash('sha256')
                .update(url)
                .update(apiKey)
                .digest('hex');
            const key = endpoint.configKey;
            const opts = { systemPartition: 'aiModelMonitor' };
            let operation: 'readSnapshot' | 'fetch' | 'writeSnapshot' =
                'readSnapshot';
            let old: Snapshot | null;
            let models: string[];
            try {
                const [stored, catalog] = await Promise.allSettled([
                    this.stores.kv.get({ key, consistentRead: true }, opts),
                    fetchModels(url, apiKey, format, signal),
                ]);
                signal.throwIfAborted();
                if (stored.status === 'rejected') throw stored.reason;
                old = stored.value.res as Snapshot | null;
                operation = 'fetch';
                if (catalog.status === 'rejected') throw catalog.reason;
                models = catalog.value;
                const snapshot = { source, models };
                if (Buffer.byteLength(JSON.stringify(snapshot)) > 350 * 1024)
                    throw new Error('Model snapshot too large');
                operation = 'writeSnapshot';
                // Persist before notifying so a rejected write cannot replay a change.
                await this.stores.kv.set({ key, value: snapshot }, opts);
            } catch {
                signal.throwIfAborted();
                // Upstream and storage errors can embed private response details.
                const fetchFailed = operation === 'fetch';
                this.clients.alarm.create(
                    fetchFailed
                        ? `ai_model_catalog_fetch_failed:${endpoint.provider}`
                        : `ai_model_catalog_snapshot_failed:${endpoint.provider}:${key}`,
                    fetchFailed
                        ? 'AI provider model catalog fetch failed'
                        : 'AI provider model catalog snapshot failed',
                    {
                        provider: endpoint.provider,
                        configKey: key,
                        ...(!fetchFailed
                            ? {
                                  operation:
                                      operation === 'readSnapshot'
                                          ? 'read'
                                          : 'write',
                              }
                            : {}),
                    },
                    'info',
                    {
                        channel: 'ai_providers',
                        summary: `${endpoint.name} model catalog ${fetchFailed ? 'could not be fetched' : 'snapshot could not be updated'}`,
                    },
                );
                return;
            }
            signal.throwIfAborted();
            if (old?.source === source) {
                const transition = createHash('sha256')
                    .update(JSON.stringify([source, old.models, models]))
                    .digest('hex');
                const before = new Set(old.models);
                const after = new Set(models);
                for (const [change, ids] of [
                    ['added', models.filter((id) => !before.has(id))],
                    ['removed', old.models.filter((id) => !after.has(id))],
                ] as const) {
                    for (const model of ids) {
                        const signature = createHash('sha256')
                            .update(JSON.stringify([transition, change, model]))
                            .digest('hex');
                        this.clients.alarm.create(
                            `ai_model_catalog_change:${endpoint.provider}:${signature}`,
                            `AI provider model ${change}`,
                            {
                                provider: endpoint.provider,
                                configKey: key,
                                model,
                                change,
                            },
                            'info',
                            {
                                channel: 'ai_providers',
                                summary: `${change === 'added' ? 'New' : 'Removed'} ${endpoint.name} model: ${model}`,
                            },
                        );
                    }
                }
            }
        });
        signal.throwIfAborted();
    }
}

async function fetchModels(
    startUrl: string,
    apiKey: string,
    format: Format,
    signal: AbortSignal,
): Promise<string[]> {
    const headers: Record<string, string> =
        format === 'claude'
            ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
            : format === 'gemini'
              ? { 'x-goog-api-key': apiKey }
              : format === 'elevenlabs'
                ? { 'xi-api-key': apiKey }
                : { Authorization: `Bearer ${apiKey}` };
    let url = new URL(startUrl);
    const visited = new Set<string>();
    const models = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
        if (visited.has(url.href))
            throw new Error('Repeated model catalog page');
        visited.add(url.href);
        const { data: body } = await axios.get(url.href, {
            headers,
            signal,
            timeout: 15_000,
            maxContentLength: 8 * 1024 * 1024,
            maxRedirects: 0,
        });
        const rows =
            format === 'elevenlabs'
                ? body
                : format === 'gemini'
                  ? body.models
                  : format === 'replicate'
                    ? body.results
                    : body.data;
        if (!Array.isArray(rows)) throw new Error('Invalid model catalog');
        for (const row of rows) {
            const id =
                format === 'elevenlabs'
                    ? row?.model_id
                    : format === 'gemini'
                      ? row?.name
                      : format === 'replicate'
                        ? row?.owner && row?.name
                            ? `${row.owner}/${row.name}`
                            : undefined
                        : row?.id;
            if (typeof id !== 'string' || !id || id.length > 256)
                throw new Error('Invalid model id');
            models.add(id);
            if (models.size > MAX_MODELS)
                throw new Error('Model catalog too large');
        }
        let next: URL | undefined;
        if (body.has_more === true) {
            if (typeof body.last_id !== 'string' || !body.last_id)
                throw new Error('Missing model cursor');
            next = new URL(url);
            next.searchParams.set('after_id', body.last_id);
        } else if (format === 'gemini' && body.nextPageToken) {
            if (typeof body.nextPageToken !== 'string')
                throw new Error('Invalid model cursor');
            next = new URL(url);
            next.searchParams.set('pageToken', body.nextPageToken);
        } else if (format === 'replicate' && body.next) {
            if (typeof body.next !== 'string')
                throw new Error('Invalid model cursor');
            next = new URL(body.next, url);
        }
        if (!next) return [...models].sort();
        if (
            next.origin !== url.origin ||
            next.pathname !== url.pathname ||
            next.username ||
            next.password
        )
            throw new Error('Invalid model page URL');
        url = next;
    }
    throw new Error('Incomplete model catalog');
}

extension.registerService('aiModelMonitor', AIModelMonitorService);
