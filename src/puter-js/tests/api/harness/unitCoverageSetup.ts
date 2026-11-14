import { createHash } from 'node:crypto';
import { afterAll, expect } from 'vitest';
import { writeCoverageShard, type IstanbulCoverage } from './coverage.ts';

type CoverageScope = { __coverage__?: IstanbulCoverage };

// Coverage-mode setup file: writes the counters each unit test file left on
// the global as a shard of its own. Runner files leave none there.
afterAll(async () => {
    const scope = globalThis as CoverageScope & { self?: CoverageScope };
    const coverage = scope.__coverage__ ?? scope.self?.__coverage__;
    const testPath = expect.getState().testPath;
    if (!coverage || !testPath) return;
    const id = createHash('sha1').update(testPath).digest('hex').slice(0, 12);
    await writeCoverageShard(`unit-${id}`, [coverage]);
});
