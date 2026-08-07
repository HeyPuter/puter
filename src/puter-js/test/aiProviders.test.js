/* eslint-disable */
// TODO: Make these more compatible with eslint
//
// Hand-run in the browser harness, against a server with real provider keys.
//
// Provider selection moved out of the SDK: puter.js dispatches every AI call
// to the unified driver (`ai-tts`, `ai-speech2txt`, `ai-ocr`,
// `ai-speech2speech`) and forwards `provider` as an argument for the driver to
// resolve, along with each provider's own defaults. These tests cover that
// routing end to end — the aliases callers may use, the rejection of names
// that aren't aliases, and the opt-in `provider: 'all'` listings.
//
// Each alias assertion tolerates a provider that isn't configured on the
// server being tested: what matters is that the driver reports back the
// *canonical* provider id, which is the proof the alias resolved server-side
// rather than being forwarded verbatim to an upstream.

// 1x1 transparent PNG / a 3-byte "audio" payload. Routing and validation both
// happen before either is handed to a provider.
const AI_PROV_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const AI_PROV_AUDIO = 'data:audio/mp3;base64,QUJD';

// Flatten whatever the SDK rejected with into searchable text.
const aiProvErrText = (error) => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    let text = error.message ? String(error.message) : '';
    if (error.code) text += ` ${error.code}`;
    try {
        text += ` ${JSON.stringify(error)}`;
    } catch (e) {}
    return text;
};

// Run `fn` expecting it to reject, and hand back the rejection as text.
// Deliberately does NOT call fail() on the success path — fail() throws, and
// throwing from inside a try whose catch reports a pass would swallow it.
const aiProvExpectReject = async (fn) => {
    let resolved = false;
    try {
        await fn();
        resolved = true;
    } catch (error) {
        return aiProvErrText(error);
    }
    if (resolved) throw new Error('expected the call to reject, but it resolved');
};

// Either the call succeeded (provider configured) or it failed for a reason
// other than an unrecognized provider name. Both prove the alias resolved.
const aiProvAssertResolved = async (label, canonical, fn) => {
    let text;
    try {
        await fn();
        return;
    } catch (error) {
        text = aiProvErrText(error);
    }
    assert(!/not found|Unknown .* provider/i.test(text) || text.includes(canonical),
        `${label} should resolve to "${canonical}", got: ${text}`);
};

window.aiProvidersTests = [
    {
        name: "testTTSDefaultProvider",
        description: "txt2speech with no provider uses the driver's default (AWS Polly) and its default voice",
        test: async function() {
            try {
                const result = await puter.ai.txt2speech("Testing the default provider.");
                assert(typeof result.src === 'string' && result.src.length > 0,
                    `default provider should return audio, got: ${JSON.stringify(result)}`);
                pass("testTTSDefaultProvider passed");
            } catch (error) {
                fail("testTTSDefaultProvider failed:", error);
            }
        }
    },

    {
        name: "testTTSProviderAliases",
        description: "txt2speech resolves provider aliases (11labs, eleven, simba, google, grok, polly) to canonical ids",
        test: async function() {
            try {
                const cases = [
                    ['11labs', 'elevenlabs'],
                    ['eleven', 'elevenlabs'],
                    ['simba', 'speechify'],
                    ['google', 'gemini'],
                    ['grok', 'xai'],
                    ['polly', 'aws-polly'],
                ];
                for (const [alias, canonical] of cases) {
                    await aiProvAssertResolved(`alias "${alias}"`, canonical,
                        () => puter.ai.txt2speech("Alias routing.", { provider: alias }));
                }
                pass("testTTSProviderAliases passed");
            } catch (error) {
                fail("testTTSProviderAliases failed:", error);
            }
        }
    },

    {
        name: "testTTSUnknownProviderRejects",
        description: "txt2speech rejects a provider that is not a known alias instead of silently falling back",
        test: async function() {
            try {
                const text = await aiProvExpectReject(
                    () => puter.ai.txt2speech("Nope.", { provider: 'not-a-real-tts-provider' }));
                assert(text.includes('not-a-real-tts-provider'),
                    `rejection should name the bad provider, got: ${text}`);
                pass("testTTSUnknownProviderRejects passed");
            } catch (error) {
                fail("testTTSUnknownProviderRejects failed:", error);
            }
        }
    },

    {
        name: "testTTSInvalidEngineRejects",
        description: "An invalid AWS Polly engine is rejected by the driver with invalid_engine (validation moved server-side)",
        test: async function() {
            try {
                const text = await aiProvExpectReject(
                    () => puter.ai.txt2speech("Bad engine.", { engine: 'definitely-not-an-engine' }));
                assert(/invalid_engine|Invalid engine/i.test(text),
                    `rejection should carry invalid_engine, got: ${text}`);
                pass("testTTSInvalidEngineRejects passed");
            } catch (error) {
                fail("testTTSInvalidEngineRejects failed:", error);
            }
        }
    },

    {
        name: "testTTSEngineNamingAProvider",
        description: "An `engine` that names a provider selects that provider rather than being treated as a Polly engine",
        test: async function() {
            try {
                // If `engine: 'openai'` were still treated as a Polly engine
                // this would come back as an invalid-engine error.
                await aiProvAssertResolved('engine "openai"', 'openai',
                    () => puter.ai.txt2speech("Engine names a provider.", { engine: 'openai' }));
                pass("testTTSEngineNamingAProvider passed");
            } catch (error) {
                fail("testTTSEngineNamingAProvider failed:", error);
            }
        }
    },

    {
        name: "testTTSListVoicesDefaultsToOneProvider",
        description: "listVoices() returns only the default provider's voices; aggregation is opt-in via provider 'all'",
        test: async function() {
            try {
                const voices = await puter.ai.txt2speech.listVoices();
                assert(Array.isArray(voices), "listVoices should resolve to an array");
                assert(voices.length > 0, "listVoices should return voices for the default provider");
                const providers = new Set(voices.map(v => v.provider));
                assert(providers.size === 1,
                    `listVoices() should not aggregate providers, saw: ${JSON.stringify([...providers])}`);
                pass("testTTSListVoicesDefaultsToOneProvider passed");
            } catch (error) {
                fail("testTTSListVoicesDefaultsToOneProvider failed:", error);
            }
        }
    },

    {
        name: "testTTSListVoicesAll",
        description: "listVoices({ provider: 'all' }) aggregates across every configured provider",
        test: async function() {
            try {
                const defaulted = await puter.ai.txt2speech.listVoices();
                const all = await puter.ai.txt2speech.listVoices({ provider: 'all' });
                assert(Array.isArray(all), "listVoices('all') should resolve to an array");
                assert(all.length >= defaulted.length,
                    `'all' should be a superset of the default provider (${all.length} vs ${defaulted.length})`);
                for (const voice of all) {
                    assert(typeof voice.provider === 'string',
                        `aggregated voices should be tagged with a provider, got: ${JSON.stringify(voice)}`);
                }
                pass("testTTSListVoicesAll passed");
            } catch (error) {
                fail("testTTSListVoicesAll failed:", error);
            }
        }
    },

    {
        name: "testTTSListEnginesAll",
        description: "listEngines({ provider: 'all' }) aggregates engines, and an unknown provider is rejected",
        test: async function() {
            try {
                const defaulted = await puter.ai.txt2speech.listEngines();
                const all = await puter.ai.txt2speech.listEngines({ provider: 'all' });
                assert(Array.isArray(all) && all.length >= defaulted.length,
                    `'all' should be a superset of the default provider (${all.length} vs ${defaulted.length})`);

                const text = await aiProvExpectReject(
                    () => puter.ai.txt2speech.listEngines({ provider: 'not-a-real-tts-provider' }));
                assert(text.includes('not-a-real-tts-provider'),
                    `rejection should name the bad provider, got: ${text}`);
                pass("testTTSListEnginesAll passed");
            } catch (error) {
                fail("testTTSListEnginesAll failed:", error);
            }
        }
    },

    {
        name: "testSTTProviderAliases",
        description: "speech2txt resolves the xai aliases (xai, grok, x-ai) and the whisper alias for openai",
        test: async function() {
            try {
                for (const alias of ['xai', 'grok', 'x-ai']) {
                    await aiProvAssertResolved(`alias "${alias}"`, 'xai',
                        () => puter.ai.speech2txt({ file: AI_PROV_AUDIO, provider: alias }));
                }
                await aiProvAssertResolved('alias "whisper"', 'openai',
                    () => puter.ai.speech2txt({ file: AI_PROV_AUDIO, provider: 'whisper' }));
                pass("testSTTProviderAliases passed");
            } catch (error) {
                fail("testSTTProviderAliases failed:", error);
            }
        }
    },

    {
        name: "testSTTUnknownProviderRejects",
        description: "speech2txt rejects a provider that is not a known alias",
        test: async function() {
            try {
                const text = await aiProvExpectReject(
                    () => puter.ai.speech2txt({ file: AI_PROV_AUDIO, provider: 'not-a-real-stt-provider' }));
                assert(text.includes('not-a-real-stt-provider'),
                    `rejection should name the bad provider, got: ${text}`);
                pass("testSTTUnknownProviderRejects passed");
            } catch (error) {
                fail("testSTTUnknownProviderRejects failed:", error);
            }
        }
    },

    {
        name: "testSTTListModels",
        description: "The speech2txt driver lists its providers, defaults list_models to one, and widens with provider 'all'",
        test: async function() {
            try {
                const providers = await puter.drivers.call('puter-speech2txt', 'list', {});
                assert(Array.isArray(providers), "list should resolve to an array");
                for (const expected of ['openai', 'xai']) {
                    assert(providers.includes(expected),
                        `provider list should include "${expected}", got: ${JSON.stringify(providers)}`);
                }

                const defaulted = await puter.drivers.call('puter-speech2txt', 'list_models', {});
                const defaultedIds = defaulted.map(m => m.id);
                assert(defaultedIds.includes('whisper-1'),
                    `default list_models should be the openai catalogue, got: ${JSON.stringify(defaultedIds)}`);
                assert(!defaultedIds.includes('xai-stt'),
                    "default list_models should not aggregate other providers");

                const all = await puter.drivers.call('puter-speech2txt', 'list_models', { provider: 'all' });
                const allIds = all.map(m => m.id);
                assert(allIds.includes('whisper-1') && allIds.includes('xai-stt'),
                    `provider 'all' should aggregate every catalogue, got: ${JSON.stringify(allIds)}`);

                const aliased = await puter.drivers.call('puter-speech2txt', 'list_models', { provider: 'grok' });
                assert(aliased.length === 1 && aliased[0].id === 'xai-stt',
                    `alias "grok" should list only the xai catalogue, got: ${JSON.stringify(aliased)}`);
                pass("testSTTListModels passed");
            } catch (error) {
                fail("testSTTListModels failed:", error);
            }
        }
    },

    {
        name: "testOCRProviderAliases",
        description: "img2txt resolves its provider aliases (aws, textract, mistral-ocr) to canonical ids",
        test: async function() {
            try {
                for (const [alias, canonical] of [['aws', 'aws-textract'], ['textract', 'aws-textract'], ['mistral-ocr', 'mistral']]) {
                    await aiProvAssertResolved(`alias "${alias}"`, canonical,
                        () => puter.ai.img2txt({ source: AI_PROV_PNG, provider: alias }));
                }
                pass("testOCRProviderAliases passed");
            } catch (error) {
                fail("testOCRProviderAliases failed:", error);
            }
        }
    },

    {
        name: "testOCRUnknownProviderRejects",
        description: "img2txt rejects an unknown provider instead of silently falling back to AWS Textract",
        test: async function() {
            try {
                const text = await aiProvExpectReject(
                    () => puter.ai.img2txt({ source: AI_PROV_PNG, provider: 'not-a-real-ocr-provider' }));
                assert(text.includes('not-a-real-ocr-provider'),
                    `rejection should name the bad provider, got: ${text}`);
                pass("testOCRUnknownProviderRejects passed");
            } catch (error) {
                fail("testOCRUnknownProviderRejects failed:", error);
            }
        }
    },

    {
        name: "testSpeech2SpeechProviderValidation",
        description: "speech2speech accepts elevenlabs and rejects any other provider name",
        test: async function() {
            try {
                await aiProvAssertResolved('provider "elevenlabs"', 'elevenlabs',
                    () => puter.ai.speech2speech({ audio: AI_PROV_AUDIO, provider: 'elevenlabs' }));
                const text = await aiProvExpectReject(
                    () => puter.ai.speech2speech({ audio: AI_PROV_AUDIO, provider: 'not-a-real-sts-provider' }));
                assert(text.includes('not-a-real-sts-provider'),
                    `rejection should name the bad provider, got: ${text}`);
                pass("testSpeech2SpeechProviderValidation passed");
            } catch (error) {
                fail("testSpeech2SpeechProviderValidation failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgFriendlyModelAliases",
        description: "The nano-banana model aliases are expanded by the image driver, not the SDK",
        test: async function() {
            try {
                for (const model of ['nano-banana', 'nano-banana-pro']) {
                    await aiProvAssertResolved(`model "${model}"`, model,
                        () => puter.ai.txt2img({ prompt: 'a single grey pixel', model, test_mode: true }));
                }
                pass("testTxt2ImgFriendlyModelAliases passed");
            } catch (error) {
                fail("testTxt2ImgFriendlyModelAliases failed:", error);
            }
        }
    },
];
