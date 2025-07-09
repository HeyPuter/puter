/* eslint-disable */
// TODO: Make these more compatible with eslint

// Core test functions for txt2speech functionality
const testTxt2SpeechBasicCore = async function() {
    // Test basic text-to-speech with simple text
    const result = await puter.ai.txt2speech("Hello, this is a test message.");
    
    // Check that result is an Audio object
    assert(result instanceof Audio, "txt2speech should return an Audio object");
    assert(result !== null, "txt2speech should not return null");
    
    // Check that Audio object has proper methods
    assert(typeof result.play === 'function', "result should have play method");
    assert(typeof result.pause === 'function', "result should have pause method");
    assert(typeof result.toString === 'function', "result should have toString method");
    assert(typeof result.valueOf === 'function', "result should have valueOf method");
    
    // Get the actual values to debug
    const toStringValue = result.toString();
    const valueOfValue = result.valueOf();
    const srcValue = result.src;
    
    // Check that toString() and valueOf() return strings
    assert(typeof toStringValue === 'string', `toString() should return a string, got: ${typeof toStringValue} with value: ${toStringValue}`);
    assert(typeof valueOfValue === 'string', `valueOf() should return a string, got: ${typeof valueOfValue} with value: ${valueOfValue}`);
    
    // Check that the URL is valid (could be blob: or data: or http:)
    assert(toStringValue.length > 0, "toString() should not return empty string");
    assert(valueOfValue.length > 0, "valueOf() should not return empty string");
    
    // Check that it's a valid URL format (blob:, data:, http:, or https:)
    const isValidUrl = toStringValue.startsWith('blob:') || 
                       toStringValue.startsWith('data:') || 
                       toStringValue.startsWith('http:') || 
                       toStringValue.startsWith('https:');
    assert(isValidUrl, `toString() should return a valid URL, got: ${toStringValue}`);
    
    // Check that src is set and is a valid URL
    assert(typeof srcValue === 'string', "result should have src property as string");
    assert(srcValue.length > 0, "src should not be empty");
    
    // Verify toString() and valueOf() return the same value as src
    assert(toStringValue === srcValue, `toString() should return the same as src. toString(): ${toStringValue}, src: ${srcValue}`);
    assert(valueOfValue === srcValue, `valueOf() should return the same as src. valueOf(): ${valueOfValue}, src: ${srcValue}`);
};

const testTxt2SpeechWithParametersCore = async function() {
    // Test text-to-speech with language and voice parameters
    const result = await puter.ai.txt2speech("Hello, this is a test with parameters.", "en-US", "Brian");
    
    // Check that result is an Audio object
    assert(result instanceof Audio, "txt2speech should return an Audio object");
    assert(result !== null, "txt2speech should not return null");
    
    // Check that Audio object has proper methods
    assert(typeof result.play === 'function', "result should have play method");
    assert(typeof result.pause === 'function', "result should have pause method");
    assert(typeof result.toString === 'function', "result should have toString method");
    assert(typeof result.valueOf === 'function', "result should have valueOf method");
    
    // Get the actual values to debug
    const toStringValue = result.toString();
    const valueOfValue = result.valueOf();
    const srcValue = result.src;
    
    // Check that toString() and valueOf() return strings
    assert(typeof toStringValue === 'string', `toString() should return a string, got: ${typeof toStringValue} with value: ${toStringValue}`);
    assert(typeof valueOfValue === 'string', `valueOf() should return a string, got: ${typeof valueOfValue} with value: ${valueOfValue}`);
    
    // Check that the URL is valid (could be blob: or data: or http:)
    assert(toStringValue.length > 0, "toString() should not return empty string");
    assert(valueOfValue.length > 0, "valueOf() should not return empty string");
    
    // Check that it's a valid URL format
    const isValidUrl = toStringValue.startsWith('blob:') || 
                       toStringValue.startsWith('data:') || 
                       toStringValue.startsWith('http:') || 
                       toStringValue.startsWith('https:');
    assert(isValidUrl, `toString() should return a valid URL, got: ${toStringValue}`);
    
    // Check that src is set and is a valid URL
    assert(typeof srcValue === 'string', "result should have src property as string");
    assert(srcValue.length > 0, "src should not be empty");
    
    // Verify toString() and valueOf() return the same value as src
    assert(toStringValue === srcValue, `toString() should return the same as src. toString(): ${toStringValue}, src: ${srcValue}`);
    assert(valueOfValue === srcValue, `valueOf() should return the same as src. valueOf(): ${valueOfValue}, src: ${srcValue}`);
    
    // Verify that different parameters produce different audio (comparing with basic call)
    const basicResult = await puter.ai.txt2speech("Hello, this is a test with parameters.");
    assert(result.src !== basicResult.src, "different parameters should produce different audio URLs");
};

const testTxt2SpeechWithTestModeCore = async function() {
    // Test text-to-speech with testMode enabled
    const result = await puter.ai.txt2speech("Hello, this is a test message.", "en-US", true);
    
    // Check that result is an Audio object (same structure in test mode)
    assert(result instanceof Audio, "txt2speech should return an Audio object in test mode");
    assert(result !== null, "txt2speech should not return null in test mode");
    
    // Check that Audio object has proper methods
    assert(typeof result.play === 'function', "result should have play method in test mode");
    assert(typeof result.pause === 'function', "result should have pause method in test mode");
    assert(typeof result.toString === 'function', "result should have toString method in test mode");
    assert(typeof result.valueOf === 'function', "result should have valueOf method in test mode");
    
    // Get the actual values to debug
    const toStringValue = result.toString();
    const valueOfValue = result.valueOf();
    const srcValue = result.src;
    
    // Check that toString() and valueOf() return strings
    assert(typeof toStringValue === 'string', `toString() should return a string in test mode, got: ${typeof toStringValue} with value: ${toStringValue}`);
    assert(typeof valueOfValue === 'string', `valueOf() should return a string in test mode, got: ${typeof valueOfValue} with value: ${valueOfValue}`);
    
    // Check that the URL is valid (could be blob: or data: or http:)
    assert(toStringValue.length > 0, "toString() should not return empty string in test mode");
    assert(valueOfValue.length > 0, "valueOf() should not return empty string in test mode");
    
    // Check that it's a valid URL format
    const isValidUrl = toStringValue.startsWith('blob:') || 
                       toStringValue.startsWith('data:') || 
                       toStringValue.startsWith('http:') || 
                       toStringValue.startsWith('https:');
    assert(isValidUrl, `toString() should return a valid URL in test mode, got: ${toStringValue}`);
    
    // Check that src is set and is a valid URL
    assert(typeof srcValue === 'string', "result should have src property as string in test mode");
    assert(srcValue.length > 0, "src should not be empty in test mode");
    
    // Verify toString() and valueOf() return the same value as src
    assert(toStringValue === srcValue, `toString() should return the same as src in test mode. toString(): ${toStringValue}, src: ${srcValue}`);
    assert(valueOfValue === srcValue, `valueOf() should return the same as src in test mode. valueOf(): ${valueOfValue}, src: ${srcValue}`);
};

// Export test functions
window.txt2speechTests = [
    {
        name: "testTxt2SpeechBasic",
        description: "Test basic text-to-speech functionality and verify Audio object structure",
        test: async function() {
            try {
                await testTxt2SpeechBasicCore();
                pass("testTxt2SpeechBasic passed");
            } catch (error) {
                fail("testTxt2SpeechBasic failed:", error);
            }
        }
    },
    
    {
        name: "testTxt2SpeechWithParameters",
        description: "Test text-to-speech with language and voice parameters (en-US, Brian)",
        test: async function() {
            try {
                await testTxt2SpeechWithParametersCore();
                pass("testTxt2SpeechWithParameters passed");
            } catch (error) {
                fail("testTxt2SpeechWithParameters failed:", error);
            }
        }
    },
    
    {
        name: "testTxt2SpeechWithTestMode",
        description: "Test text-to-speech with testMode enabled to verify test functionality",
        test: async function() {
            try {
                await testTxt2SpeechWithTestModeCore();
                pass("testTxt2SpeechWithTestMode passed");
            } catch (error) {
                fail("testTxt2SpeechWithTestMode failed:", error);
            }
        }
    }
]; 