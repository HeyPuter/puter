import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { BackendScript, ScriptService } from './ScriptService';

describe('ScriptService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'script': ScriptService,
        },
        initLevelString: 'construct',
    });

    const scriptService = testKernel.services!.get('script') as any;

    it('should be instantiated', () => {
        expect(scriptService).toBeInstanceOf(ScriptService);
    });

    it('should have empty scripts array initially', () => {
        expect(scriptService.scripts).toBeDefined();
        expect(Array.isArray(scriptService.scripts)).toBe(true);
    });

    it('should register a script', () => {
        const initialLength = scriptService.scripts.length;
        const scriptFn = async (ctx: any, args: any[]) => {
            return 'result';
        };
        
        scriptService.register('test-script', scriptFn);
        
        expect(scriptService.scripts.length).toBe(initialLength + 1);
    });

    it('should create BackendScript instance on registration', () => {
        const service = testKernel.services!.get('script') as any;
        const scriptFn = async (ctx: any, args: any[]) => {};
        
        service.register('backend-script', scriptFn);
        
        const lastScript = service.scripts[service.scripts.length - 1];
        expect(lastScript).toBeInstanceOf(BackendScript);
        expect(lastScript.name).toBe('backend-script');
    });

    it('should store script function', () => {
        const service = testKernel.services!.get('script') as any;
        const scriptFn = async (ctx: any, args: any[]) => 'my-result';
        
        service.register('fn-script', scriptFn);
        
        const lastScript = service.scripts[service.scripts.length - 1];
        expect(lastScript.fn).toBe(scriptFn);
    });

    it('should execute registered script', async () => {
        const service = testKernel.services!.get('script') as any;
        let executed = false;
        
        const scriptFn = async (ctx: any, args: any[]) => {
            executed = true;
            return 'executed';
        };
        
        service.register('exec-script', scriptFn);
        const script = service.scripts[service.scripts.length - 1];
        
        const result = await script.run({}, []);
        
        expect(executed).toBe(true);
        expect(result).toBe('executed');
    });

    it('should pass context to script', async () => {
        const service = testKernel.services!.get('script') as any;
        let receivedCtx: any = null;
        
        const scriptFn = async (ctx: any, args: any[]) => {
            receivedCtx = ctx;
        };
        
        service.register('ctx-script', scriptFn);
        const script = service.scripts[service.scripts.length - 1];
        
        const testCtx = { test: 'context' };
        await script.run(testCtx, []);
        
        expect(receivedCtx).toBe(testCtx);
    });

    it('should pass arguments to script', async () => {
        const service = testKernel.services!.get('script') as any;
        let receivedArgs: any[] = [];
        
        const scriptFn = async (ctx: any, args: any[]) => {
            receivedArgs = args;
        };
        
        service.register('args-script', scriptFn);
        const script = service.scripts[service.scripts.length - 1];
        
        const testArgs = ['arg1', 'arg2', 'arg3'];
        await script.run({}, testArgs);
        
        expect(receivedArgs).toEqual(testArgs);
    });

    it('should handle multiple script registrations', () => {
        const service = testKernel.services!.get('script') as any;
        
        service.register('script1', async () => {});
        service.register('script2', async () => {});
        service.register('script3', async () => {});
        
        const scriptNames = service.scripts.map((s: any) => s.name);
        expect(scriptNames).toContain('script1');
        expect(scriptNames).toContain('script2');
        expect(scriptNames).toContain('script3');
    });

    it('should allow scripts to return values', async () => {
        const service = testKernel.services!.get('script') as any;
        
        service.register('return-script', async (ctx: any, args: any[]) => {
            return { success: true, data: args[0] };
        });
        
        const script = service.scripts[service.scripts.length - 1];
        const result = await script.run({}, ['test-data']);
        
        expect(result).toEqual({ success: true, data: 'test-data' });
    });
});

describe('BackendScript', () => {
    it('should create script with name and function', () => {
        const fn = async () => {};
        const script = new BackendScript('test', fn);
        
        expect(script.name).toBe('test');
        expect(script.fn).toBe(fn);
    });

    it('should execute script function', async () => {
        let executed = false;
        const fn = async () => { executed = true; };
        const script = new BackendScript('exec', fn);
        
        await script.run({}, []);
        
        expect(executed).toBe(true);
    });

    it('should pass parameters to function', async () => {
        let receivedCtx: any = null;
        let receivedArgs: any = null;
        
        const fn = async (ctx: any, args: any) => {
            receivedCtx = ctx;
            receivedArgs = args;
        };
        
        const script = new BackendScript('params', fn);
        const ctx = { test: true };
        const args = ['a', 'b'];
        
        await script.run(ctx, args);
        
        expect(receivedCtx).toBe(ctx);
        expect(receivedArgs).toBe(args);
    });

    it('should return function result', async () => {
        const fn = async () => 'result-value';
        const script = new BackendScript('return', fn);
        
        const result = await script.run({}, []);
        
        expect(result).toBe('result-value');
    });
});

