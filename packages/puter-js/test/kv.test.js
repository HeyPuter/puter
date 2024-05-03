/* eslint-disable */
// TODO: Make these more compatible with eslint
window.kvTests = [
    testSetKeyWithValue = async function() {
        try {
            const result = await puter.kv.set('testKey', 'testValue');
            assert(result === true, "Failed to set key with value");
            pass("testSetKeyWithValue passed");
        } catch (error) {
            fail("testSetKeyWithValue failed:", error);
        }
    },
    
    testUpdateKey = async function() {
        try {
            await puter.kv.set('updateKey', 'initialValue');
            const result = await puter.kv.set('updateKey', 'updatedValue');
            assert(result === true, "Failed to update existing key");
            pass("testUpdateKey passed");
        } catch (error) {
            fail("testUpdateKey failed:", error);
        }
    },
    
    testKeySizeLimit = async function() {
        try {
            const largeKey = 'a'.repeat(1025); // 1 KB + 1 byte
            await puter.kv.set(largeKey, 'value');
            fail("testKeySizeLimit failed: No error thrown for large key");
        } catch (error) {
            pass("testKeySizeLimit passed:", error.message);
        }
    },
    
    testInvalidParameters = async function() {
        try {
            await puter.kv.set(undefined, 'value');
            fail("testInvalidParameters failed: No error thrown for undefined key");
        } catch (error) {
            pass("testInvalidParameters passed:", error.message);
        }
    },
    
    // testEmptyKey should fail
    testEmptyKey = async function() {
        try {
            await puter.kv.set('', 'value');
            fail("testEmptyKey failed: No error thrown for empty key");
        } catch (error) {
            pass("testEmptyKey passed:", error.message);
        }
    },
    
    
    testSetNullValue = async function() {
        try {
            const result = await puter.kv.set('nullValueKey', null);
            assert(result === true, "Failed to set null value");
            pass("testSetNullValue passed");
        } catch (error) {
            fail("testSetNullValue failed:", error);
        }
    },
    
    testSetObjectValue = async function() {
        try {
            const result = await puter.kv.set('objectKey', { a: 1 });
            assert(result === true, "Failed to set object as value");
            pass("testSetObjectValue passed");
        } catch (error) {
            fail("testSetObjectValue failed:", error);
        }
    },
    
    testSetKeyWithSpecialCharacters = async function() {
        try {
            const result = await puter.kv.set('special@Key#', 'value');
            assert(result === true, "Failed to set key with special characters");
            pass("testSetKeyWithSpecialCharacters passed");
        } catch (error) {
            fail("testSetKeyWithSpecialCharacters failed:", error);
        }
    },
    
    testSetLargeValue = async function() {
        try {
            const largeValue = 'a'.repeat(10000); // 10 KB
            const result = await puter.kv.set('largeValueKey', largeValue);
            assert(result === true, "Failed to set large value");
            pass("testSetLargeValue passed");
        } catch (error) {
            fail("testSetLargeValue failed:", error);
        }
    },
    
    testSetBooleanValue = async function() {
        try {
            const result = await puter.kv.set('booleanKey', true);
            assert(result === true, "Failed to set boolean value");
            pass("testSetBooleanValue passed");
        } catch (error) {
            fail("testSetBooleanValue failed:", error);
        }
    },
    
    testSetNumericKey = async function() {
        try {
            const result = await puter.kv.set(123, 'value');
            assert(result === true, "Failed to set numeric key");
            pass("testSetNumericKey passed");
        } catch (error) {
            fail("testSetNumericKey failed:", error);
        }
    },
    
    testSetConcurrentKeys = async function() {
        try {
            const promises = [puter.kv.set('key1', 'value1'), puter.kv.set('key2', 'value2')];
            const results = await Promise.all(promises);
            assert(results.every(result => result === true), "Failed to set concurrent keys");
            pass("testSetConcurrentKeys passed");
        } catch (error) {
            fail("testSetConcurrentKeys failed:", error);
        }
    },
    
    testSetValueAndRetrieve = async function() {
        try {
            await puter.kv.set('retrieveKey', 'testValue');
            const value = await puter.kv.get('retrieveKey');
            assert(value === 'testValue', "Failed to retrieve correct value");
            pass("testSetValueAndRetrieve passed");
        } catch (error) {
            fail("testSetValueAndRetrieve failed:", error);
        }
    },
    
    testUpdateValueAndRetrieve = async function() {
        try {
            await puter.kv.set('updateKey', 'initialValue');
            await puter.kv.set('updateKey', 'updatedValue');
            const value = await puter.kv.get('updateKey');
            assert(value === 'updatedValue', "Failed to retrieve updated value");
            pass("testUpdateValueAndRetrieve passed");
        } catch (error) {
            fail("testUpdateValueAndRetrieve failed:", error);
        }
    },
    
    testSetNumericValueAndRetrieve = async function() {
        try {
            await puter.kv.set('numericKey', 123);
            const value = await puter.kv.get('numericKey');
            assert(value === 123, "Failed to retrieve numeric value");
            pass("testSetNumericValueAndRetrieve passed");
        } catch (error) {
            fail("testSetNumericValueAndRetrieve failed:", error);
        }
    },
    
    testSetBooleanValueAndRetrieve = async function() {
        try {
            await puter.kv.set('booleanKey', true);
            const value = await puter.kv.get('booleanKey');
            assert(value === true, "Failed to retrieve boolean value");
            pass("testSetBooleanValueAndRetrieve passed");
        } catch (error) {
            fail("testSetBooleanValueAndRetrieve failed:", error);
        }
    },
    
    
    testSetAndDeleteKey = async function() {
        try {
            await puter.kv.set('deleteKey', 'value');
            const result = await puter.kv.del('deleteKey');
            assert(result === true, "Failed to delete key");
            pass("testSetAndDeleteKey passed");
        } catch (error) {
            fail("testSetAndDeleteKey failed:", error);
        }
    },

    // if key does not exist, get() should return null
    testGetNonexistentKey = async function() {
        try {
            const value = await puter.kv.get('nonexistentKey_102mk');
            assert(value === null, "Failed to return `null` for nonexistent key");
            pass("testGetNonexistentKey passed");
        } catch (error) {
            fail("testGetNonexistentKey failed:", error);
        }
    },
    
    // string key and object value
    testSetObjectValue = async function() {
        try {
            const result = await puter.kv.set('objectKey', { a: 1 });
            assert(result === true, "Failed to set object as value");
            const value = await puter.kv.get('objectKey');
            assert(value.a === 1, "Failed to retrieve object value");
            pass("testSetObjectValue passed");
        } catch (error) {
            fail("testSetObjectValue failed:", error);
        }
    },

    // string key and array value
    testSetArrayValue = async function() {
        try {
            const result = await puter.kv.set('arrayKey', [1, 2, 3]);
            assert(result === true, "Failed to set array as value");
            const value = await puter.kv.get('arrayKey');
            assert(value[0] === 1, "Failed to retrieve array value");
            pass("testSetArrayValue passed");
        } catch (error) {
            fail("testSetArrayValue failed:", error);
        }
    },

    testSetKeyWithSpecialCharactersAndRetrieve = async function() {
        try {
            await puter.kv.set('special@Key#', 'value');
            const value = await puter.kv.get('special@Key#');
            assert(value === 'value', "Failed to retrieve value for key with special characters");
            pass("testSetKeyWithSpecialCharactersAndRetrieve passed");
        } catch (error) {
            fail("testSetKeyWithSpecialCharactersAndRetrieve failed:", error);
        }
    },
    
    testConcurrentSetOperations = async function() {
        try {
            const promises = [puter.kv.set('key1', 'value1'), puter.kv.set('key2', 'value2')];
            const results = await Promise.all(promises);
            assert(results.every(result => result === true), "Failed to set concurrent keys");
            pass("testConcurrentSetOperations passed");
        } catch (error) {
            fail("testConcurrentSetOperations failed:", error);
        }
    },

    //test flush: create a bunch of keys, flush, then check if they exist
    testFlush = async function() {
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
    },

    // incr
    testIncr = async function() {
        try {
            const result = await puter.kv.incr('incrKey');
            assert(result === 1, "Failed to increment key");
            pass("testIncr passed");
        } catch (error) {
            fail("testIncr failed:", error);
        }
    },

    // decr
    testDecr = async function() {
        try {
            const result = await puter.kv.decr('decrKey');
            assert(result === -1, "Failed to decrement key");
            pass("testDecr passed");
        } catch (error) {
            fail("testDecr failed:", error);
        }
    },

    // incr existing key
    testIncrExistingKey = async function() {
        try {
            await puter.kv.set('incrKey', 1);
            const result = await puter.kv.incr('incrKey');
            assert(result === 2, "Failed to increment existing key");
            pass("testIncrExistingKey passed");
        } catch (error) {
            fail("testIncrExistingKey failed:", error);
        }
    },

    // decr existing key
    testIncrExistingKey = async function() {
        try {
            await puter.kv.set('decrKey', 2);
            const result = await puter.kv.decr('decrKey');
            assert(result === 1, "Failed to decrement existing key");
            pass("testDecrExistingKey passed");
        } catch (error) {
            fail("testDecrExistingKey failed:", error);
        }
    },

    // incr by amount
    testIncrByAmount = async function() {
        try {
            await puter.kv.set('incrKey', 1);
            const result = await puter.kv.incr('incrKey', 5);
            assert(result === 6, "Failed to increment key by amount");
            pass("testIncrByAmount passed");
        } catch (error) {
            fail("testIncrByAmount failed:", error);
        }
    },

    // decr by amount
    testDecrByAmount = async function() {
        try {
            await puter.kv.set('decrKey', 10);
            const result = await puter.kv.decr('decrKey', 5);
            assert(result === 5, "Failed to decrement key by amount");
            pass("testDecrByAmount passed");
        } catch (error) {
            fail("testDecrByAmount failed:", error);
        }
    },

    // incr by amount existing key
    testIncrByAmountExistingKey = async function() {
        try {
            await puter.kv.set('incrKey', 1);
            const result = await puter.kv.incr('incrKey', 5);
            assert(result === 6, "Failed to increment existing key by amount");
            pass("testIncrByAmountExistingKey passed");
        } catch (error) {
            fail("testIncrByAmountExistingKey failed:", error);
        }
    },

    // decr by amount existing key
    testDecrByAmountExistingKey= async function() {
        try {
            await puter.kv.set('decrKey', 10);
            const result = await puter.kv.decr('decrKey', 5);
            assert(result === 5, "Failed to decrement existing key by amount");
            pass("testDecrByAmountExistingKey passed");
        } catch (error) {
            fail("testDecrByAmountExistingKey failed:", error);
        }
    },

    // incr by negative amount
    testIncrByNegativeAmount = async function() {
        try {
            await puter.kv.set('incrKey', 1);
            const result = await puter.kv.incr('incrKey', -5);
            assert(result === -4, "Failed to increment key by negative amount");
            pass("testIncrByNegativeAmount passed");
        } catch (error) {
            fail("testIncrByNegativeAmount failed:", error);
        }
    },

    // decr by negative amount
    testDecrByNegativeAmount = async function() {
        try {
            await puter.kv.set('decrKey', 10);
            const result = await puter.kv.decr('decrKey', -5);
            assert(result === 15, "Failed to decrement key by negative amount");
            pass("testDecrByNegativeAmount passed");
        } catch (error) {
            fail("testDecrByNegativeAmount failed:", error);
        }
    },

    // list keys
    testListKeys = async function() {
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
    },

    // list keys using glob
    testListKeysGlob = async function() {
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
    },
]
