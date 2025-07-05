/* eslint-disable */
// TODO: Make these more compatible with eslint
window.aiTests = [
    testChatBasicPrompt = async function() {
        try {
            // Test basic string prompt with test mode enabled
            const result = await puter.ai.chat("Hello, how are you?");
            
            // Check that result is an object and not null
            assert(typeof result === 'object', "chat should return an object");
            assert(result !== null, "chat should not return null");
            
            // Check that the result has the expected structure
            assert(typeof result.message === 'object', "result should have a message object");
            assert(typeof result.message.content === 'string', "result.message should have content string");
            
            // Check that toString() and valueOf() methods exist and work
            assert(typeof result.toString === 'function', "result should have toString method");
            assert(typeof result.valueOf === 'function', "result should have valueOf method");
            
            // Check that toString() and valueOf() return the message content
            assert(result.toString() === result.message.content, "toString() should return message content");
            assert(result.valueOf() === result.message.content, "valueOf() should return message content");
            
            // In test mode, the content should be a test response
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
            assert(typeof result.message === 'object', "result should have a message object");
            assert(typeof result.message.content === 'string' || Array.isArray(result.message.content), "result.message should have content string or an array");
            
            // Check that the methods work
            assert(typeof result.toString === 'function', "result should have toString method");
            assert(typeof result.valueOf === 'function', "result should have valueOf method");
            
            pass("testChatWithParameters passed");
        } catch (error) {
            fail("testChatWithParameters failed:", error);
        }
    },
]; 