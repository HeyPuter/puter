/* eslint-disable */
// TODO: Make these more compatible with eslint

// Define models to test
const TEST_MODELS = [
    "openrouter:openai/gpt-4.1-mini",
    "openrouter:anthropic/claude-3.5-sonnet-20240620",
    "gpt-4o-mini",
    "claude-sonnet-4-latest",
    // Add more models as needed
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
        max_tokens: 50
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
    
    // Check that index is 0 (first/only response)
    assert(result.index === 0, "index should be 0 for single response");
};

// Function to generate test functions for a specific model
const generateTestsForModel = function(model) {
    const modelName = model.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize model name for function names
    
    return {
        [`testChatBasicPrompt_${modelName}`]: async function() {
            try {
                await testChatBasicPromptCore(model);
                pass(`testChatBasicPrompt_${modelName} passed`);
            } catch (error) {
                fail(`testChatBasicPrompt_${modelName} failed:`, error);
            }
        },
        
        [`testChatWithParameters_${modelName}`]: async function() {
            try {
                await testChatWithParametersCore(model);
                pass(`testChatWithParameters_${modelName} passed`);
            } catch (error) {
                fail(`testChatWithParameters_${modelName} failed:`, error);
            }
        },
        
        [`testChatWithMessageArray_${modelName}`]: async function() {
            try {
                await testChatWithMessageArrayCore(model);
                pass(`testChatWithMessageArray_${modelName} passed`);
            } catch (error) {
                fail(`testChatWithMessageArray_${modelName} failed:`, error);
            }
        },
    };
};

// Generate all test functions for all models
const generateAllTests = function() {
    const allTests = [];
    
    TEST_MODELS.forEach(model => {
        const modelTests = generateTestsForModel(model);
        Object.values(modelTests).forEach(testFunc => {
            allTests.push(testFunc);
        });
    });
    
    return allTests;
};

// Export the generated tests
window.aiTests = generateAllTests(); 