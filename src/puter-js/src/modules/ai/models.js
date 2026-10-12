import { fetchUrl } from '../../lib/networkUtils.js';

const MODEL_CACHE_MS = 60_000;
const MAX_CACHED_PROVIDERS = 32;
/** @type {WeakMap<object, { origin: string; token: string; entries: Map<string, { expires: number; promise: Promise<Record<string, unknown>[]> }> }>} */
const modelCaches = new WeakMap();

/**
 * @overload
 * @param {string} [provider]
 * @returns {Promise<Record<string, unknown>[]>}
 */
/**
 * Returns a list of available AI models, optionally filtered by provider.
 * Prefers the public API endpoint and falls back to the legacy driver call.
 *
 * @this {import('./index.js').AIModule}
 * @param {string} [provider]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function listModels (provider) {
    const { puter } = this;

    let cache = modelCaches.get(puter);
    if (!cache || cache.origin !== puter.APIOrigin || cache.token !== puter.authToken) {
        cache = { origin: puter.APIOrigin, token: puter.authToken, entries: new Map() };
        modelCaches.set(puter, cache);
    }
    const key = provider || '';
    const existing = cache.entries.get(key);
    if (existing && existing.expires > Date.now()) {
        return structuredClone(await existing.promise);
    }

    const load = async () => {
        const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
        const resp = await fetchUrl(
            `${puter.APIOrigin}/puterai/chat/models/details${query}`,
            { includePuterAuth: !!puter.authToken, authToken: puter.authToken },
        );
        let models;
        if (resp.ok) {
            models = (await resp.json())?.models;
        } else if (resp.status === 404 || resp.status === 501) {
            const envelope = await puter.drivers.call('puter-chat-completion', 'ai-chat', 'models');
            models = envelope?.result;
        } else {
            throw await resp.json();
        }
        if (!Array.isArray(models)) {
            throw { message: 'Invalid model catalogue response.', code: 'invalid_response' };
        }
        // Older servers ignore the provider query.
        return provider ? models.filter(model => model.provider === provider) : models;
    };
    const entry = {
        expires: Infinity,
        promise: load().catch(error => {
            if (error instanceof TypeError) {
                throw { message: 'Failed to fetch model catalogue.', code: error.code ?? 'network_error' };
            }
            if (error instanceof SyntaxError) {
                throw { message: 'Invalid model catalogue response.', code: 'invalid_response' };
            }
            throw error;
        }),
    };
    cache.entries.delete(key);
    if (cache.entries.size >= MAX_CACHED_PROVIDERS) {
        cache.entries.delete(cache.entries.keys().next().value);
    }
    cache.entries.set(key, entry);
    try {
        const models = await entry.promise;
        entry.expires = Date.now() + MODEL_CACHE_MS;
        return structuredClone(models);
    } catch (error) {
        if (cache.entries.get(key) === entry) cache.entries.delete(key);
        throw error;
    }
}

/**
 * @overload
 * @returns {Promise<string[]>}
 */
/**
 * Returns the distinct providers of the available models.
 *
 * @this {import('./index.js').AIModule}
 * @returns {Promise<string[]>}
 */
export async function listModelProviders () {
    const models = await listModels.call(this);
    const providers = new Set();
    (models ?? []).forEach(item => {
        if ( item?.provider ) providers.add(item.provider);
    });
    return Array.from(providers);
}
