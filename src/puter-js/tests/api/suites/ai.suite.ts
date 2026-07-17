import { suite } from '../harness/types.ts';

/**
 * These tests run keyless: the backend always registers the fake-chat
 * provider (models `fake`, `costly`, `abuse`), so the whole SDK ↔ driver
 * plumbing — including streaming — is testable without provider keys.
 * Real-provider smoke tests are separate and capability-gated.
 */

const textOf = (result: {
    message?: { content?: unknown };
}): string => {
    const content = result?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) =>
                typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''),
            )
            .join('');
    }
    return '';
};

export default suite('ai', {
    'chat with the fake model returns a message': async (t) => {
        const result = await t.puter.ai.chat('Hello there', {
            model: 'fake',
        });
        t.assert.ok(result.message, 'result should carry a message');
        t.assert.equal(result.message.role, 'assistant');
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat accepts a messages array': async (t) => {
        const result = await t.puter.ai.chat(
            [
                { role: 'system', content: 'You are a test fixture.' },
                { role: 'user', content: 'Say something.' },
            ],
            { model: 'fake' },
        );
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat with stream true yields text parts': async (t) => {
        const stream = await t.puter.ai.chat('Stream this', {
            model: 'fake',
            stream: true,
        });
        let text = '';
        for await (const part of stream as AsyncIterable<{ text?: string }>) {
            if (part?.text) text += part.text;
        }
        t.assert.ok(text.length > 0, 'streamed parts should contain text');
    },

    'chat with the costly model reports token usage': async (t) => {
        const result = await t.puter.ai.chat(
            'Count the tokens of this prompt please',
            { model: 'costly' },
        );
        const usage = result.usage as
            | { input_tokens?: number; output_tokens?: number }
            | undefined;
        t.assert.ok(usage, 'result should carry usage');
        t.assert.ok(
            (usage?.input_tokens ?? 0) > 0,
            'costly model should report input tokens',
        );
        t.assert.ok(
            (usage?.output_tokens ?? 0) > 0,
            'costly model should report output tokens',
        );
    },

    'chat with an unknown model rejects': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.ai.chat('Hello', {
                    model: 'ai-suite-no-such-model',
                }),
            'unknown model should reject',
        );
    },

    'listModels hides the internal test models': async (t) => {
        // The public models endpoint deliberately filters fake/costly/abuse.
        const models = await t.puter.ai.listModels();
        t.assert.ok(Array.isArray(models), 'listModels should return an array');
        const ids = models.map((m: { id?: string }) => m.id);
        for (const hidden of ['fake', 'costly', 'abuse']) {
            t.assert.ok(
                !ids.includes(hidden),
                `public model list should not expose "${hidden}"`,
            );
        }
    },

    'the models driver method reports the fake models': async (t) => {
        const resp = await t.puter.drivers.call(
            'puter-chat-completion',
            'ai-chat',
            'models',
            {},
        );
        const ids = JSON.stringify(resp.result ?? resp);
        t.assert.ok(
            ids.includes('fake'),
            'driver-level model list should include the fake model',
        );
    },

    'listModelProviders returns an array without fake-chat': async (t) => {
        const providers = await t.puter.ai.listModelProviders();
        t.assert.ok(Array.isArray(providers), 'should return an array');
        t.assert.ok(
            !providers.includes('fake-chat'),
            'the internal fake-chat provider should stay hidden',
        );
    },

    'every model reported by the driver carries an id': async (t) => {
        // The public listModels endpoint is empty without provider keys, so
        // assert the shape against the driver-level list (always populated
        // with the fake models).
        const resp = await t.puter.drivers.call(
            'puter-chat-completion',
            'ai-chat',
            'models',
            {},
        );
        const models = (resp.result ?? resp) as Array<{ id?: string }>;
        t.assert.ok(Array.isArray(models), 'driver models should be an array');
        t.assert.ok(models.length > 0, 'driver should report models');
        for (const model of models) {
            t.assert.equal(
                typeof model.id,
                'string',
                `every model entry should expose an id, got ${JSON.stringify(model)}`,
            );
        }
    },
});
