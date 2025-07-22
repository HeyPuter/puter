export class GeminiToolsAdapter {
    static adapt_tools (tools) {
        return [
            {
                function_declarations: tools.map(t => {
                    const tool = t.function;
                    delete tool.parameters.additionalProperties;
                    return tool;
                })
            }
        ];
    }
}
