/* eslint-disable */
// TODO: Make these more compatible with eslint

// Define models to test. Every entry must resolve on the target backend —
// check /puterai/chat/models/details when one starts failing with
// "Model not found" (provider catalogs rotate, especially openrouter).
const TEST_MODELS = [
    "openrouter:openai/gpt-5.3-chat",
    "openrouter:anthropic/claude-opus-4.7-fast",
    "google/gemini-2.5-pro",
    "deepseek-chat",
    "gpt-5.1",
    "gpt-5-nano",
    "openai/gpt-5-nano",
    "claude-sonnet-5",
];

// Core test functions that can be reused across models
const testChatBasicPromptCore = async function(model) {
    // Test basic string prompt with test mode enabled
    const result = await puter.ai.chat("Hello, how are you?", { model: model });
    
    // Check that result is an object and not null
    assert(typeof result === 'object', "chat should return an object");
    assert(result !== null, "chat should not return null");
    
    // Check response structure
    assert(typeof result.message === 'object', "result should have message object");
    assert(typeof result.finish_reason === 'string', "result should have finish_reason string");
    
    // Check message structure
    assert(typeof result.message.role === 'string', "message should have role string");
    assert(result.message.role === 'assistant', "message role should be 'assistant'");
    assert(typeof result.message.content === 'string' || Array.isArray(result.message.content), "message should have content string or an array");

    // Check that toString() and valueOf() methods exist and work
    assert(typeof result.toString === 'function', "result should have toString method");
    assert(typeof result.valueOf === 'function', "result should have valueOf method");
    
    // Check that toString() and valueOf() return the message content
    assert(result.toString() === result.message.content, "toString() should return message content");
    assert(result.valueOf() === result.message.content, "valueOf() should return message content");
    
    // Content should not be empty
    assert(result.message.content.length > 0, "message content should not be empty");
};

const testChatWithParametersCore = async function(model) {
    // Test chat with parameters object.
    // - temperature 1 is the only value every model accepts (GPT-5-era
    //   models reject anything but the default).
    // - Reasoning models spend tokens thinking before emitting content, so
    //   the budget must leave room for actual output.
    // - reasoning/verbosity controls are OpenAI-reasoning-model-only.
    const options = {
        model: model,
        temperature: 1,
        max_tokens: 512,
    };
    if ( /gpt/i.test(model) && !/-chat/.test(model) ) {
        options.reasoning = { effort: 'low' };
        options.text = { verbosity: 'low' };
    }
    const result = await puter.ai.chat("What is 2+2?", options);
    
    // Check basic result structure
    assert(typeof result === 'object', "chat should return an object");
    assert(result !== null, "chat should not return null");
    assert(typeof result.message === 'object', "result should have message object");
    assert(typeof result.message.content === 'string' || Array.isArray(result.message.content), "result.message should have content string or an array");
    
    // Check that the methods work
    assert(typeof result.toString === 'function', "result should have toString method");
    assert(typeof result.valueOf === 'function', "result should have valueOf method");
    
    // Check that finish_reason is present and valid
    const validFinishReasons = ['stop', 'length', 'function_call', 'content_filter', 'tool_calls'];
    assert(validFinishReasons.includes(result.finish_reason), 
        `finish_reason should be one of: ${validFinishReasons.join(', ')}`);
    

};

const testChatWithMessageArrayCore = async function(model) {
    // Test chat with message array format
    const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" }
    ];
    const result = await puter.ai.chat(messages, { model: model });
    
    // Check basic structure
    assert(typeof result === 'object', "chat should return an object");
    assert(typeof result.message === 'object', "result should have message object");
    assert(result.message.role === 'assistant', "response should be from assistant");
    
    // Check that content is present and not empty
    assert(result.message.content.length > 0, "message content should not be empty");
};

const testChatStreamingCore = async function(model) {
    // Test chat with streaming enabled
    const result = await puter.ai.chat("Count from 1 to 5", { 
        model: model,
        stream: true,
        max_tokens: 100
    });
    
    // Check that result is an object and not null
    assert(typeof result === 'object', "streaming chat should return an object");
    assert(result !== null, "streaming chat should not return null");
    
    // For streaming, we need to check if it's an async iterator or has a different structure
    // The exact structure depends on the implementation, but we should verify it's consumable
    if (result[Symbol.asyncIterator]) {
        // If it's an async iterator, test that we can consume it
        let chunks = [];
        let chunkCount = 0;
        const maxChunks = 10; // Limit to prevent infinite loops in tests
        
        for await (const chunk of result) {
            chunks.push(chunk);
            chunkCount++;
            
            // Verify each chunk has expected structure
            assert(typeof chunk === 'object', "each streaming chunk should be an object");
            
            // Break after reasonable number of chunks for testing
            if (chunkCount >= maxChunks) break;
        }
        
        assert(chunks.length > 0, "streaming should produce at least one chunk");
        
    } else {
        // If not an async iterator, it might be a different streaming implementation
        // Check for common streaming response patterns
        
        // Check basic result structure (similar to non-streaming but may have different properties)
        assert(typeof result.message === 'object' || typeof result.content === 'string', 
            "streaming result should have message object or content string");
        
        // Check that it has streaming-specific properties
        assert(typeof result.stream === 'boolean' || result.stream === true, 
            "streaming result should indicate it's a stream");
        
        // Check that toString() and valueOf() methods exist and work
        assert(typeof result.toString === 'function', "streaming result should have toString method");
        assert(typeof result.valueOf === 'function', "streaming result should have valueOf method");
    }
};

const testChatCompactionCore = async function(model) {
    // Opting into inline compaction must not break a normal streamed response.
    // We can't reliably force the model to compact (needs a huge context), so
    // this asserts the opt-in streams cleanly and that any compaction chunk
    // that does appear carries a provider-independent encrypted_content.
    const result = await puter.ai.chat("Count from 1 to 5", {
        model: model,
        stream: true,
        max_tokens: 100,
        compaction: true,
    });

    assert(typeof result === 'object' && result !== null, "compaction chat should return an object");
    assert(typeof result[Symbol.asyncIterator] === 'function', "compaction chat should be streamable");

    let chunkCount = 0;
    let compaction = null;
    for await (const chunk of result) {
        assert(typeof chunk === 'object', "each streaming chunk should be an object");
        if (chunk.type === 'compaction') compaction = chunk;
        if (++chunkCount >= 10) break;
    }
    assert(chunkCount > 0, "compaction streaming should produce at least one chunk");

    if (compaction) {
        assert(typeof compaction.encrypted_content === 'string',
            "a compaction chunk should carry an encrypted_content string");

        // Round-trip: the artifact can be resent as a message item.
        const next = await puter.ai.chat([
            { role: 'user', content: 'continue' },
            compaction,
        ], { model: model });
        assert(typeof next === 'object' && next !== null, "resending a compaction item should succeed");
    }
};

// Function to generate test functions for a specific model
const generateTestsForModel = function(model) {
    const modelName = model.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize model name for function names
    
    return {
        [`testChatBasicPrompt_${modelName}`]: {
            name: `testChatBasicPrompt_${modelName}`,
            description: `Test basic AI chat prompt with ${model} model and verify response structure`,
            test: async function() {
                try {
                    await testChatBasicPromptCore(model);
                    pass(`testChatBasicPrompt_${modelName} passed`);
                } catch (error) {
                    fail(`testChatBasicPrompt_${modelName} failed:`, error);
                }
            }
        },
        
        [`testChatWithParameters_${modelName}`]: {
            name: `testChatWithParameters_${modelName}`,
            description: `Test AI chat with parameters (temperature, max_tokens) using ${model} model`,
            test: async function() {
                try {
                    await testChatWithParametersCore(model);
                    pass(`testChatWithParameters_${modelName} passed`);
                } catch (error) {
                    fail(`testChatWithParameters_${modelName} failed:`, error);
                }
            }
        },
        
        [`testChatWithMessageArray_${modelName}`]: {
            name: `testChatWithMessageArray_${modelName}`,
            description: `Test AI chat with message array format using ${model} model`,
            test: async function() {
                try {
                    await testChatWithMessageArrayCore(model);
                    pass(`testChatWithMessageArray_${modelName} passed`);
                } catch (error) {
                    fail(`testChatWithMessageArray_${modelName} failed:`, error);
                }
            }
        },
        
        [`testChatStreaming_${modelName}`]: {
            name: `testChatStreaming_${modelName}`,
            description: `Test AI chat with streaming enabled using ${model} model`,
            test: async function() {
                try {
                    await testChatStreamingCore(model);
                    pass(`testChatStreaming_${modelName} passed`);
                } catch (error) {
                    fail(`testChatStreaming_${modelName} failed:`, error);
                }
            }
        },

        [`testChatCompaction_${modelName}`]: {
            name: `testChatCompaction_${modelName}`,
            description: `Test AI chat inline compaction opt-in and round-trip using ${model} model`,
            test: async function() {
                try {
                    await testChatCompactionCore(model);
                    pass(`testChatCompaction_${modelName} passed`);
                } catch (error) {
                    fail(`testChatCompaction_${modelName} failed:`, error);
                }
            }
        },
    };
};

// Generate all test functions for all models
const generateAllTests = function() {
    const allTests = [];

    TEST_MODELS.forEach(model => {
        const modelTests = generateTestsForModel(model);
        Object.values(modelTests).forEach(test => {
            allTests.push(test);
        });
    });

    return allTests;
};

// -- Integration tests --
// One-off tests that exercise the documented call forms and the non-chat
// puter.ai methods end-to-end against real provider backends. Unlike the
// per-model tests above, each of these targets a specific known-good model.

const TEST_IMAGE_URL = "https://assets.puter.site/doge.jpeg";
// Direct-claude models are excluded: the claude provider is the one chat
// provider that doesn't infer the `type` on the SDK's `{ image_url }`
// media blocks, so the vision shorthand 400s against Anthropic today.
const VISION_MODELS = ["gpt-5-nano", "gemini-2.5-pro"];

// The test image is a Shiba Inu; any vision-capable model should say so.
const assertMentionsDog = function(result) {
    assert(typeof result.message === 'object', "result should have message object");
    const content = String(result);
    assert(content.length > 0, "vision response should not be empty");
    assert(/dog|shiba|doge|puppy|canine/i.test(content),
        `vision response should describe the dog, got: ${content.slice(0, 200)}`);
};

const testChatDefaultModelCore = async function() {
    // No options at all — the backend picks the default model.
    const result = await puter.ai.chat("Reply with the word: hello");
    assert(typeof result.message === 'object', "result should have message object");
    assert(result.message.role === 'assistant', "message role should be 'assistant'");
    assert(String(result).length > 0, "message content should not be empty");
};

const testChatTestModeCore = async function() {
    // chat(prompt, testMode) — no credits should be spent.
    const result = await puter.ai.chat("Hello, how are you?", true);
    assert(typeof result === 'object' && result !== null, "test-mode chat should return an object");
    assert(typeof result.message === 'object', "test-mode result should have message object");
};

const testChatTestModeThenOptionsCore = async function() {
    // Documented form with testMode BEFORE options:
    // chat(prompt, testMode, options)
    const result = await puter.ai.chat("Hello, how are you?", true, { model: "gpt-5-nano" });
    assert(typeof result === 'object' && result !== null, "chat(prompt, testMode, options) should return an object");
    assert(typeof result.message === 'object', "result should have message object");
};

const testChatVisionImageURLCore = async function(model) {
    // chat(prompt, mediaURL, options)
    const result = await puter.ai.chat("What animal is in this image?", TEST_IMAGE_URL, { model });
    assertMentionsDog(result);
};

const testChatVisionMediaArrayCore = async function(model) {
    // chat(prompt, [mediaURLs], options)
    const result = await puter.ai.chat("What animal do these images show?", [TEST_IMAGE_URL], { model });
    assertMentionsDog(result);
};

const testChatVisionFileCore = async function(model) {
    // chat(prompt, File, options) — exercises the File -> data URI path.
    const blob = await (await fetch(TEST_IMAGE_URL)).blob();
    const file = new File([blob], "doge.jpeg", { type: blob.type || "image/jpeg" });
    const result = await puter.ai.chat("What animal is in this image?", file, { model });
    assertMentionsDog(result);
};

const testChatFunctionCallingCore = async function(model) {
    const tools = [{
        type: "function",
        function: {
            name: "get_weather",
            description: "Get current weather for a location",
            parameters: {
                type: "object",
                properties: {
                    location: { type: "string", description: "City name" }
                },
                required: ["location"]
            }
        }
    }];

    const question = "What's the weather in Paris? You must use the get_weather tool.";
    const response = await puter.ai.chat(question, { model, tools });

    assert(Array.isArray(response.message.tool_calls), "model should request a tool call");
    assert(response.message.tool_calls.length > 0, "tool_calls should not be empty");

    const toolCall = response.message.tool_calls[0];
    assert(typeof toolCall.id === 'string', "tool call should have an id");
    assert(toolCall.function.name === 'get_weather', "tool call should target get_weather");
    const args = JSON.parse(toolCall.function.arguments);
    assert(/paris/i.test(args.location), `tool call should extract Paris, got: ${toolCall.function.arguments}`);

    // Round-trip the tool result and expect a grounded final answer.
    const finalResponse = await puter.ai.chat([
        { role: "user", content: question },
        response.message,
        { role: "tool", tool_call_id: toolCall.id, content: "Paris: 22°C, Sunny" }
    ], { model });
    const finalText = String(finalResponse);
    assert(finalText.length > 0, "final response should not be empty");
    assert(/22|sunny/i.test(finalText), `final response should use the tool result, got: ${finalText.slice(0, 200)}`);
};

const testListModelsCore = async function() {
    const models = await puter.ai.listModels();
    assert(Array.isArray(models), "listModels should return an array");
    assert(models.length > 0, "listModels should not be empty");
    assert(typeof models[0].id === 'string', "every model should have an id");
    assert(typeof models[0].provider === 'string', "every model should have a provider");

    const provider = models[0].provider;
    const filtered = await puter.ai.listModels(provider);
    assert(filtered.length > 0, "provider filter should keep that provider's models");
    assert(filtered.every(m => m.provider === provider),
        `listModels('${provider}') should only return that provider`);
};

const testListModelProvidersCore = async function() {
    const providers = await puter.ai.listModelProviders();
    assert(Array.isArray(providers), "listModelProviders should return an array");
    assert(providers.length > 0, "there should be at least one provider");
    assert(providers.every(p => typeof p === 'string' && p.length > 0), "providers should be non-empty strings");
    assert(new Set(providers).size === providers.length, "providers should be unique");
};

const testImg2TxtCanvasCore = async function() {
    // Render known text onto a canvas so the OCR assertion is deterministic
    // and self-contained (no external asset with text required).
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('HELLO PUTER', 40, 75);

    const text = await puter.ai.img2txt(canvas.toDataURL('image/png'));
    assert(typeof text === 'string', "img2txt should resolve to a string");
    assert(/HELLO/i.test(text) && /PUTER/i.test(text),
        `OCR should read the rendered text, got: ${text.slice(0, 200)}`);
};

const synthesizeSpeechDataUri = async function(phrase) {
    const audio = await puter.ai.txt2speech(phrase);
    assert(typeof audio.src === 'string' && audio.src.startsWith('data:'),
        "txt2speech should produce a data-URI audio src");
    // The TTS driver responds as a generic octet-stream, so the data URI
    // carries no audio MIME type and the STT provider rejects it as an
    // unsupported file. Relabel it with what Polly actually produced (MP3).
    return audio.src.replace(/^data:[^;,]*/, 'data:audio/mpeg');
};

const testSpeech2TxtRoundTripCore = async function() {
    // Full audio round trip across two real providers:
    // txt2speech (Polly) -> speech2txt (Whisper).
    const phrase = "The quick brown fox jumps over the lazy dog";
    const audioUri = await synthesizeSpeechDataUri(phrase);

    const result = await puter.ai.speech2txt(audioUri);
    const text = typeof result === 'string' ? result : result.text;
    assert(typeof text === 'string' && text.length > 0, "speech2txt should produce text");
    assert(/quick brown fox/i.test(text),
        `transcription should contain the spoken phrase, got: ${text.slice(0, 200)}`);
};

// -- Old-form vs new-form equivalence --
// Each test calls the same operation through a legacy call shape and the
// modern options shape and asserts the responses are structurally
// identical. Model output is nondeterministic, so chat responses are
// compared by a curated signature rather than by content.

const chatResponseSignature = function(result) {
    return {
        keys: Object.keys(result).filter(k => k !== 'toString' && k !== 'valueOf').sort(),
        role: result.message?.role,
        contentType: Array.isArray(result.message?.content) ? 'array' : typeof result.message?.content,
        finishReasonType: typeof result.finish_reason,
        usagePresent: result.usage !== undefined,
        viaMethods: typeof result.toString === 'function' && typeof result.valueOf === 'function',
    };
};

const assertSameSignature = function(a, b, label) {
    const sigA = JSON.stringify(a, null, 2);
    const sigB = JSON.stringify(b, null, 2);
    assert(sigA === sigB, `${label}: response shapes should match\n--- first form ---\n${sigA}\n--- second form ---\n${sigB}`);
};

const testChatEquivalencePromptVsMessagesCore = async function() {
    // chat(prompt, options) is documented shorthand for
    // chat([{ content: prompt }], options) — same wire request, so the
    // responses must come back with the same shape.
    const prompt = "Reply with the word: hello";
    const viaPrompt = await puter.ai.chat(prompt, { model: "gpt-5-nano" });
    const viaMessages = await puter.ai.chat([{ content: prompt }], { model: "gpt-5-nano" });
    assertSameSignature(
        chatResponseSignature(viaPrompt),
        chatResponseSignature(viaMessages),
        "chat(prompt) vs chat([messages])");
};

const testChatEquivalenceTestModePositionsCore = async function() {
    // The docs allow testMode before options and after; both orderings
    // must behave identically.
    const prompt = "Hello, how are you?";
    const flagFirst = await puter.ai.chat(prompt, true, { model: "gpt-5-nano" });
    const flagLast = await puter.ai.chat(prompt, { model: "gpt-5-nano" }, true);
    assertSameSignature(
        chatResponseSignature(flagFirst),
        chatResponseSignature(flagLast),
        "chat(prompt, testMode, options) vs chat(prompt, options, testMode)");
};

const testTxt2SpeechEquivalenceCore = async function() {
    // Legacy positional form vs the equivalent options object.
    const text = "Testing one two three";
    const positional = await puter.ai.txt2speech(text, "en-US", "Joanna", "standard");
    const options = await puter.ai.txt2speech(text, { language: "en-US", voice: "Joanna", engine: "standard" });

    for (const [label, audio] of [["positional", positional], ["options", options]]) {
        assert(typeof audio.src === 'string' && audio.src.startsWith('data:'),
            `${label} form should produce a data-URI audio src`);
        assert(audio.toString() === audio.src, `${label} form audio should stringify to its src`);
    }
    // Same synthesis parameters must yield the same audio format.
    assert(positional.src.split(',')[0] === options.src.split(',')[0],
        `both forms should return the same audio MIME prefix, got ${positional.src.split(',')[0]} vs ${options.src.split(',')[0]}`);
};

const testImg2TxtEquivalenceCore = async function() {
    // OCR on identical input is deterministic, so the shorthand source
    // form and the options form must return the same text.
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('SAME SHAPE', 40, 75);
    const dataUri = canvas.toDataURL('image/png');

    const viaSource = await puter.ai.img2txt(dataUri);
    const viaOptions = await puter.ai.img2txt({ source: dataUri });
    assert(viaSource === viaOptions,
        `img2txt(source) and img2txt({source}) should return identical text, got: ${JSON.stringify(viaSource)} vs ${JSON.stringify(viaOptions)}`);
};

const testSpeech2TxtEquivalenceCore = async function() {
    // speech2txt accepts the audio as a bare argument, as `file`, and as
    // the `audio` alias — all three must transcribe the same clip the
    // same way (compared loosely: same shape, phrase recovered by each).
    const phrase = "The quick brown fox";
    const audioUri = await synthesizeSpeechDataUri(phrase);

    const bare = await puter.ai.speech2txt(audioUri);
    const viaFile = await puter.ai.speech2txt({ file: audioUri });
    const viaAlias = await puter.ai.speech2txt({ audio: audioUri });

    const forms = [["bare", bare], ["{file}", viaFile], ["{audio} alias", viaAlias]];
    const shapes = forms.map(([label, result]) => {
        const text = typeof result === 'string' ? result : result.text;
        assert(typeof text === 'string' && text.length > 0, `${label} form should produce text`);
        assert(/quick brown fox/i.test(text), `${label} form should recover the phrase, got: ${text.slice(0, 200)}`);
        return typeof result === 'string' ? 'string' : Object.keys(result).sort().join(',');
    });
    assert(new Set(shapes).size === 1,
        `all speech2txt forms should return the same result shape, got: ${shapes.join(' | ')}`);
};

// Wrap a core function in the pass/fail reporting the harness expects.
const integrationTest = function(name, description, core) {
    return {
        name,
        description,
        test: async function() {
            try {
                await core();
                pass(`${name} passed`);
            } catch (error) {
                fail(`${name} failed:`, error);
            }
        }
    };
};

const generateIntegrationTests = function() {
    const tests = [
        integrationTest('testChatDefaultModel',
            'Integration: chat(prompt) with no options against the backend default model',
            testChatDefaultModelCore),
        integrationTest('testChatTestMode',
            'Integration: chat(prompt, testMode) legacy positional flag',
            testChatTestModeCore),
        integrationTest('testChatTestModeThenOptions',
            'Integration: chat(prompt, testMode, options) documented argument order',
            testChatTestModeThenOptionsCore),
        integrationTest('testChatFunctionCalling_gpt_5_nano',
            'Integration: full tool-call round trip (request, execute, respond) with gpt-5-nano',
            () => testChatFunctionCallingCore('gpt-5-nano')),
        integrationTest('testListModels',
            'Integration: listModels returns real models and honors the provider filter',
            testListModelsCore),
        integrationTest('testListModelProviders',
            'Integration: listModelProviders returns unique provider names',
            testListModelProvidersCore),
        integrationTest('testImg2TxtCanvas',
            'Integration: img2txt OCRs known text rendered onto a canvas',
            testImg2TxtCanvasCore),
        integrationTest('testSpeech2TxtRoundTrip',
            'Integration: txt2speech then speech2txt round trip recovers the phrase',
            testSpeech2TxtRoundTripCore),
        integrationTest('testChatEquivalence_promptVsMessages',
            'Equivalence: chat(prompt) shorthand and chat([messages]) return the same response shape',
            testChatEquivalencePromptVsMessagesCore),
        integrationTest('testChatEquivalence_testModePositions',
            'Equivalence: chat(prompt, testMode, options) and chat(prompt, options, testMode) behave identically',
            testChatEquivalenceTestModePositionsCore),
        integrationTest('testTxt2SpeechEquivalence_positionalVsOptions',
            'Equivalence: txt2speech legacy positional form and options form return the same audio format',
            testTxt2SpeechEquivalenceCore),
        integrationTest('testImg2TxtEquivalence_sourceVsOptions',
            'Equivalence: img2txt(source) and img2txt({source}) return identical OCR text',
            testImg2TxtEquivalenceCore),
        integrationTest('testSpeech2TxtEquivalence_audioAliases',
            'Equivalence: speech2txt bare, {file}, and {audio} alias forms return the same result shape',
            testSpeech2TxtEquivalenceCore),
    ];

    // Vision forms against one OpenAI and one Anthropic model.
    VISION_MODELS.forEach(model => {
        const modelName = model.replace(/[^a-zA-Z0-9]/g, '_');
        tests.push(integrationTest(`testChatVisionImageURL_${modelName}`,
            `Integration: chat(prompt, mediaURL, options) vision form with ${model}`,
            () => testChatVisionImageURLCore(model)));
        tests.push(integrationTest(`testChatVisionMediaArray_${modelName}`,
            `Integration: chat(prompt, [mediaURLs], options) vision form with ${model}`,
            () => testChatVisionMediaArrayCore(model)));
        tests.push(integrationTest(`testChatVisionFile_${modelName}`,
            `Integration: chat(prompt, File, options) converts the File to a data URI with ${model}`,
            () => testChatVisionFileCore(model)));
    });

    return tests;
};

// Export the generated tests
window.aiTests = [...generateAllTests(), ...generateIntegrationTests()];
