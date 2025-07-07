/* eslint-disable */
// TODO: Make these more compatible with eslint
window.kvTests = [
    {
        name: "testSetKeyWithValue",
        description: "Test setting a key-value pair and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('testKey', 'testValue');
                assert(result === true, "Failed to set key with value");
                pass("testSetKeyWithValue passed");
            } catch (error) {
                fail("testSetKeyWithValue failed:", error);
            }
        }
    },
    {
        name: "testUpdateKey",
        description: "Test updating an existing key with a new value and verify it returns true",
        test: async function() {
            try {
                await puter.kv.set('updateKey', 'initialValue');
                const result = await puter.kv.set('updateKey', 'updatedValue');
                assert(result === true, "Failed to update existing key");
                pass("testUpdateKey passed");
            } catch (error) {
                fail("testUpdateKey failed:", error);
            }
        }
    },
    {
        name: "testKeySizeLimit",
        description: "Test setting a key that exceeds the size limit and verify it throws an error",
        test: async function() {
            try {
                const largeKey = 'a'.repeat(1025); // 1 KB + 1 byte
                await puter.kv.set(largeKey, 'value');
                fail("testKeySizeLimit failed: No error thrown for large key");
            } catch (error) {
                pass("testKeySizeLimit passed:", error.message);
            }
        }
    },
    {
        name: "testInvalidParameters",
        description: "Test setting a key with invalid parameters and verify it throws an error",
        test: async function() {
            try {
                await puter.kv.set(undefined, 'value');
                fail("testInvalidParameters failed: No error thrown for undefined key");
            } catch (error) {
                pass("testInvalidParameters passed:", error.message);
            }
        }
    },
    {
        name: "testEmptyKey",
        description: "Test setting an empty key and verify it throws an error",
        test: async function() {
            try {
                await puter.kv.set('', 'value');
                fail("testEmptyKey failed: No error thrown for empty key");
            } catch (error) {
                pass("testEmptyKey passed:", error.message);
            }
        }
    },
    {
        name: "testSetNullValue",
        description: "Test setting a null value and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('nullValueKey', null);
                assert(result === true, "Failed to set null value");
                pass("testSetNullValue passed");
            } catch (error) {
                fail("testSetNullValue failed:", error);
            }
        }
    },
    {
        name: "testSetObjectValue",
        description: "Test setting an object as a value and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('objectKey', { a: 1 });
                assert(result === true, "Failed to set object as value");
                pass("testSetObjectValue passed");
            } catch (error) {
                fail("testSetObjectValue failed:", error);
            }
        }
    },
    {
        name: "testSetKeyWithSpecialCharacters",
        description: "Test setting a key with special characters and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('special@Key#', 'value');
                assert(result === true, "Failed to set key with special characters");
                pass("testSetKeyWithSpecialCharacters passed");
            } catch (error) {
                fail("testSetKeyWithSpecialCharacters failed:", error);
            }
        }
    },
    {
        name: "testSetLargeValue",
        description: "Test setting a large value and verify it returns true",
        test: async function() {
            try {
                const largeValue = 'a'.repeat(10000); // 10 KB
                const result = await puter.kv.set('largeValueKey', largeValue);
                assert(result === true, "Failed to set large value");
                pass("testSetLargeValue passed");
            } catch (error) {
                fail("testSetLargeValue failed:", error);
            }
        }
    },
    {
        name: "testSetBooleanValue",
        description: "Test setting a boolean value and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('booleanKey', true);
                assert(result === true, "Failed to set boolean value");
                pass("testSetBooleanValue passed");
            } catch (error) {
                fail("testSetBooleanValue failed:", error);
            }
        }
    },
    {
        name: "testSetNumericKey",
        description: "Test setting a numeric key and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set(123, 'value');
                assert(result === true, "Failed to set numeric key");
                pass("testSetNumericKey passed");
            } catch (error) {
                fail("testSetNumericKey failed:", error);
            }
        }
    },
    {
        name: "testSetConcurrentKeys",
        description: "Test setting multiple keys concurrently and verify all return true",
        test: async function() {
            try {
                const promises = [puter.kv.set('key1', 'value1'), puter.kv.set('key2', 'value2')];
                const results = await Promise.all(promises);
                assert(results.every(result => result === true), "Failed to set concurrent keys");
                pass("testSetConcurrentKeys passed");
            } catch (error) {
                fail("testSetConcurrentKeys failed:", error);
            }
        }
    },
    {
        name: "testSetValueAndRetrieve",
        description: "Test setting a value and then retrieving it to verify it matches",
        test: async function() {
            try {
                await puter.kv.set('retrieveKey', 'testValue');
                const value = await puter.kv.get('retrieveKey');
                assert(value === 'testValue', "Failed to retrieve correct value");
                pass("testSetValueAndRetrieve passed");
            } catch (error) {
                fail("testSetValueAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testUpdateValueAndRetrieve",
        description: "Test updating a value and then retrieving it to verify it matches the updated value",
        test: async function() {
            try {
                await puter.kv.set('updateKey', 'initialValue');
                await puter.kv.set('updateKey', 'updatedValue');
                const value = await puter.kv.get('updateKey');
                assert(value === 'updatedValue', "Failed to retrieve updated value");
                pass("testUpdateValueAndRetrieve passed");
            } catch (error) {
                fail("testUpdateValueAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testSetNumericValueAndRetrieve",
        description: "Test setting a numeric value and then retrieving it to verify it matches",
        test: async function() {
            try {
                await puter.kv.set('numericKey', 123);
                const value = await puter.kv.get('numericKey');
                assert(value === 123, "Failed to retrieve numeric value");
                pass("testSetNumericValueAndRetrieve passed");
            } catch (error) {
                fail("testSetNumericValueAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testSetBooleanValueAndRetrieve",
        description: "Test setting a boolean value and then retrieving it to verify it matches",
        test: async function() {
            try {
                await puter.kv.set('booleanKey', true);
                const value = await puter.kv.get('booleanKey');
                assert(value === true, "Failed to retrieve boolean value");
                pass("testSetBooleanValueAndRetrieve passed");
            } catch (error) {
                fail("testSetBooleanValueAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testSetAndDeleteKey",
        description: "Test setting a key and then deleting it to verify it returns true",
        test: async function() {
            try {
                await puter.kv.set('deleteKey', 'value');
                const result = await puter.kv.del('deleteKey');
                assert(result === true, "Failed to delete key");
                pass("testSetAndDeleteKey passed");
            } catch (error) {
                fail("testSetAndDeleteKey failed:", error);
            }
        }
    },
    {
        name: "testGetNonexistentKey",
        description: "Test getting a non-existent key and verify it returns null",
        test: async function() {
            try {
                const value = await puter.kv.get('nonexistentKey_102mk');
                assert(value === null, "Failed to return `null` for nonexistent key");
                pass("testGetNonexistentKey passed");
            } catch (error) {
                fail("testGetNonexistentKey failed:", error);
            }
        }
    },
    {
        name: "testSetObjectValueAndRetrieve",
        description: "Test setting an object value and then retrieving it to verify it matches",
        test: async function() {
            try {
                const result = await puter.kv.set('objectKey', { a: 1 });
                assert(result === true, "Failed to set object as value");
                const value = await puter.kv.get('objectKey');
                assert(value.a === 1, "Failed to retrieve object value");
                pass("testSetObjectValueAndRetrieve passed");
            } catch (error) {
                fail("testSetObjectValueAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testSetArrayValue",
        description: "Test setting an array as a value and verify it returns true",
        test: async function() {
            try {
                const result = await puter.kv.set('arrayKey', [1, 2, 3]);
                assert(result === true, "Failed to set array as value");
                const value = await puter.kv.get('arrayKey');
                assert(value[0] === 1, "Failed to retrieve array value");
                pass("testSetArrayValue passed");
            } catch (error) {
                fail("testSetArrayValue failed:", error);
            }
        }
    },
    {
        name: "testSetKeyWithSpecialCharactersAndRetrieve",
        description: "Test setting a key with special characters and then retrieving it to verify it matches",
        test: async function() {
            try {
                await puter.kv.set('special@Key#', 'value');
                const value = await puter.kv.get('special@Key#');
                assert(value === 'value', "Failed to retrieve value for key with special characters");
                pass("testSetKeyWithSpecialCharactersAndRetrieve passed");
            } catch (error) {
                fail("testSetKeyWithSpecialCharactersAndRetrieve failed:", error);
            }
        }
    },
    {
        name: "testConcurrentSetOperations",
        description: "Test setting multiple keys concurrently and verify all return true",
        test: async function() {
            try {
                const promises = [puter.kv.set('key1', 'value1'), puter.kv.set('key2', 'value2')];
                const results = await Promise.all(promises);
                assert(results.every(result => result === true), "Failed to set concurrent keys");
                pass("testConcurrentSetOperations passed");
            } catch (error) {
                fail("testConcurrentSetOperations failed:", error);
            }
        }
    },
    {
        name: "testFlush",
        description: "Test flushing a bunch of keys and verify they no longer exist",
        test: async function() {
            try {
                const keys = [];
                for(let i = 0; i < 10; i++){
                    keys.push('key' + i);
                }
                await Promise.all(keys.map(key => puter.kv.set(key, 'value')));
                await puter.kv.flush();
                const results = await Promise.all(keys.map(key => puter.kv.get(key)));
                assert(results.every(result => result === null), "Failed to flush keys");
                pass("testFlush passed");
            } catch (error) {
                fail("testFlush failed:", error);
            }
        }
    },
    {
        name: "testIncr",
        description: "Test incrementing a key and verify it returns 1",
        test: async function() {
            try {
                const result = await puter.kv.incr(puter.randName());
                assert(result === 1, "Failed to increment key");
                pass("testIncr passed");
            } catch (error) {
                fail("testIncr failed:", error);
            }
        }
    },
    {
        name: "testDecr",
        description: "Test decrementing a key and verify it returns -1",
        test: async function() {
            try {
                const result = await puter.kv.decr(puter.randName());
                assert(result === -1, "Failed to decrement key");
                pass("testDecr passed");
            } catch (error) {
                fail("testDecr failed:", error);
            }
        }
    },
    {
        name: "testIncrExistingKey",
        description: "Test incrementing an existing key and verify it returns 2",
        test: async function() {
            try {
                await puter.kv.set('incrKey', 1);
                const result = await puter.kv.incr('incrKey');
                assert(result === 2, "Failed to increment existing key");
                pass("testIncrExistingKey passed");
            } catch (error) {
                fail("testIncrExistingKey failed:", error);
            }
        }
    },
    {
        name: "testDecrExistingKey",
        description: "Test decrementing an existing key and verify it returns 1",
        test: async function() {
            try {
                await puter.kv.set('decrKey', 2);
                const result = await puter.kv.decr('decrKey');
                assert(result === 1, "Failed to decrement existing key");
                pass("testDecrExistingKey passed");
            } catch (error) {
                fail("testDecrExistingKey failed:", error);
            }
        }
    },
    {
        name: "testIncrByAmount",
        description: "Test incrementing a key by a specified amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('incrKey', 1);
                const result = await puter.kv.incr('incrKey', 5);
                assert(result === 6, "Failed to increment key by amount");
                pass("testIncrByAmount passed");
            } catch (error) {
                fail("testIncrByAmount failed:", error);
            }
        }
    },
    {
        name: "testDecrByAmount",
        description: "Test decrementing a key by a specified amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('decrKey', 10);
                const result = await puter.kv.decr('decrKey', 5);
                assert(result === 5, "Failed to decrement key by amount");
                pass("testDecrByAmount passed");
            } catch (error) {
                fail("testDecrByAmount failed:", error);
            }
        }
    },
    {
        name: "testIncrByAmountExistingKey",
        description: "Test incrementing an existing key by a specified amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('incrKey', 1);
                const result = await puter.kv.incr('incrKey', 5);
                assert(result === 6, "Failed to increment existing key by amount");
                pass("testIncrByAmountExistingKey passed");
            } catch (error) {
                fail("testIncrByAmountExistingKey failed:", error);
            }
        }
    },
    {
        name: "testDecrByAmountExistingKey",
        description: "Test decrementing an existing key by a specified amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('decrKey', 10);
                const result = await puter.kv.decr('decrKey', 5);
                assert(result === 5, "Failed to decrement existing key by amount");
                pass("testDecrByAmountExistingKey passed");
            } catch (error) {
                fail("testDecrByAmountExistingKey failed:", error);
            }
        }
    },
    {
        name: "testIncrByNegativeAmount",
        description: "Test incrementing a key by a negative amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('incrKey', 1);
                const result = await puter.kv.incr('incrKey', -5);
                assert(result === -4, "Failed to increment key by negative amount");
                pass("testIncrByNegativeAmount passed");
            } catch (error) {
                fail("testIncrByNegativeAmount failed:", error);
            }
        }
    },
    {
        name: "testDecrByNegativeAmount",
        description: "Test decrementing a key by a negative amount and verify it returns the correct value",
        test: async function() {
            try {
                await puter.kv.set('decrKey', 10);
                const result = await puter.kv.decr('decrKey', -5);
                assert(result === 15, "Failed to decrement key by negative amount");
                pass("testDecrByNegativeAmount passed");
            } catch (error) {
                fail("testDecrByNegativeAmount failed:", error);
            }
        }
    },
    {
        name: "testListKeys",
        description: "Test listing all keys and verify the count is correct",
        test: async function() {
            try {
                const keys = [];
                // flush first
                await puter.kv.flush();
                // create 10 keys
                for(let i = 0; i < 10; i++){
                    keys.push('key' + i);
                }
                // set all keys
                await Promise.all(keys.map(key => puter.kv.set(key, 'value')));
                // list keys
                const result = await puter.kv.list();
                assert(result.length === 10, "Failed to list keys");
                pass("testListKeys passed");
            } catch (error) {
                fail("testListKeys failed:", error);
            }
        }
    },
    {
        name: "testListKeysGlob",
        description: "Test listing keys using a glob pattern and verify the count is correct",
        test: async function() {
            try {
                const keys = [];
                // flush first
                await puter.kv.flush();
                // create 10 keys
                for(let i = 0; i < 10; i++){
                    keys.push('key' + i);
                }
                // set all keys
                await Promise.all(keys.map(key => puter.kv.set(key, 'value')));
                // list keys
                const result = await puter.kv.list('k*');
                assert(result.length === 10, "Failed to list keys using glob");
                pass("testListKeysGlob passed");
            } catch (error) {
                fail("testListKeysGlob failed:", error);
            }
        }
    },
    {
        name: "testGetPerformance",
        description: "Test that get method takes less than 100ms",
        test: async function() {
            try {
                // Set up a key-value pair first
                await puter.kv.set('performanceTestKey', 'testValue');
                
                // Measure the time it takes to get the value
                const startTime = performance.now();
                const value = await puter.kv.get('performanceTestKey');
                const endTime = performance.now();
                
                const duration = endTime - startTime;
                
                // Assert that the value is correct and timing is under 100ms
                assert(value === 'testValue', "Failed to retrieve correct value");
                assert(duration < 100, `Get method took ${duration}ms, which exceeds the 100ms limit`);
                
                pass(`testGetPerformance passed: get took ${duration.toFixed(2)}ms`);
            } catch (error) {
                fail("testGetPerformance failed:", error);
            }
        }
    },
    {
        name: "testSetPerformance",
        description: "Test that set method takes less than 100ms",
        test: async function() {
            try {
                // Set up a key-value pair first
                const startTime = performance.now();
                await puter.kv.set('performanceTestKey', 'testValue');
                const endTime = performance.now();
                const duration = endTime - startTime;
                assert(duration < 100, `Set method took ${duration}ms, which exceeds the 100ms limit`);
                pass(`testSetPerformance passed: set took ${duration.toFixed(2)}ms`);
            } catch (error) {
                fail("testSetPerformance failed:", error);
            }
        }
    }
]
