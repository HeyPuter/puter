import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { HelloWorldService } from './HelloWorldService';

describe('HelloWorldService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'hello-world': HelloWorldService,
        },
        initLevelString: 'init',
    });

    const helloWorldService = testKernel.services!.get('hello-world') as any;

    it('should be instantiated', () => {
        expect(helloWorldService).toBeInstanceOf(HelloWorldService);
    });

    it('should return version', () => {
        const version = helloWorldService.as('version').get_version();
        expect(version).toBe('v1.0.0');
    });

    it('should greet without subject', async () => {
        const greeting = await helloWorldService.as('hello-world').greet({});
        expect(greeting).toBe('Hello, World!');
    });

    it('should greet with subject', async () => {
        const greeting = await helloWorldService.as('hello-world').greet({ subject: 'Alice' });
        expect(greeting).toBe('Hello, Alice!');
    });

    it('should greet with different subjects', async () => {
        const greeting1 = await helloWorldService.as('hello-world').greet({ subject: 'Bob' });
        const greeting2 = await helloWorldService.as('hello-world').greet({ subject: 'Charlie' });
        
        expect(greeting1).toBe('Hello, Bob!');
        expect(greeting2).toBe('Hello, Charlie!');
    });
});

