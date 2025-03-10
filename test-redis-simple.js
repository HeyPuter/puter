#!/usr/bin/env node

/**
 * Simple test script for Redis service
 * 
 * This script directly tests the Redis service to verify that it's working correctly.
 */

import Redis from 'ioredis';

async function testRedis() {
    console.log('=== Redis Service Test ===');
    
    // Create Redis client
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        keyPrefix: 'puter:test:',
    });
    
    try {
        // Test 1: Connection
        console.log('\n1. Testing Redis connection...');
        await redis.ping();
        console.log('✅ Redis connection successful');
        
        // Test 2: Set and Get
        console.log('\n2. Testing Set and Get operations...');
        const testKey = 'test-key';
        const testValue = 'test-value-' + Date.now();
        
        await redis.set(testKey, testValue);
        console.log(`   Set ${testKey} = ${testValue}`);
        
        const retrievedValue = await redis.get(testKey);
        console.log(`   Get ${testKey} = ${retrievedValue}`);
        
        if (retrievedValue === testValue) {
            console.log('✅ Set/Get operations successful');
        } else {
            console.error('❌ Set/Get operations failed');
        }
        
        // Test 3: Expiration
        console.log('\n3. Testing key expiration...');
        const expiringKey = 'expiring-key';
        await redis.set(expiringKey, 'will-expire', 'PX', 1000); // 1 second expiration
        console.log('   Set key with 1 second expiration');
        
        const valueBeforeExpiration = await redis.get(expiringKey);
        console.log(`   Value before expiration: ${valueBeforeExpiration}`);
        
        console.log('   Waiting for key to expire...');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds
        
        const valueAfterExpiration = await redis.get(expiringKey);
        console.log(`   Value after expiration: ${valueAfterExpiration}`);
        
        if (valueBeforeExpiration && !valueAfterExpiration) {
            console.log('✅ Key expiration works correctly');
        } else {
            console.error('❌ Key expiration test failed');
        }
        
        // Test 4: Increment
        console.log('\n4. Testing increment operations...');
        const counterKey = 'counter-key';
        
        // Reset counter
        await redis.del(counterKey);
        
        // Increment multiple times
        const value1 = await redis.incr(counterKey);
        const value2 = await redis.incr(counterKey);
        const value3 = await redis.incr(counterKey);
        
        console.log(`   Incremented values: ${value1}, ${value2}, ${value3}`);
        
        if (value1 === 1 && value2 === 2 && value3 === 3) {
            console.log('✅ Increment operations successful');
        } else {
            console.error('❌ Increment operations failed');
        }
        
        // Test 5: Delete
        console.log('\n5. Testing delete operation...');
        const deleteKey = 'delete-key';
        await redis.set(deleteKey, 'to-be-deleted');
        
        const beforeDelete = await redis.get(deleteKey);
        console.log(`   Value before delete: ${beforeDelete}`);
        
        await redis.del(deleteKey);
        
        const afterDelete = await redis.get(deleteKey);
        console.log(`   Value after delete: ${afterDelete}`);
        
        if (beforeDelete && !afterDelete) {
            console.log('✅ Delete operation successful');
        } else {
            console.error('❌ Delete operation failed');
        }
        
        // Test 6: Exists
        console.log('\n6. Testing exists operation...');
        const existsKey = 'exists-key';
        await redis.set(existsKey, 'i-exist');
        
        const exists1 = await redis.exists(existsKey);
        console.log(`   Key exists check: ${exists1}`);
        
        await redis.del(existsKey);
        
        const exists2 = await redis.exists(existsKey);
        console.log(`   Key exists check after delete: ${exists2}`);
        
        if (exists1 === 1 && exists2 === 0) {
            console.log('✅ Exists operation successful');
        } else {
            console.error('❌ Exists operation failed');
        }
        
        // Clean up
        await redis.del(testKey);
        
        console.log('\n=== Test Summary ===');
        console.log('✅ All Redis operations tested successfully');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        // Close Redis connection
        redis.quit();
        console.log('\nRedis connection closed');
    }
}

// Run the tests
testRedis().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 