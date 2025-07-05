/* eslint-disable */
// TODO: Make these more compatible with eslint
window.aiTests = [
    testChatBasicPrompt = async function() {
        try {
            // Test basic string prompt with test mode enabled
            const result = await puter.ai.chat("Hello, how are you?", { model: "openrouter:openai/gpt-4.1-mini" });
            
            // Check that result is an object and not null
            assert(typeof result === 'object', "chat should return an object");
            assert(result !== null, "chat should not return null");
            
            console.log('result', result);
            // Check response structure
            assert(typeof result.index === 'number', "result should have index number");
            assert(typeof result.message === 'object', "result should have message object");
            assert(typeof result.finish_reason === 'string', "result should have finish_reason string");
            assert(result.hasOwnProperty('logprobs'), "result should have logprobs property");
            assert(typeof result.via_ai_chat_service === 'boolean', "result should have via_ai_chat_service boolean");
            
            // Check message structure
            assert(typeof result.message.role === 'string', "message should have role string");
            assert(result.message.role === 'assistant', "message role should be 'assistant'");
            assert(typeof result.message.content === 'string', "message should have content string");
            assert(result.message.hasOwnProperty('refusal'), "message should have refusal property");

            // Check usage tracking
            if (result.usage) {
                assert(Array.isArray(result.usage), "usage should be an array");
                result.usage.forEach(usage => {
                    assert(typeof usage.type === 'string', "usage should have type string");
                    assert(typeof usage.model === 'string', "usage should have model string");
                    assert(typeof usage.amount === 'number', "usage should have amount number");
                    assert(typeof usage.cost === 'number', "usage should have cost number");
                });
            }
            
            // Check that toString() and valueOf() methods exist and work
            assert(typeof result.toString === 'function', "result should have toString method");
            assert(typeof result.valueOf === 'function', "result should have valueOf method");
            
            // Check that toString() and valueOf() return the message content
            assert(result.toString() === result.message.content, "toString() should return message content");
            assert(result.valueOf() === result.message.content, "valueOf() should return message content");
            
            // Content should not be empty
            assert(result.message.content.length > 0, "message content should not be empty");
            
            pass("testChatBasicPrompt passed");
        } catch (error) {
            fail("testChatBasicPrompt failed:", error);
        }
    },

    testChatWithParameters = async function() {
        try {
            // Test chat with parameters object
            const result = await puter.ai.chat("What is 2+2?", { 
                model: "openrouter:openai/gpt-4.1-mini",
                temperature: 0.7,
                max_tokens: 50
            });
            
            // Check basic result structure
            assert(typeof result === 'object', "chat should return an object");
            assert(result !== null, "chat should not return null");
            assert(typeof result.message === 'object', "result should have message object");
            assert(typeof result.message.content === 'string', "result.message should have content string");
            
            // Check that the methods work
            assert(typeof result.toString === 'function', "result should have toString method");
            assert(typeof result.valueOf === 'function', "result should have valueOf method");
            
            // Check that finish_reason is present and valid
            const validFinishReasons = ['stop', 'length', 'function_call', 'content_filter', 'tool_calls'];
            assert(validFinishReasons.includes(result.finish_reason), 
                `finish_reason should be one of: ${validFinishReasons.join(', ')}`);
            
            // Check that via_ai_chat_service is true
            assert(result.via_ai_chat_service === true, "via_ai_chat_service should be true");
            
            pass("testChatWithParameters passed");
        } catch (error) {
            fail("testChatWithParameters failed:", error);
        }
    },
    
    testChatWithMessageArray = async function() {
        try {
            // Test chat with message array format
            const messages = [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Hello!" }
            ];
            const result = await puter.ai.chat(messages);
            
            // Check basic structure
            assert(typeof result === 'object', "chat should return an object");
            assert(typeof result.message === 'object', "result should have message object");
            assert(result.message.role === 'assistant', "response should be from assistant");
            
            // Check that content is present and not empty
            assert(result.message.content.length > 0, "message content should not be empty");
            
            // Check that index is 0 (first/only response)
            assert(result.index === 0, "index should be 0 for single response");
            
            pass("testChatWithMessageArray passed");
        } catch (error) {
            fail("testChatWithMessageArray failed:", error);
        }
    },
    
    testChatUsageTracking = async function() {
        try {
            // Test that usage tracking works correctly
            const result = await puter.ai.chat("Count to 5");
            
            // Check usage tracking exists
            assert(result.usage, "result should have usage tracking");
            assert(Array.isArray(result.usage), "usage should be an array");
            assert(result.usage.length > 0, "usage array should not be empty");
            
            // Check for both prompt and completion usage
            const usageTypes = result.usage.map(u => u.type);
            assert(usageTypes.includes('prompt'), "usage should include prompt tracking");
            assert(usageTypes.includes('completion'), "usage should include completion tracking");
            
            // Check that costs are calculated
            result.usage.forEach(usage => {
                assert(usage.amount > 0, "usage amount should be greater than 0");
                assert(usage.cost >= 0, "usage cost should be non-negative");
                assert(typeof usage.model === 'string', "usage should track model used");
            });
            
            pass("testChatUsageTracking passed");
        } catch (error) {
            fail("testChatUsageTracking failed:", error);
        }
    },
]; 