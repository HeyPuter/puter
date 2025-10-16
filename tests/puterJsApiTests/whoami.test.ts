// whoami.test.ts - Tests for Puter Auth whoami module
import { describe, expect, it } from 'vitest';
import { puter } from './testUtils';

describe('Puter Auth whoami Module', () => {
    it('should return admin username', async () => {
        const result = await puter.auth.whoami();
        expect(result.username).to.equal('admin');
    });

    it('should check puter.fs.replica.available every 1 second for 10 seconds', async () => {
        const startTime = Date.now();
        const endTime = startTime + 10000; // 10 seconds
        
        while (Date.now() < endTime) {
            const replicaAvailable = puter.fs.replica.available;
            console.log(`[${new Date().toISOString()}] puter.fs.replica.available:`, replicaAvailable);
            
            // Wait for 1 second before next check
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log('10-second monitoring completed');
    });
});
