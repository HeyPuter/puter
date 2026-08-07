// Focused unit coverage for hot-reload subscription idempotency. The main
// WorkerDriver.test.ts boots a full server where workers aren't Cloudflare-
// configured (so listeners never register); here we drive onServerStart
// directly with a local-server config and a spy event client.
//
// Regression guard for the /drivers/call exposure fix: onServerStart was
// remotely invokable, and each invocation used to stack another set of
// fs.* listeners — so a single caller could multiply every user's
// worker-source save into N edge redeploys. Dispatch is now gated, but the
// subscription must also be structurally idempotent regardless.
import { describe, expect, it, vi } from 'vitest';
import { WorkerDriver } from './WorkerDriver.js';

const build = () => {
    const on = vi.fn();
    const clients = { event: { on } } as any;
    const config = { workers: { localServer: true } } as any;
    const driver = new WorkerDriver(config, clients, {} as any, {} as any);
    return { driver, on };
};

describe('WorkerDriver hot-reload subscription', () => {
    it('registers each fs listener exactly once across repeated onServerStart calls', () => {
        const { driver, on } = build();

        driver.onServerStart();
        driver.onServerStart();
        driver.onServerStart();

        expect(on).toHaveBeenCalledTimes(3);
        expect(on.mock.calls.map((c) => c[0]).sort()).toEqual([
            'fs.move.node',
            'fs.remove.node',
            'fs.write.file',
        ]);
    });
});
