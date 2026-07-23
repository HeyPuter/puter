import { suite, type TestContext } from '../harness/types.ts';

/**
 * These tests run keyless: the backend always registers the fake-chat
 * provider (models `fake`, `costly`, `abuse`), so the whole SDK ↔ driver
 * plumbing — including streaming — is testable without provider keys.
 * Real-provider smoke tests are separate and capability-gated.
 */

/**
 * The AI drivers reject bare session tokens (`noUserSession` driver meta):
 * programmatic AI callers must hold an app/worker token or a
 * dashboard-minted API token. Authenticate each AI test the way a real
 * caller would — with the full-access API token. The harness re-issues the
 * session token to shared SDK instances between tests, so no restore is
 * needed here.
 */
const useApiToken = (t: TestContext): void => {
    t.puter.setAuthToken(t.env.users.user.apiToken);
};

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
        useApiToken(t);
        const result = await t.puter.ai.chat('Hello there', {
            model: 'fake',
        });
        t.assert.ok(result.message, 'result should carry a message');
        t.assert.equal(result.message.role, 'assistant');
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat accepts a messages array': async (t) => {
        useApiToken(t);
        const result = await t.puter.ai.chat(
            [
                { role: 'system', content: 'You are a test fixture.' },
                { role: 'user', content: 'Say something.' },
            ],
            { model: 'fake' },
        );
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat accepts the vision form with a media argument': async (t) => {
        useApiToken(t);
        // 1x1 transparent PNG — a data URI keeps the test keyless and
        // avoids any backend media fetching.
        const pixel =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const result = await t.puter.ai.chat('What is in this image?', pixel, {
            model: 'fake',
        });
        t.assert.ok(result.message, 'vision form should carry a message');
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat accepts messages with content parts': async (t) => {
        useApiToken(t);
        const result = await t.puter.ai.chat(
            [
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'Describe the weather.' }],
                },
            ],
            { model: 'fake' },
        );
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat with stream true yields text parts': async (t) => {
        useApiToken(t);
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
        useApiToken(t);
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
        useApiToken(t);
        await t.assert.rejects(
            () =>
                t.puter.ai.chat('Hello', {
                    model: 'ai-suite-no-such-model',
                }),
            'unknown model should reject',
        );
    },

    'listModels hides the internal test models': async (t) => {
        useApiToken(t);
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
        useApiToken(t);
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
        useApiToken(t);
        const providers = await t.puter.ai.listModelProviders();
        t.assert.ok(Array.isArray(providers), 'should return an array');
        t.assert.ok(
            !providers.includes('fake-chat'),
            'the internal fake-chat provider should stay hidden',
        );
    },

    'every model reported by the driver carries an id': async (t) => {
        useApiToken(t);
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

    'a bare session token cannot call the AI driver': async (t) => {
        // No useApiToken here — the point is that the account session
        // ("root") token is rejected with guidance toward app/API tokens.
        const res = await fetch(`${t.env.apiOrigin}/drivers/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${t.env.users.user.token}`,
                Origin: t.env.apiOrigin,
            },
            body: JSON.stringify({
                interface: 'puter-chat-completion',
                method: 'complete',
                args: {
                    messages: [{ role: 'user', content: 'hi' }],
                    model: 'fake',
                },
            }),
        });
        t.assert.equal(res.status, 403, 'session token should be rejected');
        const body = JSON.stringify(await res.json());
        t.assert.ok(
            body.includes('app_or_api_token_required'),
            `rejection should carry app_or_api_token_required, got ${body}`,
        );
    },

    'a worker token passes the AI credential gate': async (t) => {
        // Workers are never treated as root tokens. This uses a REAL
        // user-scoped worker session token (minted the same way an
        // app-less worker deployment mints one), so the whole middleware
        // path is exercised: JWT → session row (kind='worker') → actor →
        // noUserSession gate. Calling the driver's `models` method keeps
        // this free of any AI inference — the gate rejects by credential
        // shape before the handler, so a 200 here proves admission.
        const res = await fetch(`${t.env.apiOrigin}/drivers/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${t.env.users.user.workerToken}`,
                Origin: t.env.apiOrigin,
            },
            body: JSON.stringify({
                interface: 'puter-chat-completion',
                method: 'models',
                args: {},
            }),
        });
        const body = JSON.stringify(await res.json());
        t.assert.ok(
            !body.includes('app_or_api_token_required'),
            `worker token must not be treated as a root token, got ${body}`,
        );
        t.assert.equal(
            res.status,
            200,
            `worker token should reach the driver, got ${res.status}: ${body}`,
        );
        t.assert.ok(
            body.includes('fake'),
            'the driver should answer the worker with its model list',
        );
    },

    'the OpenAI wire route rejects session tokens but accepts an API token': async (t) => {
        const call = (token: string) =>
            fetch(`${t.env.apiOrigin}/puterai/openai/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({
                    model: 'fake',
                    provider: 'fake-chat',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            });

        const sessionRes = await call(t.env.users.user.token);
        t.assert.equal(
            sessionRes.status,
            403,
            'the wire route should reject a session token',
        );
        const sessionBody = JSON.stringify(await sessionRes.json());
        t.assert.ok(
            sessionBody.includes('app_or_api_token_required'),
            `rejection should carry app_or_api_token_required, got ${sessionBody}`,
        );

        const apiRes = await call(t.env.users.user.apiToken);
        t.assert.equal(
            apiRes.status,
            200,
            `the wire route should accept the API token, got ${apiRes.status}: ${await apiRes
                .clone()
                .text()}`,
        );
    },
});
