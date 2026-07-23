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
        name: "testOptConfigNamespaceIsolation",
        description: "Test that optConfig.appUuid isolates KV namespaces",
        test: async function() {
            try {
                const suffix = puter.randName();
                const key = 'optConfigKey-' + suffix;
                const overrideA = { appUuid: 'opt-app-a-' + suffix };
                const overrideB = { appUuid: 'opt-app-b-' + suffix };

                await puter.kv.set(key, 'default-value');
                await puter.kv.set(key, 'override-a-value', overrideA);
                await puter.kv.set(key, 'override-b-value', overrideB);

                const defaultValue = await puter.kv.get(key);
                const overrideAValue = await puter.kv.get(key, overrideA);
                const overrideBValue = await puter.kv.get(key, overrideB);

                assert(defaultValue === 'default-value', "Default namespace value mismatch");
                assert(overrideAValue === 'override-a-value', "Override A value mismatch");
                assert(overrideBValue === 'override-b-value', "Override B value mismatch");

                const listA = await puter.kv.list(key + '*', overrideA);
                assert(Array.isArray(listA), "Expected list result to be an array");
                assert(listA.includes(key), "Override A list should include the key");

                await puter.kv.del(key, overrideA);
                const afterDeleteOverride = await puter.kv.get(key, overrideA);
                const afterDeleteDefault = await puter.kv.get(key);

                assert(afterDeleteOverride === null, "Override A key should be deleted");
                assert(afterDeleteDefault === 'default-value', "Default namespace should remain untouched");
                pass("testOptConfigNamespaceIsolation passed");
            } catch (error) {
                fail("testOptConfigNamespaceIsolation failed:", error);
            }
        }
    },
    {
        name: "testOptConfigShorthandAndScopedFlush",
        description: "Test optConfig shorthand calls and namespace-scoped flush",
        test: async function() {
            try {
                const suffix = puter.randName();
                const overrideA = { appUuid: 'opt-shorthand-a-' + suffix };
                const overrideB = { appUuid: 'opt-shorthand-b-' + suffix };
                const counterKey = 'optCounter-' + suffix;
                const updateKey = 'optUpdate-' + suffix;
                const flushKeyA = 'optFlushA-' + suffix;
                const flushKeyB = 'optFlushB-' + suffix;

                const incrResult = await puter.kv.incr(counterKey, overrideA);
                assert(incrResult === 1, "Expected shorthand incr to initialize counter to 1");
                assert(await puter.kv.get(counterKey) === null, "Default namespace counter should remain unset");
                assert(await puter.kv.get(counterKey, overrideA) === 1, "Override namespace counter mismatch");

                const updateResult = await puter.kv.update(updateKey, { 'profile.name': 'Ada' }, overrideA);
                assert(updateResult?.profile?.name === 'Ada', "Expected update in override namespace to succeed");
                assert(await puter.kv.get(updateKey) === null, "Default namespace update key should remain unset");

                await puter.kv.set(flushKeyA, 'A', overrideA);
                await puter.kv.set(flushKeyB, 'B', overrideB);
                await puter.kv.flush(overrideA);

                assert(await puter.kv.get(flushKeyA, overrideA) === null, "Scoped flush should clear override A keys");
                assert(await puter.kv.get(flushKeyB, overrideB) === 'B', "Scoped flush should not clear override B keys");
                pass("testOptConfigShorthandAndScopedFlush passed");
            } catch (error) {
                fail("testOptConfigShorthandAndScopedFlush failed:", error);
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
    },
    {
        name: "testSetObjectForm",
        description: "Test setting via the object form set({ key, value }) and retrieving the value",
        test: async function() {
            try {
                const key = 'objectFormKey-' + puter.randName();
                const result = await puter.kv.set({ key: key, value: 'objectFormValue' });
                assert(result === true, "Failed to set via object form");
                const value = await puter.kv.get(key);
                assert(value === 'objectFormValue', "Failed to retrieve value set via object form");
                pass("testSetObjectForm passed");
            } catch (error) {
                fail("testSetObjectForm failed:", error);
            }
        }
    },
    {
        name: "testBatchSetArray",
        description: "Test setting multiple key-value pairs with set([ ... ]) and retrieving each",
        test: async function() {
            try {
                const prefix = 'batchArr-' + puter.randName() + '-';
                const result = await puter.kv.set([
                    { key: prefix + '1', value: 'one' },
                    { key: prefix + '2', value: 2 },
                    { key: prefix + '3', value: { three: 3 } },
                ]);
                assert(result === true, "Batch set did not resolve to true");
                assert(await puter.kv.get(prefix + '1') === 'one', "Batch item 1 mismatch");
                assert(await puter.kv.get(prefix + '2') === 2, "Batch item 2 mismatch");
                const third = await puter.kv.get(prefix + '3');
                assert(third && third.three === 3, "Batch item 3 mismatch");
                pass("testBatchSetArray passed");
            } catch (error) {
                fail("testBatchSetArray failed:", error);
            }
        }
    },
    {
        name: "testBatchSetWrapped",
        description: "Test setting multiple key-value pairs with set({ items: [ ... ] })",
        test: async function() {
            try {
                const prefix = 'batchWrap-' + puter.randName() + '-';
                const result = await puter.kv.set({ items: [
                    { key: prefix + 'a', value: 'A' },
                    { key: prefix + 'b', value: 'B' },
                ] });
                assert(result === true, "Wrapped batch set did not resolve to true");
                assert(await puter.kv.get(prefix + 'a') === 'A', "Wrapped batch item a mismatch");
                assert(await puter.kv.get(prefix + 'b') === 'B', "Wrapped batch item b mismatch");
                pass("testBatchSetWrapped passed");
            } catch (error) {
                fail("testBatchSetWrapped failed:", error);
            }
        }
    },
    {
        name: "testBatchSetItemWithoutKey",
        description: "Test that a batch item without a key rejects with code 'invalid_item'",
        test: async function() {
            try {
                await puter.kv.set([{ value: 'orphan' }]);
                fail("testBatchSetItemWithoutKey failed: No error thrown");
            } catch (error) {
                assert(error.code === 'invalid_item', "Expected error code 'invalid_item', got: " + error.code);
                pass("testBatchSetItemWithoutKey passed");
            }
        }
    },
    {
        name: "testBatchSetEmptyArray",
        description: "Test that an empty batch rejects with code 'items_required'",
        test: async function() {
            try {
                await puter.kv.set([]);
                fail("testBatchSetEmptyArray failed: No error thrown");
            } catch (error) {
                assert(error.code === 'items_required', "Expected error code 'items_required', got: " + error.code);
                pass("testBatchSetEmptyArray passed");
            }
        }
    },
    {
        name: "testKeyTooLargeErrorCode",
        description: "Test that an oversized key rejects with the stable code 'key_too_large'",
        test: async function() {
            try {
                await puter.kv.set('a'.repeat(puter.kv.MAX_KEY_SIZE + 1), 'value');
                fail("testKeyTooLargeErrorCode failed: No error thrown");
            } catch (error) {
                assert(error.code === 'key_too_large', "Expected error code 'key_too_large', got: " + error.code);
                pass("testKeyTooLargeErrorCode passed");
            }
        }
    },
    {
        name: "testValueTooLargeErrorCode",
        description: "Test that an oversized value rejects with the stable code 'value_too_large'",
        test: async function() {
            try {
                await puter.kv.set('valueTooLargeKey', 'a'.repeat(puter.kv.MAX_VALUE_SIZE + 1));
                fail("testValueTooLargeErrorCode failed: No error thrown");
            } catch (error) {
                assert(error.code === 'value_too_large', "Expected error code 'value_too_large', got: " + error.code);
                pass("testValueTooLargeErrorCode passed");
            }
        }
    },
    {
        name: "testGetObjectForm",
        description: "Test retrieving a value via the object form get({ key })",
        test: async function() {
            try {
                const key = 'getObjectForm-' + puter.randName();
                await puter.kv.set(key, 'viaObject');
                const value = await puter.kv.get({ key: key });
                assert(value === 'viaObject', "Failed to retrieve via object form");
                pass("testGetObjectForm passed");
            } catch (error) {
                fail("testGetObjectForm failed:", error);
            }
        }
    },
    {
        name: "testDelObjectForm",
        description: "Test deleting a key via the object form del({ key })",
        test: async function() {
            try {
                const key = 'delObjectForm-' + puter.randName();
                await puter.kv.set(key, 'x');
                const result = await puter.kv.del({ key: key });
                assert(result === true, "del object form did not resolve to true");
                assert(await puter.kv.get(key) === null, "Key still readable after del");
                pass("testDelObjectForm passed");
            } catch (error) {
                fail("testDelObjectForm failed:", error);
            }
        }
    },
    {
        name: "testExpireFutureKeepsReadable",
        description: "Test that expire() with a future ttl keeps the key readable (return value is backend passthrough, not asserted)",
        test: async function() {
            try {
                const key = 'expireFuture-' + puter.randName();
                await puter.kv.set(key, 'fresh');
                await puter.kv.expire(key, 3600);
                assert(await puter.kv.get(key) === 'fresh', "Key unreadable before its ttl elapsed");
                pass("testExpireFutureKeepsReadable passed");
            } catch (error) {
                fail("testExpireFutureKeepsReadable failed:", error);
            }
        }
    },
    {
        name: "testExpireAtPastRemovesKey",
        description: "Test that expireAt() with a past timestamp makes the key unreadable",
        test: async function() {
            try {
                const key = 'expireAtPast-' + puter.randName();
                await puter.kv.set(key, 'stale');
                await puter.kv.expireAt(key, Math.floor(Date.now() / 1000) - 60);
                assert(await puter.kv.get(key) === null, "Key still readable after past expireAt");
                pass("testExpireAtPastRemovesKey passed");
            } catch (error) {
                fail("testExpireAtPastRemovesKey failed:", error);
            }
        }
    },
    {
        name: "testUpdatePaths",
        description: "Test updating nested paths without overwriting the whole value",
        test: async function() {
            try {
                const key = 'updatePaths-' + puter.randName();
                await puter.kv.set(key, { profile: { color: 'red', size: 'm' } });
                await puter.kv.update(key, { 'profile.color': 'blue' });
                const value = await puter.kv.get(key);
                assert(value.profile.color === 'blue', "Updated path mismatch");
                assert(value.profile.size === 'm', "Untouched path was overwritten");
                pass("testUpdatePaths passed");
            } catch (error) {
                fail("testUpdatePaths failed:", error);
            }
        }
    },
    {
        name: "testUpdateWithTtl",
        description: "Test update() with a ttl keeps the patched value readable before expiry",
        test: async function() {
            try {
                const key = 'updateTtl-' + puter.randName();
                await puter.kv.set(key, { n: 1 });
                await puter.kv.update(key, { n: 2 }, 3600);
                const value = await puter.kv.get(key);
                assert(value.n === 2, "Patched value mismatch after ttl update");
                pass("testUpdateWithTtl passed");
            } catch (error) {
                fail("testUpdateWithTtl failed:", error);
            }
        }
    },
    {
        name: "testUpdateObjectForm",
        description: "Test updating via the object form update({ key, pathAndValueMap })",
        test: async function() {
            try {
                const key = 'updateObjectForm-' + puter.randName();
                await puter.kv.set(key, { a: 1 });
                await puter.kv.update({ key: key, pathAndValueMap: { a: 2 } });
                const value = await puter.kv.get(key);
                assert(value.a === 2, "Object-form update mismatch");
                pass("testUpdateObjectForm passed");
            } catch (error) {
                fail("testUpdateObjectForm failed:", error);
            }
        }
    },
    {
        name: "testUpdateInvalidMapErrorCode",
        description: "Test that update() with a non-object map rejects with code 'path_map_invalid'",
        test: async function() {
            try {
                await puter.kv.update('updateInvalidMapKey', 'not-a-map');
                fail("testUpdateInvalidMapErrorCode failed: No error thrown");
            } catch (error) {
                assert(error.code === 'path_map_invalid', "Expected error code 'path_map_invalid', got: " + error.code);
                pass("testUpdateInvalidMapErrorCode passed");
            }
        }
    },
    {
        name: "testRemovePath",
        description: "Test removing a nested path from an object value",
        test: async function() {
            try {
                const key = 'removePath-' + puter.randName();
                await puter.kv.set(key, { keep: 1, drop: 2 });
                await puter.kv.remove(key, 'drop');
                const value = await puter.kv.get(key);
                assert(value.keep === 1, "Kept path missing after remove");
                assert(value.drop === undefined, "Removed path still present");
                pass("testRemovePath passed");
            } catch (error) {
                fail("testRemovePath failed:", error);
            }
        }
    },
    {
        name: "testRemoveMultiplePaths",
        description: "Test removing several paths in one remove() call",
        test: async function() {
            try {
                const key = 'removeMulti-' + puter.randName();
                await puter.kv.set(key, { a: 1, b: 2, c: 3 });
                await puter.kv.remove(key, 'a', 'b');
                const value = await puter.kv.get(key);
                assert(value.a === undefined && value.b === undefined, "Removed paths still present");
                assert(value.c === 3, "Untouched path was removed");
                pass("testRemoveMultiplePaths passed");
            } catch (error) {
                fail("testRemoveMultiplePaths failed:", error);
            }
        }
    },
    {
        name: "testRemoveRequiresPaths",
        description: "Test that remove() without paths rejects with code 'arguments_required'",
        test: async function() {
            try {
                await puter.kv.remove('removeNoPathsKey');
                fail("testRemoveRequiresPaths failed: No error thrown");
            } catch (error) {
                assert(error.code === 'arguments_required', "Expected error code 'arguments_required', got: " + error.code);
                pass("testRemoveRequiresPaths passed");
            }
        }
    },
    {
        name: "testAddToArrayPath",
        description: "Test add() appending values into an array at a path",
        test: async function() {
            try {
                const key = 'addArray-' + puter.randName();
                await puter.kv.set(key, { tags: ['alpha'] });
                const updated = await puter.kv.add(key, { 'tags': ['beta', 'gamma'] });
                assert(updated && updated.tags && updated.tags.length === 3, "add() did not return the updated value");
                const value = await puter.kv.get(key);
                assert(value.tags.join(',') === 'alpha,beta,gamma', "Stored array mismatch after add");
                pass("testAddToArrayPath passed");
            } catch (error) {
                fail("testAddToArrayPath failed:", error);
            }
        }
    },
    {
        name: "testIncrNestedPath",
        description: "Test incr() with a path map incrementing a property inside an object value",
        test: async function() {
            try {
                const key = 'incrNested-' + puter.randName();
                await puter.kv.set(key, { user: { score: 1 } });
                await puter.kv.incr(key, { 'user.score': 2 });
                const value = await puter.kv.get(key);
                assert(value.user.score === 3, "Nested increment mismatch, got: " + value.user.score);
                pass("testIncrNestedPath passed");
            } catch (error) {
                fail("testIncrNestedPath failed:", error);
            }
        }
    },
    {
        name: "testDecrNestedPath",
        description: "Test decr() with a path map decrementing a property inside an object value",
        test: async function() {
            try {
                const key = 'decrNested-' + puter.randName();
                await puter.kv.set(key, { user: { score: 5 } });
                await puter.kv.decr(key, { 'user.score': 2 });
                const value = await puter.kv.get(key);
                assert(value.user.score === 3, "Nested decrement mismatch, got: " + value.user.score);
                pass("testDecrNestedPath passed");
            } catch (error) {
                fail("testDecrNestedPath failed:", error);
            }
        }
    },
    {
        name: "testListReturnValuesPairs",
        description: "Test list(pattern, true) returning { key, value } pairs",
        test: async function() {
            try {
                const prefix = 'listPairs-' + puter.randName() + '-';
                await puter.kv.set(prefix + 'x', 'val-x');
                const pairs = await puter.kv.list(prefix + '*', true);
                assert(pairs.length === 1, "Expected exactly one pair, got: " + pairs.length);
                assert(pairs[0].key === prefix + 'x' && pairs[0].value === 'val-x', "Pair contents mismatch");
                pass("testListReturnValuesPairs passed");
            } catch (error) {
                fail("testListReturnValuesPairs failed:", error);
            }
        }
    },
    {
        name: "testListPatternExplicitFalse",
        description: "Test list(pattern, false) honors the pattern (documented behavior; older builds dropped the pattern)",
        test: async function() {
            try {
                const prefix = 'listExplicitFalse-' + puter.randName() + '-';
                await puter.kv.set(prefix + 'a', 1);
                await puter.kv.set('unrelated-' + prefix, 1);
                const keys = await puter.kv.list(prefix + '*', false);
                assert(keys.length === 1 && keys[0] === prefix + 'a',
                    "list(pattern, false) did not filter by pattern; got: " + JSON.stringify(keys));
                pass("testListPatternExplicitFalse passed");
            } catch (error) {
                fail("testListPatternExplicitFalse failed:", error);
            }
        }
    },
    {
        name: "testListCursorPagination",
        description: "Test list({ limit, cursor }) pages through all matching keys",
        test: async function() {
            try {
                const prefix = 'listPage-' + puter.randName() + '-';
                for (let i = 1; i <= 5; i++) {
                    await puter.kv.set(prefix + i, 'v' + i);
                }
                const seen = [];
                let cursor = undefined;
                let guard = 0;
                do {
                    const page = await puter.kv.list({ pattern: prefix + '*', limit: 2, cursor: cursor });
                    assert(Array.isArray(page.items), "Page is missing an items array");
                    for (const item of page.items) seen.push(item);
                    cursor = page.cursor;
                } while (cursor && ++guard < 10);
                assert(seen.length === 5, "Expected 5 keys across pages, got: " + seen.length);
                pass("testListCursorPagination passed");
            } catch (error) {
                fail("testListCursorPagination failed:", error);
            }
        }
    },
    {
        name: "testListIncludeTotalWarnsOnce",
        description: "Test that includeTotal returns a numeric total and logs its cost warning exactly once per page load (reload before re-running)",
        test: async function() {
            try {
                const prefix = 'listTotalWarn-' + puter.randName() + '-';
                await puter.kv.set(prefix + 'a', 1);
                await puter.kv.set(prefix + 'b', 1);

                const warnings = [];
                const originalWarn = console.warn;
                console.warn = function(...args) {
                    warnings.push(args.join(' '));
                    originalWarn.apply(console, args);
                };
                let firstPage;
                try {
                    firstPage = await puter.kv.list({ pattern: prefix + '*', limit: 1, includeTotal: true });
                    await puter.kv.list({ pattern: prefix + '*', limit: 1, includeTotal: true });
                } finally {
                    console.warn = originalWarn;
                }

                assert(typeof firstPage.total === 'number' && firstPage.total >= 2,
                    "Expected a numeric total >= 2, got: " + firstPage.total);
                const totalWarnings = warnings.filter(w => w.includes('includeTotal'));
                assert(totalWarnings.length === 1,
                    "Expected exactly one includeTotal warning, got: " + totalWarnings.length +
                    " (the nudge fires once per page load — reload before re-running)");
                pass("testListIncludeTotalWarnsOnce passed");
            } catch (error) {
                fail("testListIncludeTotalWarnsOnce failed:", error);
            }
        }
    },
    {
        name: "testListStreamPages",
        description: "Test list({ stream: true, limit }) yields pages directly in a for await ... of loop",
        test: async function() {
            try {
                const prefix = 'listStream-' + puter.randName() + '-';
                for (let i = 1; i <= 5; i++) {
                    await puter.kv.set(prefix + i, 'v' + i);
                }
                const seen = [];
                let pages = 0;
                for await (const page of puter.kv.list({ pattern: prefix + '*', limit: 2, stream: true })) {
                    pages++;
                    assert(Array.isArray(page.items), "Stream page is missing an items array");
                    assert(page.items.length <= 2, "Stream page exceeded the limit: " + page.items.length);
                    for (const item of page.items) seen.push(item);
                }
                assert(pages >= 2, "Expected multiple stream pages, got: " + pages);
                assert(seen.length === 5, "Expected 5 keys across stream pages, got: " + seen.length);
                pass("testListStreamPages passed");
            } catch (error) {
                fail("testListStreamPages failed:", error);
            }
        }
    },
    {
        name: "testListStreamAwaitedForm",
        description: "Test that awaiting list({ stream: true }) first (puter.ai.chat style) also yields an iterable of pages",
        test: async function() {
            try {
                const prefix = 'listStreamAwait-' + puter.randName() + '-';
                await puter.kv.set(prefix + 'a', 1);
                await puter.kv.set(prefix + 'b', 2);
                const iterator = await puter.kv.list({ pattern: prefix + '*', limit: 1, stream: true, returnValues: true });
                const seen = [];
                for await (const page of iterator) {
                    for (const item of page.items) seen.push(item.key);
                }
                assert(seen.length === 2, "Expected 2 pairs across pages, got: " + seen.length);
                pass("testListStreamAwaitedForm passed");
            } catch (error) {
                fail("testListStreamAwaitedForm failed:", error);
            }
        }
    },
    {
        name: "testListStreamIncludeTotalFirstPageOnly",
        description: "Test that a stream with includeTotal carries total on the first page only",
        test: async function() {
            try {
                const prefix = 'listStreamTotal-' + puter.randName() + '-';
                for (let i = 1; i <= 3; i++) {
                    await puter.kv.set(prefix + i, 'v' + i);
                }
                let firstTotal;
                const laterTotals = [];
                let pages = 0;
                for await (const page of puter.kv.list({ pattern: prefix + '*', limit: 1, stream: true, includeTotal: true })) {
                    if (pages === 0) firstTotal = page.total;
                    else laterTotals.push(page.total);
                    pages++;
                }
                assert(pages >= 2, "Expected multiple pages, got: " + pages);
                assert(typeof firstTotal === 'number' && firstTotal >= 3,
                    "Expected a numeric total >= 3 on the first page, got: " + firstTotal);
                assert(laterTotals.every(t => t === undefined),
                    "Later pages should not carry a total, got: " + JSON.stringify(laterTotals));
                pass("testListStreamIncludeTotalFirstPageOnly passed");
            } catch (error) {
                fail("testListStreamIncludeTotalFirstPageOnly failed:", error);
            }
        }
    },
    {
        name: "testListStreamResumesFromCursor",
        description: "Test that a stream started from a previous page's cursor covers exactly the remaining keys",
        test: async function() {
            try {
                const prefix = 'listStreamResume-' + puter.randName() + '-';
                const created = [];
                for (let i = 1; i <= 4; i++) {
                    created.push(prefix + i);
                    await puter.kv.set(prefix + i, 'v' + i);
                }
                const first = await puter.kv.list({ pattern: prefix + '*', limit: 2 });
                assert(first.cursor, "Expected a cursor on the first page");
                const seen = first.items.slice();
                for await (const page of puter.kv.list({ pattern: prefix + '*', limit: 2, stream: true, cursor: first.cursor })) {
                    for (const item of page.items) seen.push(item);
                }
                assert(seen.length === 4, "Expected 4 keys in total, got: " + seen.length);
                assert(new Set(seen).size === 4, "Resumed stream repeated keys: " + JSON.stringify(seen));
                assert(created.every(k => seen.includes(k)), "Missing keys after resume: " + JSON.stringify(seen));
                pass("testListStreamResumesFromCursor passed");
            } catch (error) {
                fail("testListStreamResumesFromCursor failed:", error);
            }
        }
    },
    {
        name: "testListStreamRejectsOffset",
        description: "Test that list({ stream: true, offset }) throws invalid_request synchronously without a request",
        test: async function() {
            try {
                let threw = null;
                try {
                    puter.kv.list({ stream: true, offset: 1 });
                } catch (error) {
                    threw = error;
                }
                assert(threw, "Expected a synchronous throw for stream + offset");
                assert(threw.code === 'invalid_request',
                    "Expected code 'invalid_request', got: " + (threw && threw.code));
                pass("testListStreamRejectsOffset passed");
            } catch (error) {
                fail("testListStreamRejectsOffset failed:", error);
            }
        }
    },
    {
        name: "testListUnboundScanWarnsOnMultiplePages",
        description: "SLOW: seeds ~1050 keys, checks a full listing pages under the hood and logs its scan warning once per page load, then flushes the store",
        test: async function() {
            try {
                const prefix = 'listBig-' + puter.randName() + '-';
                const total = 1050;
                for (let start = 0; start < total; start += 100) {
                    const items = [];
                    for (let i = start; i < Math.min(start + 100, total); i++) {
                        items.push({ key: prefix + String(i).padStart(4, '0'), value: 1 });
                    }
                    await puter.kv.set(items);
                }

                const warnings = [];
                const originalWarn = console.warn;
                console.warn = function(...args) {
                    warnings.push(args.join(' '));
                    originalWarn.apply(console, args);
                };
                let keys;
                try {
                    keys = await puter.kv.list(prefix + '*');
                } finally {
                    console.warn = originalWarn;
                }

                assert(Array.isArray(keys), "Unbound list() should still resolve to a plain array");
                assert(keys.length === total, "Expected " + total + " keys, got: " + keys.length);
                const scanWarnings = warnings.filter(w => w.includes('spanned multiple pages'));
                assert(scanWarnings.length === 1,
                    "Expected exactly one unbounded-scan warning, got: " + scanWarnings.length +
                    " (the nudge fires once per page load — reload before re-running)");

                await puter.kv.flush();
                pass("testListUnboundScanWarnsOnMultiplePages passed");
            } catch (error) {
                fail("testListUnboundScanWarnsOnMultiplePages failed:", error);
            }
        }
    },
    {
        name: "testClearAlias",
        description: "Test that clear() is the same function as flush() and empties the store",
        test: async function() {
            try {
                assert(puter.kv.clear === puter.kv.flush, "clear is not the same function as flush");
                const key = 'clearAlias-' + puter.randName();
                await puter.kv.set(key, 1);
                await puter.kv.clear();
                assert(await puter.kv.get(key) === null, "Key still readable after clear()");
                pass("testClearAlias passed");
            } catch (error) {
                fail("testClearAlias failed:", error);
            }
        }
    },
    {
        name: "testSizeLimitConstants",
        description: "Test that MAX_KEY_SIZE and MAX_VALUE_SIZE expose the documented limits",
        test: async function() {
            try {
                assert(puter.kv.MAX_KEY_SIZE === 1024, "MAX_KEY_SIZE mismatch: " + puter.kv.MAX_KEY_SIZE);
                assert(puter.kv.MAX_VALUE_SIZE === 399 * 1024, "MAX_VALUE_SIZE mismatch: " + puter.kv.MAX_VALUE_SIZE);
                pass("testSizeLimitConstants passed");
            } catch (error) {
                fail("testSizeLimitConstants failed:", error);
            }
        }
    },
    {
        name: "testDestructuredMethods",
        description: "Test that kv methods keep working when destructured off puter.kv (older builds fail: get was not bound)",
        test: async function() {
            try {
                const { set, get, del } = puter.kv;
                const key = 'destructured-' + puter.randName();
                assert(await set(key, 'unbound') === true, "Destructured set failed");
                assert(await get(key) === 'unbound', "Destructured get failed");
                assert(await del(key) === true, "Destructured del failed");
                pass("testDestructuredMethods passed");
            } catch (error) {
                fail("testDestructuredMethods failed:", error);
            }
        }
    }
]
