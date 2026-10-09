import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleToolRequest } from './toolBridge.js';

const tool = (name, exec) => ({
    function: { name, description: name, parameters: {} },
    exec,
});

let parent;
beforeEach(() => {
    parent = { postMessage: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('handleToolRequest', () => {
    it('lists the tools', async () => {
        const tools = [tool('add', () => 3)];
        await handleToolRequest(tools, parent, { $: 'requestTools' });
        expect(parent.postMessage).toHaveBeenCalledWith({
            $: 'providedTools',
            tools: [{ function: tools[0].function }],
        });
    });

    it('answers with the tool result', async () => {
        const exec = vi.fn(async ({ a, b }) => a + b);
        await handleToolRequest([tool('add', exec)], parent, {
            $: 'executeTool',
            toolName: 'add',
            parameters: { a: 1, b: 2 },
            tag: 't1',
        });
        expect(parent.postMessage).toHaveBeenCalledWith({
            $: 'toolResponse',
            response: 3,
            tag: 't1',
        });
    });

    it('answers an unknown tool with an error', async () => {
        await handleToolRequest([tool('add', () => 3)], parent, {
            $: 'executeTool',
            toolName: 'missing',
            tag: 't2',
        });
        expect(parent.postMessage).toHaveBeenCalledWith({
            $: 'toolResponse',
            tag: 't2',
            error: { message: 'Unknown tool: missing', code: 'tool_not_found' },
        });
    });

    it('answers a failing tool with an error', async () => {
        const exec = () => {
            throw new Error('boom');
        };
        await handleToolRequest([tool('add', exec)], parent, {
            $: 'executeTool',
            toolName: 'add',
            tag: 't3',
        });
        expect(parent.postMessage).toHaveBeenCalledWith({
            $: 'toolResponse',
            tag: 't3',
            error: { message: 'boom', code: 'tool_failed' },
        });
    });

    it('answers with an error when the result cannot be posted', async () => {
        parent.postMessage.mockImplementationOnce(() => {
            throw new Error('could not be cloned');
        });
        await handleToolRequest([tool('add', () => () => {})], parent, {
            $: 'executeTool',
            toolName: 'add',
            tag: 't4',
        });
        expect(parent.postMessage).toHaveBeenLastCalledWith({
            $: 'toolResponse',
            tag: 't4',
            error: { message: 'could not be cloned', code: 'tool_failed' },
        });
    });

    it.each([null, undefined, 'text', { $: 'other' }])(
        'ignores %s',
        async (event) => {
            await handleToolRequest([], parent, event);
            expect(parent.postMessage).not.toHaveBeenCalled();
        },
    );
});
