/** @typedef {import('./types.js').ToolSchema} ToolSchema */

/**
 * Answers one tool request from the parent app. An `executeTool` request always
 * gets a `toolResponse` back, with `error` set when the tool is unknown or
 * fails, so the parent's wait settles.
 *
 * @param {ToolSchema[]} tools
 * @param {{ postMessage: (message: unknown) => void }} parent
 * @param {unknown} event
 * @returns {Promise<void>}
 */
export async function handleToolRequest(tools, parent, event) {
    if (!event || typeof event !== 'object') return;
    const request = /** @type {Record<string, unknown>} */ (event);

    if (request.$ === 'requestTools') {
        console.log('Responding with tools');
        parent.postMessage({
            $: 'providedTools',
            tools: JSON.parse(JSON.stringify(tools)),
        });
        return;
    }
    if (request.$ !== 'executeTool') return;

    console.log('Executing tools');
    const fail = (message, code) => {
        parent.postMessage({
            $: 'toolResponse',
            tag: request.tag,
            error: { message, code },
        });
    };

    const tool = tools.find((t) => t?.function?.name === request.toolName);
    if (!tool) {
        fail(`Unknown tool: ${request.toolName}`, 'tool_not_found');
        return;
    }
    let response;
    try {
        response = await tool.exec(
            /** @type {Record<string, unknown>} */ (request.parameters),
        );
    } catch (e) {
        fail(e?.message ?? String(e), 'tool_failed');
        return;
    }
    try {
        parent.postMessage({ $: 'toolResponse', response, tag: request.tag });
    } catch (e) {
        // e.g. a result the structured clone can't copy
        fail(e?.message ?? String(e), 'tool_failed');
    }
}
