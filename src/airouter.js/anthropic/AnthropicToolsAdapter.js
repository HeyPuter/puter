export class AnthropicToolsAdapter {
    static adapt_tools (tools) {
        if ( ! tools ) return undefined;
        return tools.map(tool => {
            const { name, description, parameters } = tool.function;
            return {
                name,
                description,
                input_schema: parameters,
            };
        });
    }
}
