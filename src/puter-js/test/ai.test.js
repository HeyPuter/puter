/* eslint-disable */
// TODO: Make these more compatible with eslint

// Define models to test
const TEST_MODELS = [
    "openrouter:openai/gpt-5-nano",
    "openrouter:anthropic/claude-sonnet-4",
    "google/gemini-2.5-pro",
    "deepseek-chat",
    "gpt-5.1",
    "gpt-5-nano",
    "openai/gpt-5-nano",
    "claude-sonnet-4-latest",
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
    assert(typeof result.via_ai_chat_service === 'boolean', "result should have via_ai_chat_service boolean");
    
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
    // Test chat with parameters object
    const result = await puter.ai.chat("What is 2+2?", { 
        model: model,
        temperature: 0.7,
        max_tokens: 50,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
    });
    
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
    
    // Check that via_ai_chat_service is true
    assert(result.via_ai_chat_service === true, "via_ai_chat_service should be true");
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

// Export the generated tests
window.aiTests = generateAllTests(); 
