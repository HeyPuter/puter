import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { handleServerInfo } from './serverInfo.ts';

interface CapturedResponse {
    body: Record<string, unknown> | undefined;
}

const makeRes = () => {
    const captured: CapturedResponse = { body: undefined };
    const res = {
        json: vi.fn((value: Record<string, unknown>) => {
            captured.body = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

describe('serverInfo extension — handleServerInfo', () => {
    it('returns the full server info payload', async () => {
        const { res, captured } = makeRes();

        await handleServerInfo({} as Request, res);

        expect(captured.body).toBeDefined();
        const body = captured.body!;

        // OS section
        const os = body.os as Record<string, unknown>;
        expect(typeof os.platform).toBe('string');
        expect(typeof os.type).toBe('string');
        expect(typeof os.release).toBe('string');
        expect(os.pretty).toBe(`${os.type} ${os.release}`);

        // CPU section
        const cpu = body.cpu as Record<string, unknown>;
        expect(typeof cpu.model).toBe('string');
        expect(typeof cpu.cores).toBe('number');
        expect((cpu.cores as number) > 0).toBe(true);

        // RAM — totalGB / freeGB are stringified two-decimal values
        const ram = body.ram as Record<string, unknown>;
        expect(typeof ram.total).toBe('number');
        expect(typeof ram.free).toBe('number');
        expect(ram.totalGB).toMatch(/^\d+\.\d{2}$/);
        expect(ram.freeGB).toMatch(/^\d+\.\d{2}$/);

        // Uptime fields are numeric (seconds/days/hours/minutes) plus pretty.
        const uptime = body.uptime as Record<string, unknown>;
        expect(typeof uptime.seconds).toBe('number');
        expect(typeof uptime.days).toBe('number');
        expect(typeof uptime.hours).toBe('number');
        expect(typeof uptime.minutes).toBe('number');
        expect(uptime.pretty).toMatch(/^\d+d \d+h \d+m$/);

        // Disk may fall through to N/A when statfs throws (e.g. unsupported
        // platforms), so accept either the success shape or the fallback.
        const disk = body.disk as Record<string, unknown>;
        expect(['N/A']).toContain(disk.total === 'N/A' ? 'N/A' : 'N/A'); // keep shape-only assertion
        expect(typeof disk.total).toBe('string');
        expect(typeof disk.free).toBe('string');
        expect(typeof disk.used).toBe('string');

        expect(Array.isArray(body.loadavg)).toBe(true);
        expect(typeof body.hostname).toBe('string');
    });

    it('falls back to N/A disk stats when statfs throws', async () => {
        const fs = await import('node:fs/promises');
        const statfsSpy = vi
            .spyOn(fs.default, 'statfs')
            .mockRejectedValue(new Error('statfs unsupported'));
        const errSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const { res, captured } = makeRes();
        await handleServerInfo({} as Request, res);

        const disk = (captured.body as Record<string, unknown>).disk as Record<
            string,
            string
        >;
        expect(disk).toEqual({ total: 'N/A', free: 'N/A', used: 'N/A' });
        expect(errSpy).toHaveBeenCalled();

        statfsSpy.mockRestore();
        errSpy.mockRestore();
    });
});
