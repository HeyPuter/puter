#!/usr/bin/env node
/**
 * Automated test suite for self-hosted S3/RustFS CORS configuration (Issue #3379).
 *
 * Validates:
 *  1. docker-compose.yml s3-init service configuration and CORS policy generation.
 *  2. HTTP default domain origin generation (puter.localhost and subdomains).
 *  3. HTTPS custom domain origin generation (example.com and subdomains).
 *  4. Allowed methods (GET, HEAD, PUT, POST, DELETE).
 *  5. Allowed headers (wildcard [*]).
 *  6. Exposed headers (ETag, x-amz-request-id) and MaxAgeSeconds (3600).
 *  7. Negative CORS authorization checks (no wildcard origin, rejection of evil origins).
 *  8. Browser OPTIONS preflight simulation (positive and negative).
 *  9. Idempotent initialization logic (new bucket vs existing bucket).
 * 10. Installer configuration consistency (install.sh, install.ps1, .env.example, doc/self-hosting.md).
 *
 * Usage:
 *   node tools/test-s3-cors.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_PATH = path.join(ROOT_DIR, 'docker-compose.yml');
const INSTALL_SH_PATH = path.join(ROOT_DIR, 'install.sh');
const INSTALL_PS1_PATH = path.join(ROOT_DIR, 'install.ps1');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');
const DOC_PATH = path.join(ROOT_DIR, 'doc', 'self-hosting.md');

/**
 * Parses the CORS JSON template embedded inside docker-compose.yml s3-init entrypoint
 * and interpolates PUTER_PROTOCOL and PUTER_DOMAIN variables.
 */
function extractAndRenderCorsJson(protocol, domain) {
    const composeContent = fs.readFileSync(COMPOSE_PATH, 'utf8');

    // Extract the cat > /tmp/cors.json <<EOF ... EOF block
    const match = composeContent.match(/cat\s*>\s*\/tmp\/cors\.json\s*<<\s*EOF\s*\n([\s\S]*?)\n\s*EOF/);
    assert.ok(match, 'docker-compose.yml must contain cat > /tmp/cors.json <<EOF block');

    const template = match[1];

    // Substitute $${PUTER_PROTOCOL} and $${PUTER_DOMAIN} as evaluated by compose -> shell
    const rendered = template
        .replace(/\$\$\{PUTER_PROTOCOL\}|\$\{PUTER_PROTOCOL\}/g, protocol)
        .replace(/\$\$\{PUTER_DOMAIN\}|\$\{PUTER_DOMAIN\}/g, domain);

    const corsConfig = JSON.parse(rendered);
    return corsConfig;
}

/**
 * Simulates a browser CORS preflight check against S3 CORS rules.
 */
function evaluatePreflight(corsRule, { origin, method, headers = [] }) {
    // 1. Origin match
    const originAllowed = corsRule.AllowedOrigins.includes(origin) || corsRule.AllowedOrigins.includes('*');
    if (!originAllowed) {
        return { allowed: false, reason: 'Origin not allowed' };
    }

    // 2. Method match
    const methodAllowed = corsRule.AllowedMethods.includes(method.toUpperCase());
    if (!methodAllowed) {
        return { allowed: false, reason: 'Method not allowed' };
    }

    // 3. Headers match
    const headersAllowed = corsRule.AllowedHeaders.includes('*') ||
        headers.every(h => corsRule.AllowedHeaders.map(x => x.toLowerCase()).includes(h.toLowerCase()));
    if (!headersAllowed) {
        return { allowed: false, reason: 'Headers not allowed' };
    }

    return {
        allowed: true,
        allowOrigin: origin,
        allowMethods: corsRule.AllowedMethods,
        allowHeaders: corsRule.AllowedHeaders,
        exposeHeaders: corsRule.ExposeHeaders || [],
        maxAge: corsRule.MaxAgeSeconds
    };
}

describe('Self-Hosted S3/RustFS CORS Configuration (#3379)', () => {

    describe('1. Default HTTP Domain Origin Generation', () => {
        const corsConfig = extractAndRenderCorsJson('http', 'puter.localhost');
        const rule = corsConfig.CORSRules[0];

        it('generates the expected set of allowed origins', () => {
            const expectedOrigins = [
                'http://puter.localhost',
                'http://api.puter.localhost',
                'http://app.puter.localhost',
                'http://site.puter.localhost',
                'http://dev.puter.localhost',
                'http://host.puter.localhost',
            ];

            assert.deepEqual(rule.AllowedOrigins, expectedOrigins);
        });

        it('does NOT contain wildcard origin (*)', () => {
            assert.ok(!rule.AllowedOrigins.includes('*'), 'AllowedOrigins must not contain wildcard *');
        });

        it('does NOT allow unauthorized external origins', () => {
            assert.ok(!rule.AllowedOrigins.includes('https://evil.example.com'));
            assert.ok(!rule.AllowedOrigins.includes('http://attacker.localhost'));
            assert.ok(!rule.AllowedOrigins.includes('http://localhost:3000'));
        });
    });

    describe('2. Custom HTTPS Domain Origin Generation', () => {
        const corsConfig = extractAndRenderCorsJson('https', 'example.com');
        const rule = corsConfig.CORSRules[0];

        it('generates HTTPS origins for custom domain and subdomains', () => {
            const expectedOrigins = [
                'https://example.com',
                'https://api.example.com',
                'https://app.example.com',
                'https://site.example.com',
                'https://dev.example.com',
                'https://host.example.com',
            ];

            assert.deepEqual(rule.AllowedOrigins, expectedOrigins);
        });

        it('does NOT include plain http:// origins when protocol is https', () => {
            const hasHttp = rule.AllowedOrigins.some(origin => origin.startsWith('http://'));
            assert.equal(hasHttp, false, 'HTTPS configuration must not contain http:// origins');
        });
    });

    describe('3. Allowed Methods, Headers, and ExposeHeaders', () => {
        const corsConfig = extractAndRenderCorsJson('http', 'puter.localhost');
        const rule = corsConfig.CORSRules[0];

        it('includes all standard S3 methods including PUT for presigned uploads', () => {
            assert.ok(rule.AllowedMethods.includes('PUT'), 'AllowedMethods must include PUT');
            assert.ok(rule.AllowedMethods.includes('GET'), 'AllowedMethods must include GET');
            assert.ok(rule.AllowedMethods.includes('HEAD'), 'AllowedMethods must include HEAD');
            assert.ok(rule.AllowedMethods.includes('POST'), 'AllowedMethods must include POST');
            assert.ok(rule.AllowedMethods.includes('DELETE'), 'AllowedMethods must include DELETE');
        });

        it('allows wildcard headers [*] required for presigned S3 uploads', () => {
            assert.deepEqual(rule.AllowedHeaders, ['*']);
        });

        it('exposes critical response headers (ETag, x-amz-request-id)', () => {
            assert.ok(rule.ExposeHeaders.includes('ETag'), 'ExposeHeaders must include ETag');
            assert.ok(rule.ExposeHeaders.includes('x-amz-request-id'), 'ExposeHeaders must include x-amz-request-id');
        });

        it('sets MaxAgeSeconds to 3600 for optimal preflight caching', () => {
            assert.equal(rule.MaxAgeSeconds, 3600);
        });
    });

    describe('4. Simulated Browser OPTIONS Preflight', () => {
        const corsConfig = extractAndRenderCorsJson('http', 'puter.localhost');
        const rule = corsConfig.CORSRules[0];

        it('succeeds for valid frontend origin requesting PUT with content-type', () => {
            const preflight = evaluatePreflight(rule, {
                origin: 'http://puter.localhost',
                method: 'PUT',
                headers: ['content-type']
            });

            assert.equal(preflight.allowed, true);
            assert.equal(preflight.allowOrigin, 'http://puter.localhost');
            assert.ok(preflight.allowMethods.includes('PUT'));
            assert.ok(preflight.exposeHeaders.includes('ETag'));
        });

        it('succeeds for subdomain origin requesting PUT with custom headers', () => {
            const preflight = evaluatePreflight(rule, {
                origin: 'http://app.puter.localhost',
                method: 'PUT',
                headers: ['content-type', 'x-amz-meta-custom']
            });

            assert.equal(preflight.allowed, true);
            assert.equal(preflight.allowOrigin, 'http://app.puter.localhost');
        });

        it('rejects unauthorized origin in preflight', () => {
            const preflight = evaluatePreflight(rule, {
                origin: 'https://evil.example.com',
                method: 'PUT',
                headers: ['content-type']
            });

            assert.equal(preflight.allowed, false);
            assert.equal(preflight.reason, 'Origin not allowed');
        });

        it('rejects unauthorized HTTP method in preflight', () => {
            const preflight = evaluatePreflight(rule, {
                origin: 'http://puter.localhost',
                method: 'PATCH',
                headers: ['content-type']
            });

            assert.equal(preflight.allowed, false);
            assert.equal(preflight.reason, 'Method not allowed');
        });
    });

    describe('5. s3-init Script Idempotency', () => {
        const composeContent = fs.readFileSync(COMPOSE_PATH, 'utf8');

        it('passes PUTER_DOMAIN and PUTER_PROTOCOL environment variables to s3-init', () => {
            assert.match(composeContent, /PUTER_DOMAIN:\s*\$\{PUTER_DOMAIN:-puter\.localhost\}/);
            assert.match(composeContent, /PUTER_PROTOCOL:\s*\$\{PUTER_PROTOCOL:-http\}/);
        });

        it('does not exit early when bucket already exists', () => {
            // Check that in the head-bucket branch, it does not exit 0 before put-bucket-cors
            const headBucketMatch = composeContent.match(/if aws --endpoint-url "\$\$endpoint" s3api head-bucket[\s\S]*?fi/);
            assert.ok(headBucketMatch, 'head-bucket check must be present');
            assert.ok(!headBucketMatch[0].includes('exit 0'), 'Existing bucket branch must NOT exit early');
        });

        it('applies put-bucket-cors after bucket verification/creation', () => {
            assert.match(composeContent, /aws --endpoint-url "\$\$endpoint" s3api put-bucket-cors/);
            assert.match(composeContent, /--cors-configuration file:\/\/\/tmp\/cors\.json/);
        });
    });

    describe('6. Installer Configuration Consistency', () => {
        it('install.sh writes PUTER_DOMAIN and PUTER_PROTOCOL to .env', () => {
            const installSh = fs.readFileSync(INSTALL_SH_PATH, 'utf8');
            assert.match(installSh, /PUTER_DOMAIN=\$PUTER_DOMAIN/);
            assert.match(installSh, /PUTER_PROTOCOL=\$PUTER_PROTOCOL/);
        });

        it('install.ps1 writes PUTER_DOMAIN and PUTER_PROTOCOL to .env', () => {
            const installPs1 = fs.readFileSync(INSTALL_PS1_PATH, 'utf8');
            assert.match(installPs1, /PUTER_DOMAIN=\$PuterDomain/);
            assert.match(installPs1, /PUTER_PROTOCOL=\$PuterProtocol/);
            assert.match(installPs1, /protocol\s*=\s*\$PuterProtocol/);
            assert.match(installPs1, /publicEndpoint\s*=\s*"\$\{PuterProtocol\}:\/\/s3\.\$PuterDomain"/);
        });

        it('.env.example documents PUTER_DOMAIN and PUTER_PROTOCOL', () => {
            const envExample = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
            assert.match(envExample, /PUTER_DOMAIN=puter\.localhost/);
            assert.match(envExample, /PUTER_PROTOCOL=http/);
        });

        it('doc/self-hosting.md explains PUTER_DOMAIN, PUTER_PROTOCOL, and S3 CORS', () => {
            const doc = fs.readFileSync(DOC_PATH, 'utf8');
            assert.match(doc, /PUTER_DOMAIN=puter\.localhost/);
            assert.match(doc, /PUTER_PROTOCOL=http/);
            assert.match(doc, /PUTER_DOMAIN=example\.com/);
            assert.match(doc, /PUTER_PROTOCOL=https/);
            assert.match(doc, /s3-init/);
            assert.match(doc, /CORS/);
        });
    });
});
