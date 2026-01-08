import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { EventService } from './EventService';

describe('EventService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'event-test': EventService,
        },
        initLevelString: 'init',
    });

    const eventService = testKernel.services!.get('event-test') as EventService;

    it('should be instantiated', () => {
        expect(eventService).toBeInstanceOf(EventService);
    });

    it('should emit and receive events', async () => {
        let received = false;
        eventService.on('test.event', () => {
            received = true;
        });
        
        await eventService.emit('test.event', {});
        expect(received).toBe(true);
    });

    it('should pass data to event listeners', async () => {
        let receivedData: any = null;
        eventService.on('data.event', (key, data) => {
            receivedData = data;
        });
        
        await eventService.emit('data.event', { value: 42 });
        expect(receivedData).toEqual({ value: 42 });
    });

    it('should support wildcard listeners', async () => {
        const received: string[] = [];
        eventService.on('wild.*', (key) => {
            received.push(key);
        });
        
        await eventService.emit('wild.test1', {});
        await eventService.emit('wild.test2', {});
        
        expect(received).toContain('wild.test1');
        expect(received).toContain('wild.test2');
    });

    it('should support multiple listeners on same event', async () => {
        let count = 0;
        eventService.on('multi.event', () => { count++; });
        eventService.on('multi.event', () => { count++; });
        
        await eventService.emit('multi.event', {});
        expect(count).toBe(2);
    });

    it('should detach listeners', async () => {
        let count = 0;
        const det = eventService.on('detach.event', () => { count++; });
        
        await eventService.emit('detach.event', {});
        expect(count).toBe(1);
        
        det.detach();
        await eventService.emit('detach.event', {});
        expect(count).toBe(1); // Should still be 1
    });

    it('should support global listeners', async () => {
        let globalReceived = false;
        eventService.on_all(() => {
            globalReceived = true;
        });
        
        await eventService.emit('any.event', {});
        expect(globalReceived).toBe(true);
    });

    it('should create scoped event bus', () => {
        const scoped = eventService.get_scoped('test.scope');
        expect(scoped).toBeDefined();
        expect(scoped.scope).toBe('test.scope');
    });

    it('should emit events through scoped bus', async () => {
        let received = false;
        eventService.on('scope.test.event', () => {
            received = true;
        });
        
        const scoped = eventService.get_scoped('scope.test');
        await scoped.emit('event', {});
        expect(received).toBe(true);
    });
});

