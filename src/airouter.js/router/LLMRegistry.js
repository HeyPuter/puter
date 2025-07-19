export class LLMRegistry {
    apiTypes = {}
    
    /**
     * Add configuration for an LLM provider
     * @param {Object} params
     * @param {string} apiType determienes SDK and coercions used
     * @param {string} [id] identifier, defaults to random uuid
     */
    link ({
        id,
        apiType,
        config,
    }) {}
    
    /**
     * Add a type of LLM provider (an API format)
     */
    registerApiType (name, apiType) {
        this.apiTypes[name] = apiType;
    }
}
