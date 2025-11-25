import { describe, expect, it } from 'vitest';
import { TestKernel } from '../../tools/test.mjs';
import { Core2Module } from '../modules/core/Core2Module.js';
import { WebModule } from '../modules/web/WebModule.js';
import { TestService } from './TestService.js';
describe('testing with TestKernel', () => {
    it('can load TestService within TestKernel', () => {
        const testKernel = new TestKernel();
        testKernel.add_module({
            install: (context) => {
                const services = context.get('services');
                services.registerService('test', TestService);
            },
        });
        testKernel.boot();
        const svc_test = testKernel.services?.get('test');
        expect(svc_test).toBeInstanceOf(TestService);
    });
    it('can load CoreModule within TestKernel', async () => {
        const testKernel = new TestKernel();
        testKernel.add_module(new Core2Module());
        testKernel.add_module(new WebModule());
        testKernel.boot();
        const { services } = testKernel;
        await services.ready;
        const svc_webServer = services?.get('web-server');
        expect(svc_webServer.constructor.name).toBe('WebServerService');
    });
});
//# sourceMappingURL=TestService.test.mjs.map