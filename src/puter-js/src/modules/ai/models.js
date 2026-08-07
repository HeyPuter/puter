import { fetchUrl } from '../../lib/networkUtils.js';

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

    const byProvider = (models) =>
        (provider ? models.filter(model => model.provider === provider) : models);

    const tryFetchModels = async () => {
        // `includePuterAuth` attaches the global instance's token.
        const resp = await fetchUrl(`${puter.APIOrigin }/puterai/chat/models/details`, {
            includePuterAuth: !! puter.authToken,
        });
        if ( ! resp.ok ) return null;
        const data = await resp.json();
        return byProvider(Array.isArray(data?.models) ? data.models : []);
    };

    const tryDriverModels = async () => {
        const models = /** @type {{ result?: unknown } | undefined} */ (
            await puter.drivers.call('puter-chat-completion', 'ai-chat', 'models')
        );
        return byProvider(Array.isArray(models?.result) ? models.result : []);
    };

    try {
        const apiModels = await tryFetchModels();
        if ( apiModels !== null ) return apiModels;
    } catch (e) {
        // Ignore and fall back to the driver call below.
    }
    try {
        return await tryDriverModels();
    } catch (e) {
        return [];
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
