import { suite, type TestContext } from '../harness/types.ts';

/**
 * These tests run keyless: the backend always registers the fake-chat
 * provider (models `fake`, `costly`, `abuse`), so the whole SDK ↔ driver
 * plumbing — including streaming — is testable without provider keys.
 * Real-provider smoke tests are separate and capability-gated.
 */

/**
 * The `/puterai/*` wire routes still require a delegated credential, so
 * these tests authenticate the way a programmatic caller would — with the
 * full-access API token. (The drivers themselves also take a plain session
 * token; that path has its own test below.) The harness re-issues the
 * session token to shared SDK instances between tests, so no restore is
 * needed here.
 */
const useApiToken = (t: TestContext): void => {
    t.puter.setAuthToken(t.env.users.user.apiToken);
};

/**
 * Everything the routing tests below need to reach a driver. Neither is
 * ever sent upstream — the drivers either short-circuit on `test_mode` or
 * reject during provider resolution, both of which happen before any
 * provider credential is touched.
 */
const TINY_AUDIO = 'data:audio/mp3;base64,QUJD';
const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Flatten a rejection to text. SDK errors arrive in a few shapes (Error,
 * a plain `{ message, code }`, or the driver's serialized body), and these
 * tests assert on the *canonical provider name* the driver reports back —
 * which is what proves an alias was resolved server-side.
 */
const rejectionText = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
        await fn();
    } catch (e) {
        if (typeof e === 'string') return e;
        if (e instanceof Error) return `${e.message} ${JSON.stringify(e)}`;
        return JSON.stringify(e);
    }
    throw new Error('expected the call to reject, but it resolved');
};

/** Unwrap `puter.drivers.call`'s `{ success, result }` envelope. */
const resultOf = (resp: unknown): unknown =>
    (resp as { result?: unknown })?.result ?? resp;

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

    'a bare session token can call the AI driver': async (t) => {
        // No useApiToken here — privileged ("godmode") apps run on the
        // user's own account session token, so the driver has to accept
        // it. The `/puterai/*` wire routes still don't (see below).
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
        const body = JSON.stringify(await res.json());
        t.assert.equal(
            res.status,
            200,
            `session token should reach the driver, got ${res.status}: ${body}`,
        );
        t.assert.ok(
            !body.includes('app_or_api_token_required'),
            `session token must not be rejected by credential shape, got ${body}`,
        );
    },

    'a worker token can call the AI driver': async (t) => {
        // Workers are never treated as root tokens. This uses a REAL
        // user-scoped worker session token (minted the same way an
        // app-less worker deployment mints one), so the whole middleware
        // path is exercised: JWT → session row (kind='worker') → actor →
        // driver. Calling the driver's `models` method keeps this free of
        // any AI inference.
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

    // ── Unified driver routing ──────────────────────────────────────
    //
    // Provider selection and per-provider defaults live in the drivers,
    // not the SDK: puter.js always dispatches to the unified driver name
    // (`ai-speech2txt`, `ai-tts`, `ai-ocr`, `ai-speech2speech`) and
    // forwards `provider` as an argument. These tests stay keyless — they
    // assert routing, alias resolution and back-compat, never synthesis.

    'speech2txt routes to openai when no provider is named': async (t) => {
        useApiToken(t);
        const result = (await t.puter.ai.speech2txt({
            file: TINY_AUDIO,
            test_mode: true,
        })) as { model?: string };
        // The openai provider's documented transcription default.
        t.assert.equal(result.model, 'gpt-4o-mini-transcribe');
    },

    'speech2txt resolves every xai provider alias': async (t) => {
        useApiToken(t);
        for (const provider of ['xai', 'grok', 'x-ai']) {
            const result = (await t.puter.ai.speech2txt({
                file: TINY_AUDIO,
                provider,
                test_mode: true,
            })) as { model?: string };
            t.assert.equal(
                result.model,
                'xai-stt',
                `provider "${provider}" should reach the xai provider`,
            );
        }
    },

    'speech2txt keeps the whisper alias on openai': async (t) => {
        useApiToken(t);
        const result = (await t.puter.ai.speech2txt({
            file: TINY_AUDIO,
            provider: 'whisper',
            test_mode: true,
        })) as { model?: string };
        t.assert.equal(result.model, 'gpt-4o-mini-transcribe');
    },

    'speech2txt translate uses the openai translation default': async (t) => {
        useApiToken(t);
        const result = (await t.puter.ai.speech2txt({
            file: TINY_AUDIO,
            translate: true,
            test_mode: true,
        })) as { model?: string };
        t.assert.equal(result.model, 'whisper-1');
    },

    'speech2txt rejects an unknown provider': async (t) => {
        useApiToken(t);
        const text = await rejectionText(() =>
            t.puter.ai.speech2txt({
                file: TINY_AUDIO,
                provider: 'ai-suite-no-such-provider',
                test_mode: true,
            }),
        );
        t.assert.ok(
            text.includes('ai-suite-no-such-provider'),
            `rejection should name the bad provider, got ${text}`,
        );
    },

    'the speech2txt driver lists its configured providers': async (t) => {
        useApiToken(t);
        const providers = resultOf(
            await t.puter.drivers.call(
                'puter-speech2txt',
                'ai-speech2txt',
                'list',
                {},
            ),
        ) as string[];
        t.assert.ok(Array.isArray(providers), 'list should return an array');
        for (const expected of ['openai', 'xai']) {
            t.assert.ok(
                providers.includes(expected),
                `provider list should include "${expected}", got ${JSON.stringify(providers)}`,
            );
        }
    },

    'speech2txt list_models defaults to one provider and widens with all': async (t) => {
        useApiToken(t);
        const callList = async (args: Record<string, unknown>) =>
            resultOf(
                await t.puter.drivers.call(
                    'puter-speech2txt',
                    'ai-speech2txt',
                    'list_models',
                    args,
                ),
            ) as Array<{ id?: string; provider?: string }>;

        const defaulted = await callList({});
        const ids = defaulted.map((m) => m.id);
        t.assert.ok(
            ids.includes('whisper-1'),
            `default list should be the openai catalogue, got ${JSON.stringify(ids)}`,
        );
        t.assert.ok(
            !ids.includes('xai-stt'),
            'default list should not aggregate other providers',
        );

        const all = await callList({ provider: 'all' });
        const allIds = all.map((m) => m.id);
        t.assert.ok(
            allIds.includes('whisper-1') && allIds.includes('xai-stt'),
            `provider "all" should aggregate every catalogue, got ${JSON.stringify(allIds)}`,
        );
        for (const model of all) {
            t.assert.ok(
                typeof model.provider === 'string',
                `aggregated entries should be tagged with their provider, got ${JSON.stringify(model)}`,
            );
        }
    },

    'speech2txt list_models resolves a provider alias': async (t) => {
        useApiToken(t);
        const models = resultOf(
            await t.puter.drivers.call(
                'puter-speech2txt',
                'ai-speech2txt',
                'list_models',
                { provider: 'grok' },
            ),
        ) as Array<{ id?: string }>;
        t.assert.equal(models.length, 1);
        t.assert.equal(models[0]?.id, 'xai-stt');
    },

    'the legacy per-provider speech2txt driver names still route': async (t) => {
        // Bundles predating the unified driver put the provider in the wire
        // `driver` slot, and the driver aliases have to keep those working.
        // This goes over raw HTTP on purpose: `puter.drivers.call` accepts an
        // implementation argument but drops it before building the body, so
        // the current SDK cannot address a specific driver name at all.
        const callDriver = async (driver: string) => {
            const res = await fetch(`${t.env.apiOrigin}/drivers/call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${t.env.users.user.apiToken}`,
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({
                    interface: 'puter-speech2txt',
                    driver,
                    method: 'transcribe',
                    args: { file: TINY_AUDIO, test_mode: true },
                }),
            });
            const body = (await res.json()) as {
                result?: { model?: string };
            };
            t.assert.equal(
                res.status,
                200,
                `driver "${driver}" should resolve, got ${res.status}: ${JSON.stringify(body)}`,
            );
            return body.result?.model;
        };

        // Each legacy name has to land on its own provider, not just resolve
        // to the unified driver and fall through to the default.
        t.assert.equal(
            await callDriver('openai-speech2txt'),
            'gpt-4o-mini-transcribe',
        );
        t.assert.equal(await callDriver('xai-speech2txt'), 'xai-stt');
        // The canonical name is not a provider alias — it takes the default.
        t.assert.equal(
            await callDriver('ai-speech2txt'),
            'gpt-4o-mini-transcribe',
        );
    },

    'txt2speech rejects an unknown provider': async (t) => {
        useApiToken(t);
        const text = await rejectionText(() =>
            t.puter.ai.txt2speech('hi', { provider: 'ai-suite-no-such-tts' }),
        );
        t.assert.ok(
            text.includes('ai-suite-no-such-tts'),
            `rejection should name the bad provider, got ${text}`,
        );
    },

    'txt2speech resolves provider aliases to their canonical names': async (t) => {
        useApiToken(t);
        // Keyless, so the resolved provider isn't registered and the driver
        // reports it back by its canonical id — which is exactly the proof
        // that the alias resolved server-side rather than being forwarded
        // verbatim to an upstream.
        const cases: Array<[string, string]> = [
            ['11labs', 'elevenlabs'],
            ['eleven', 'elevenlabs'],
            ['simba', 'speechify'],
            ['google', 'gemini'],
            ['grok', 'xai'],
        ];
        for (const [alias, canonical] of cases) {
            const text = await rejectionText(() =>
                t.puter.ai.txt2speech('hi', { provider: alias }),
            );
            t.assert.ok(
                text.includes(canonical),
                `alias "${alias}" should resolve to "${canonical}", got ${text}`,
            );
        }
    },

    'txt2speech.listVoices rejects an unknown provider': async (t) => {
        useApiToken(t);
        const text = await rejectionText(() =>
            t.puter.ai.txt2speech.listVoices({
                provider: 'ai-suite-no-such-tts',
            }),
        );
        t.assert.ok(
            text.includes('ai-suite-no-such-tts'),
            `rejection should name the bad provider, got ${text}`,
        );
    },

    'txt2speech list methods accept the all provider': async (t) => {
        useApiToken(t);
        // Aggregation is now opt-in; the shape is what matters here since a
        // keyless server registers no TTS provider.
        const engines = await t.puter.ai.txt2speech.listEngines({
            provider: 'all',
        });
        t.assert.ok(Array.isArray(engines), 'listEngines should return an array');
        const voices = await t.puter.ai.txt2speech.listVoices({
            provider: 'all',
        });
        t.assert.ok(Array.isArray(voices), 'listVoices should return an array');
    },

    'img2txt test mode short-circuits before provider resolution': async (t) => {
        useApiToken(t);
        const text = await t.puter.ai.img2txt({
            source: TINY_PNG,
            test_mode: true,
        });
        t.assert.equal(typeof text, 'string');
    },

    'img2txt rejects an unknown provider': async (t) => {
        useApiToken(t);
        const text = await rejectionText(() =>
            t.puter.ai.img2txt({
                source: TINY_PNG,
                provider: 'ai-suite-no-such-ocr',
            }),
        );
        t.assert.ok(
            text.includes('ai-suite-no-such-ocr'),
            `rejection should name the bad provider, got ${text}`,
        );
    },

    'img2txt resolves its provider aliases': async (t) => {
        useApiToken(t);
        // Keyless: each alias resolves, then fails on the *resolved*
        // provider's missing credentials — never as "unknown provider".
        for (const alias of ['aws', 'textract', 'aws-textract', 'mistral', 'mistral-ocr']) {
            const text = await rejectionText(() =>
                t.puter.ai.img2txt({ source: TINY_PNG, provider: alias }),
            );
            t.assert.ok(
                !text.includes('Unknown OCR provider'),
                `alias "${alias}" should resolve to a known provider, got ${text}`,
            );
        }
    },

    'the legacy per-provider OCR driver names still route': async (t) => {
        useApiToken(t);
        for (const driver of ['aws-textract', 'mistral']) {
            const result = resultOf(
                await t.puter.drivers.call('puter-ocr', driver, 'recognize', {
                    source: TINY_PNG,
                    test_mode: true,
                }),
            );
            t.assert.ok(
                result,
                `driver "${driver}" should resolve to the unified OCR driver`,
            );
        }
    },

    'speech2speech accepts its one real provider': async (t) => {
        useApiToken(t);
        // `provider` now reaches the driver instead of being dropped by the
        // SDK, so the supported value has to survive validation. Keyless,
        // that means it fails on the missing ElevenLabs key — never as an
        // unknown provider.
        const text = await rejectionText(() =>
            t.puter.ai.speech2speech({
                audio: TINY_AUDIO,
                provider: 'elevenlabs',
            }),
        );
        t.assert.ok(
            !text.includes('provider not found'),
            `"elevenlabs" should pass provider validation, got ${text}`,
        );
    },

    'speech2speech rejects an unknown provider': async (t) => {
        useApiToken(t);
        // Naming a provider that doesn't exist must fail loudly rather
        // than quietly converting with the only one that does.
        const text = await rejectionText(() =>
            t.puter.ai.speech2speech({
                audio: TINY_AUDIO,
                provider: 'ai-suite-no-such-sts',
                test_mode: true,
            }),
        );
        t.assert.ok(
            text.includes('ai-suite-no-such-sts'),
            `rejection should name the bad provider, got ${text}`,
        );
    },
});
