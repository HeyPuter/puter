const { describe, it, expect, vi, beforeEach } = require('vitest');
const { SystemInfoService } = require('./SystemInfoService');
const os = require('os');
const child_process = require('child_process');

// 1. Mock Node.js built-ins
vi.mock('os');
vi.mock('child_process', () => ({
    exec: vi.fn(),
}));

describe('SystemInfoService', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        vi.resetAllMocks();

        // 2. Setup fake hardware stats
        os.cpus.mockReturnValue([{ model: 'Virtual CPU' }]);
        os.platform.mockReturnValue('linux');
        os.type.mockReturnValue('Linux');
        os.release.mockReturnValue('5.0.0');
        os.loadavg.mockReturnValue([0.1, 0.2, 0.3]);
        os.totalmem.mockReturnValue(8000000); // 8GB
        os.freemem.mockReturnValue(4000000); // 4GB
        os.uptime.mockReturnValue(5000);

        // 3. Setup fake 'df' command
        mockExec = vi.fn();
        child_process.exec = mockExec;

        // 4. Initialize service with fake context
        service = new SystemInfoService({
            services: new Map(),
            config: {},
            context: {},
        });
    });

    it('should return complete system stats', async () => {
        // Mock the output of 'df -k /'
        const dfOutput = 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/root 100000 40000 60000 40% /';

        mockExec.mockImplementation((cmd, callback) => {
            callback(null, dfOutput, '');
        });

        const stats = await service.getStats();

        // Verify the data matches our fakes
        expect(stats.os.platform).toBe('linux');
        expect(stats.cpu.model).toBe('Virtual CPU');
        expect(stats.memory.used).toBe(4000000);
        expect(stats.disk).toEqual({
            total_kb: 100000,
            used_kb: 40000,
            available_kb: 60000,
            usage_percent: '40%',
        });
    });

    it('should handle disk check failures gracefully', async () => {
        // Simulate a crash in the 'df' command
        mockExec.mockImplementation((cmd, callback) => {
            callback(new Error('Command failed'), '', '');
        });

        const stats = await service.getStats();

        // Should still return OS info, but disk should show error
        expect(stats.os.platform).toBe('linux');
        expect(stats.disk).toEqual({ error: 'Unavailable' });
    });
});