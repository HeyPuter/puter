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
const TINY_MP4 = 'data:video/mp4;base64,QUJD';

/** The `{ message, code }` shape both client-side and driver rejections carry. */
type SdkError = { message?: string; code?: string };

const errorOf = async (
    t: TestContext,
    fn: () => Promise<unknown>,
): Promise<SdkError> => (await t.assert.rejects(fn)) as SdkError;

/**
 * A `data:` URI whose base64 payload decodes to one byte more than `maxBytes`.
 * The size guards read the length off the payload rather than decoding it, so
 * only the length and the `=` padding have to be right — `padding` picks which
 * of the three padding cases the guard has to account for.
 */
const oversizedDataUri = (
    mime: string,
    maxBytes: number,
    padding: 0 | 1 | 2,
): string => {
    let length = Math.ceil(((maxBytes + padding + 1) * 4) / 3);
    length += (4 - (length % 4)) % 4;
    const payload = 'A'.repeat(length - padding) + '='.repeat(padding);
    return `data:${mime};base64,${payload}`;
};

/** Token usage the `costly` fake model reports back. */
type Usage = { input_tokens?: number; output_tokens?: number };

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

        // In production this route also requires a paid plan; the test env
        // turns that gate off (see harness/capabilities.ts) so this stays a
        // test of the credential shape.
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

    // -- Message construction ----------------------------------------
    //
    // The `costly` fake model bills one input token per four characters of
    // message text, so its reported usage is a direct read-out of the
    // message array the SDK built from each call form.

    'chat bills the whole prompt through the costly model': async (t) => {
        useApiToken(t);
        const prompt = 'x'.repeat(400);
        const result = await t.puter.ai.chat(prompt, { model: 'costly' });
        const usage = result.usage as Usage;
        t.assert.equal(usage?.input_tokens, 100);
    },

    'chat bills every entry of a messages array': async (t) => {
        useApiToken(t);
        const prompt = 'x'.repeat(400);
        const result = await t.puter.ai.chat(
            [
                { role: 'user', content: prompt },
                { role: 'assistant', content: prompt },
            ],
            { model: 'costly' },
        );
        const usage = result.usage as Usage;
        t.assert.equal(
            usage?.input_tokens,
            200,
            'both messages should reach the driver',
        );
    },

    'chat keeps the prompt when media is attached': async (t) => {
        useApiToken(t);
        const prompt = 'x'.repeat(400);
        const single = await t.puter.ai.chat(prompt, TINY_MP4, {
            model: 'costly',
        });
        t.assert.equal(
            (single.usage as Usage)?.input_tokens,
            100,
            'a video media argument should not displace the prompt',
        );

        const many = await t.puter.ai.chat(prompt, [TINY_PNG, TINY_MP4], {
            model: 'costly',
        });
        t.assert.equal(
            (many.usage as Usage)?.input_tokens,
            100,
            'a mixed image/video media array should not displace the prompt',
        );
    },

    'chat forwards a zero max_tokens instead of dropping it': async (t) => {
        useApiToken(t);
        // The fake model clamps its output-token count to `max_tokens` and
        // otherwise picks a number well above 1, so these values only appear
        // when the option survived the SDK's option copying. A truthy check
        // would swallow the zero.
        const capped = await t.puter.ai.chat('count me', {
            model: 'costly',
            max_tokens: 1,
        });
        t.assert.equal((capped.usage as Usage)?.output_tokens, 1);

        const zero = await t.puter.ai.chat('count me', {
            model: 'costly',
            temperature: 0,
            max_tokens: 0,
        });
        t.assert.equal((zero.usage as Usage)?.output_tokens, 0);
    },

    'chat accepts a File as the media argument': async (t) => {
        useApiToken(t);
        // The File is converted to a data URI before the call. Off-browser
        // that conversion runs on the SDK's own FileReader stand-in, which
        // used to never settle — so reaching a response at all is the point.
        const file = new File([new Uint8Array([1, 2, 3])], 'pixel.png', {
            type: 'image/png',
        });
        const result = await t.puter.ai.chat('what is this', file, {
            model: 'fake',
        });
        t.assert.equal(result.message?.role, 'assistant');
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    'chat accepts an explicit non-streaming request': async (t) => {
        useApiToken(t);
        const result = await t.puter.ai.chat('no stream please', {
            model: 'fake',
            stream: false,
        });
        t.assert.equal(
            typeof (result as { [Symbol.asyncIterator]?: unknown })[
                Symbol.asyncIterator
            ],
            'undefined',
            'stream:false should resolve a buffered response, not an iterator',
        );
        t.assert.ok(textOf(result).length > 0, 'message should contain text');
    },

    // -- txt2img -----------------------------------------------------

    'txt2img forwards the model from either call form': async (t) => {
        useApiToken(t);
        // Keyless the model can never resolve, and the driver echoes back the
        // id it was asked for — which is what proves the SDK forwarded it.
        const positional = await errorOf(t, () =>
            t.puter.ai.txt2img('a red circle', { model: 'ai-suite-model' }),
        );
        t.assert.equal(positional.code, 'bad_request');
        t.assert.equal(positional.message, 'Model not found: ai-suite-model');

        const objectForm = await errorOf(t, () =>
            t.puter.ai.txt2img({
                prompt: 'a red circle',
                model: 'ai-suite-model',
            }),
        );
        t.assert.equal(objectForm.message, 'Model not found: ai-suite-model');
    },

    'txt2img sends the driver hint in the driver slot': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            t.puter.ai.txt2img({
                prompt: 'a red circle',
                driver: 'ai-suite-no-such-image-driver',
            }),
        );
        t.assert.equal(error.code, 'not_found');
        t.assert.equal(
            error.message,
            'Driver not found: puter-image-generation:ai-suite-no-such-image-driver',
        );
    },

    'txt2img resolves a relative output path against the caller': async (t) => {
        useApiToken(t);
        // The destination is authorized before any model work, so the two
        // outcomes below distinguish a resolved path from a raw one: an
        // unresolved `out.png` would land at the filesystem root and be
        // refused as such.
        const resolved = await errorOf(t, () =>
            t.puter.ai.txt2img({
                prompt: 'a red circle',
                puter_output_path: 'ai-suite-image-out.png',
            }),
        );
        t.assert.equal(
            resolved.message,
            'Missing `model`',
            'a relative path should be accepted as a writable destination',
        );

        const foreign = await errorOf(t, () =>
            t.puter.ai.txt2img({
                prompt: 'a red circle',
                puter_output_path: `/${t.env.users.other.username}/out.png`,
            }),
        );
        t.assert.equal(foreign.code, 'access_denied');
    },

    // -- txt2vid -----------------------------------------------------

    'txt2vid rejects a call with no prompt': async (t) => {
        useApiToken(t);
        for (const call of [
            () => t.puter.ai.txt2vid(),
            () => t.puter.ai.txt2vid({}),
            () => t.puter.ai.txt2vid({ seconds: 4 }),
        ]) {
            const error = await errorOf(t, call);
            t.assert.equal(error.code, 'prompt_required');
            t.assert.equal(error.message, 'Prompt parameter is required');
        }
    },

    'txt2vid takes duration as an alias of seconds': async (t) => {
        useApiToken(t);
        // `duration` has to be mapped before the request leaves the SDK; if
        // the alias threw or short-circuited we would see a client-side code
        // here rather than the keyless provider failure.
        const error = await errorOf(t, () =>
            t.puter.ai.txt2vid({ prompt: 'a cat', duration: 4 }),
        );
        t.assert.equal(error.code, 'internal_error');
    },

    'txt2vid resolves a relative output path against the caller': async (t) => {
        useApiToken(t);
        const resolved = await errorOf(t, () =>
            t.puter.ai.txt2vid({
                prompt: 'a cat',
                puter_output_path: 'ai-suite-video-out.mp4',
            }),
        );
        t.assert.equal(
            resolved.code,
            'internal_error',
            'a relative path should be accepted as a writable destination',
        );

        const foreign = await errorOf(t, () =>
            t.puter.ai.txt2vid({
                prompt: 'a cat',
                puter_output_path: `/${t.env.users.other.username}/out.mp4`,
            }),
        );
        t.assert.equal(foreign.code, 'access_denied');
    },

    // -- txt2speech --------------------------------------------------

    'txt2speech rejects a call with no text': async (t) => {
        useApiToken(t);
        for (const call of [
            () => t.puter.ai.txt2speech(''),
            () => t.puter.ai.txt2speech('', { voice: 'Joanna' }),
        ]) {
            const error = await errorOf(t, call);
            t.assert.equal(error.code, 'text_required');
            t.assert.equal(error.message, 'Text parameter is required');
        }
    },

    'txt2speech rejects text past the input limit': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            t.puter.ai.txt2speech('a'.repeat(3001)),
        );
        t.assert.equal(error.code, 'input_too_large');
        t.assert.equal(error.message, 'Input size cannot be larger than 3000');

        // The boundary itself is allowed through to the driver, which fails
        // on the missing provider rather than on the input size.
        const atLimit = await errorOf(t, () =>
            t.puter.ai.txt2speech('a'.repeat(3000)),
        );
        t.assert.ok(
            atLimit.code !== 'input_too_large',
            `3000 characters should be accepted, got ${atLimit.code}`,
        );
    },

    'txt2speech rejects a second argument that is neither options nor a language': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            (t.puter.ai.txt2speech as (...args: unknown[]) => Promise<unknown>)(
                'hi',
                42,
            ),
        );
        t.assert.equal(error.code, 'invalid_arguments');
    },

    'txt2speech routes the engine from either call form': async (t) => {
        useApiToken(t);
        // The engine names a provider, so the driver reports the provider it
        // resolved to — proving the legacy positional slot still reaches it.
        const positional = await errorOf(t, () =>
            t.puter.ai.txt2speech('hi', 'en-US', 'Rachel', 'elevenlabs'),
        );
        const objectForm = await errorOf(t, () =>
            t.puter.ai.txt2speech('hi', { engine: 'elevenlabs' }),
        );
        for (const error of [positional, objectForm]) {
            t.assert.equal(error.code, 'bad_request');
            t.assert.ok(
                (error.message ?? '').includes('elevenlabs'),
                `the engine should reach the driver, got ${error.message}`,
            );
        }
    },

    'the txt2speech list methods read a bare string differently': async (t) => {
        useApiToken(t);
        // `listEngines` takes a provider, `listVoices` an engine — the same
        // string has to land in different slots.
        const error = await errorOf(t, () =>
            t.puter.ai.txt2speech.listEngines('ai-suite-no-such-tts'),
        );
        t.assert.ok(
            (error.message ?? '').includes('ai-suite-no-such-tts'),
            `listEngines should treat the string as a provider, got ${error.message}`,
        );

        const voices = await t.puter.ai.txt2speech.listVoices(
            'ai-suite-no-such-engine',
        );
        t.assert.ok(
            Array.isArray(voices),
            'listVoices should treat the string as an engine, not a provider',
        );
    },

    // -- img2txt -----------------------------------------------------

    'img2txt rejects a call with no arguments': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.img2txt());
        t.assert.equal(error.code, 'arguments_required');
        t.assert.equal(error.message, 'Arguments are required');
    },

    'img2txt rejects options with no source': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.img2txt({}));
        t.assert.equal(error.code, 'source_required');
        t.assert.equal(error.message, 'Source is required');
    },

    'img2txt honors the positional test-mode flag': async (t) => {
        useApiToken(t);
        // Keyless there is no OCR provider, so a reply at all proves the flag
        // reached the driver instead of a real (billed) recognition running.
        const text = await t.puter.ai.img2txt(TINY_PNG, true);
        t.assert.ok(
            text.includes('sample OCR response'),
            `positional test mode should short-circuit, got ${text}`,
        );
    },

    'img2txt honors testMode from the options object': async (t) => {
        useApiToken(t);
        const text = await t.puter.ai.img2txt({
            source: TINY_PNG,
            testMode: true,
        });
        t.assert.ok(text.includes('sample OCR response'));
    },

    'img2txt converts a Blob source to a data URI': async (t) => {
        useApiToken(t);
        const blob = new Blob([new Uint8Array([1, 2, 3])], {
            type: 'image/png',
        });
        const text = await t.puter.ai.img2txt(blob, true);
        t.assert.ok(text.includes('sample OCR response'));
    },

    'img2txt accepts a File nested under source': async (t) => {
        useApiToken(t);
        const file = new File([new Uint8Array([4, 5, 6])], 'scan.png', {
            type: 'image/png',
        });
        const text = await t.puter.ai.img2txt(
            { source: { source: file } } as unknown as { source: File },
            true,
        );
        t.assert.ok(text.includes('sample OCR response'));
    },

    'img2txt rejects a source past the input limit': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            t.puter.ai.img2txt(
                oversizedDataUri('image/png', 10 * 1024 * 1024, 2),
            ),
        );
        t.assert.equal(error.code, 'input_too_large');
        t.assert.equal(
            error.message,
            `Input size cannot be larger than ${10 * 1024 * 1024}`,
        );
    },

    // -- speech2txt --------------------------------------------------

    'speech2txt rejects a call with no arguments': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.speech2txt());
        t.assert.equal(error.code, 'arguments_required');
    },

    'speech2txt rejects options with no audio': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.speech2txt({}));
        t.assert.equal(error.code, 'audio_required');
        t.assert.equal(error.message, 'Audio input is required');
    },

    'speech2txt honors the positional test-mode flag': async (t) => {
        useApiToken(t);
        const result = (await t.puter.ai.speech2txt(
            TINY_AUDIO,
            true,
        )) as { text?: string };
        t.assert.ok(
            (result.text ?? '').includes('sample transcription'),
            `positional test mode should short-circuit, got ${JSON.stringify(result)}`,
        );
    },

    'speech2txt takes audio as an alias of file': async (t) => {
        useApiToken(t);
        const result = (await t.puter.ai.speech2txt({
            audio: TINY_AUDIO,
            test_mode: true,
        })) as { text?: string };
        t.assert.ok((result.text ?? '').includes('sample transcription'));
    },

    'speech2txt converts a Blob audio input': async (t) => {
        useApiToken(t);
        const blob = new Blob([new Uint8Array([7, 8, 9])], {
            type: 'audio/mpeg',
        });
        const result = (await t.puter.ai.speech2txt(blob, {
            test_mode: true,
        })) as { text?: string };
        t.assert.ok((result.text ?? '').includes('sample transcription'));
    },

    'speech2txt unwraps the bare text for response_format text': async (t) => {
        useApiToken(t);
        const text = await t.puter.ai.speech2txt({
            file: TINY_AUDIO,
            test_mode: true,
            response_format: 'text',
        });
        t.assert.equal(typeof text, 'string');
        t.assert.ok((text as string).includes('sample transcription'));
    },

    'speech2txt rejects audio past the input limit': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            t.puter.ai.speech2txt(
                oversizedDataUri('audio/mpeg', 25 * 1024 * 1024, 1),
            ),
        );
        t.assert.equal(error.code, 'input_too_large');
        t.assert.equal(error.message, 'Input size cannot be larger than 25 MB');
    },

    // -- speech2speech -----------------------------------------------

    'speech2speech rejects a call with no arguments': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.speech2speech());
        t.assert.equal(error.code, 'arguments_required');
    },

    'speech2speech rejects options with no audio': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () => t.puter.ai.speech2speech({}));
        t.assert.equal(error.code, 'audio_required');
    },

    'speech2speech resolves the sample conversion to an audio element': async (t) => {
        useApiToken(t);
        // The driver answers test mode with a hosted asset rather than bytes;
        // the audio element has to carry that URL on `src` and stringify to it.
        const audio = await t.puter.ai.speech2speech({
            audio: TINY_AUDIO,
            test_mode: true,
        });
        t.assert.ok(
            audio.src.startsWith('https://'),
            `expected a hosted sample URL, got ${audio.src}`,
        );
        t.assert.equal(String(audio), audio.src);
    },

    'speech2speech honors the positional test-mode flag': async (t) => {
        useApiToken(t);
        const audio = await t.puter.ai.speech2speech(TINY_AUDIO, true);
        t.assert.ok(
            audio.src.startsWith('https://'),
            `positional test mode should short-circuit, got ${audio.src}`,
        );
    },

    'speech2speech takes file as an alias of audio': async (t) => {
        useApiToken(t);
        const audio = await t.puter.ai.speech2speech({
            file: TINY_AUDIO,
            test_mode: true,
        });
        t.assert.ok(audio.src.startsWith('https://'));
    },

    'speech2speech accepts a Blob audio input': async (t) => {
        useApiToken(t);
        const blob = new Blob([new Uint8Array([1, 2, 3])], {
            type: 'audio/mpeg',
        });
        const audio = await t.puter.ai.speech2speech(blob, {
            test_mode: true,
        });
        t.assert.ok(audio.src.startsWith('https://'));
    },

    'speech2speech accepts the camelCase option aliases': async (t) => {
        useApiToken(t);
        const audio = await t.puter.ai.speech2speech({
            audio: TINY_AUDIO,
            voiceId: 'ai-suite-voice',
            modelId: 'ai-suite-model',
            outputFormat: 'mp3_44100_128',
            fileFormat: 'mp3',
            voiceSettings: { stability: 0.5 },
            removeBackgroundNoise: false,
            optimizeStreamingLatency: 0,
            enableLogging: false,
            test_mode: true,
        });
        t.assert.ok(audio.src.startsWith('https://'));
    },

    'speech2speech rejects audio past the input limit': async (t) => {
        useApiToken(t);
        const error = await errorOf(t, () =>
            t.puter.ai.speech2speech(
                oversizedDataUri('audio/mpeg', 25 * 1024 * 1024, 0),
            ),
        );
        t.assert.equal(error.code, 'input_too_large');
        t.assert.equal(error.message, 'Input size cannot be larger than 25 MB');
    },
});
