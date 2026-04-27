import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AuditLog } from './audit.js';
import { MCPHub } from './mcp-hub.js';
import { createDemoMCPServers } from './mcp-demo-servers.js';

const tmpFiles: string[] = [];

afterEach(() => {
    tmpFiles.splice(0).forEach(file => {
        try {
            fs.rmSync(file, { force: true });
        } catch {
            // ignore cleanup failures in tests
        }
    });
});

const createHub = () => {
    const auditFile = path.join(os.tmpdir(), `havas-agentic-os-audit-${Date.now()}-${Math.random()}.jsonl`);
    tmpFiles.push(auditFile);
    const audit = new AuditLog(auditFile);
    const hub = new MCPHub(audit);
    createDemoMCPServers().forEach(server => hub.register(server));
    hub.connect({ serverId: 'code', protocol: 'mcp', auth: { token: 'secret-token' }, actor: 'tester' });
    hub.connect({ serverId: 'jira', protocol: 'mcp', auth: { token: 'secret-token' }, actor: 'tester' });
    hub.connect({ serverId: 'confluence', protocol: 'mcp', auth: { token: 'secret-token' }, actor: 'tester' });
    return { audit, hub, auditFile };
};

describe('MCPHub', () => {
    it('allows read tools by default and writes append-only audit events to disk', () => {
        const { hub, auditFile } = createHub();

        const run = hub.callTool({
            serverId: 'code',
            toolName: 'code.search',
            arguments: { query: 'mcp' },
            actor: 'tester',
        });

        expect(run.ok).toBe(true);
        expect(run.permissionDecision).toBe('allowed');
        expect(run.result).toMatchObject({
            server: 'code',
            tool: 'code.search',
        });

        const raw = fs.readFileSync(auditFile, 'utf8');
        expect(raw).toContain('"action":"mcp.tool.call"');
        expect(raw).not.toContain('secret-token');
    });

    it('requires explicit approval for write tools unless approve_once is granted', () => {
        const { hub } = createHub();

        hub.negotiate({
            serverId: 'code',
            permissions: ['code:write'],
            approvalMode: 'approve_per_action',
            actor: 'tester',
        });

        const blocked = hub.callTool({
            serverId: 'code',
            toolName: 'code.runPipeline',
            arguments: { command: 'vitest' },
            actor: 'tester',
        });

        expect(blocked.ok).toBe(false);
        expect(blocked.requiresApproval).toBe(true);

        hub.negotiate({
            serverId: 'code',
            permissions: ['code:write'],
            approvalMode: 'approve_once',
            actor: 'tester',
        });

        const allowed = hub.callTool({
            serverId: 'code',
            toolName: 'code.runPipeline',
            arguments: { command: 'vitest' },
            actor: 'tester',
        });

        expect(allowed.ok).toBe(true);
        expect(allowed.permissionDecision).toBe('approved_once');
    });

    it('keeps Jira reads in evidence-only mode while registering proposal write tools', () => {
        const { hub } = createHub();

        expect(hub.tools().some(tool => tool.name === 'jira.discoveryStatus')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.projectEvidence')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.issueEvidence')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.createIssue')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.transitionIssue')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.addComment')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.assignIssue')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.updateLabels')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'jira.search_issues')).toBe(false);
        expect(hub.tools().some(tool => tool.name === 'jira.getIssue')).toBe(false);
        expect(hub.proposalTools().filter(tool => tool.serverId === 'jira').length).toBe(5);

        const status = hub.callTool({
            serverId: 'jira',
            toolName: 'jira.discoveryStatus',
            actor: 'tester',
        });

        expect(status.ok).toBe(true);
        expect(status.result).toMatchObject({
            cloudId: 'f076a948-b3ae-4495-8f1a-62a4418c1752',
            source: 'atlassian-rovo-mcp',
            available: false,
            degraded: true,
            backendFetchAvailable: false,
            projectCatalogAvailable: false,
            issueDiscoveryAvailable: false,
            evidenceAvailable: true,
        });

        const evidence = hub.callTool({
            serverId: 'jira',
            toolName: 'jira.projectEvidence',
            actor: 'tester',
        });

        expect(evidence.ok).toBe(true);
        expect(evidence.result).toMatchObject({
            evidenceOnly: true,
            source: 'atlassian-rovo-mcp',
        });
        expect((evidence.result as { items: Array<{ key: string }> }).items.map(item => item.key)).toEqual(['SCRUM', 'TES']);

        const issueEvidence = hub.callTool({
            serverId: 'jira',
            toolName: 'jira.issueEvidence',
            actor: 'tester',
        });

        expect(issueEvidence.ok).toBe(true);
        expect((issueEvidence.result as { items: Array<{ key: string }> }).items.map(item => item.key)).toEqual([
            'TES-99',
            'TES-98',
            'TES-97',
            'TES-96',
            'TES-95',
        ]);
    });

    it('routes Jira write tools through the proposal-and-approval flow', () => {
        const { hub } = createHub();

        hub.negotiate({
            serverId: 'jira',
            permissions: ['jira:write'],
            approvalMode: 'approve_per_action',
            actor: 'tester',
        });

        const blocked = hub.callTool({
            serverId: 'jira',
            toolName: 'jira.createIssue',
            arguments: { projectKey: 'HAOS', summary: 'Test issue' },
            actor: 'tester',
        });

        expect(blocked.ok).toBe(false);
        expect(blocked.requiresApproval).toBe(true);
        expect(blocked.approvalScope).toBe('mcp:jira.createIssue');

        hub.negotiate({
            serverId: 'jira',
            permissions: ['jira:write'],
            approvalMode: 'approve_once',
            actor: 'tester',
        });

        const proposed = hub.callTool({
            serverId: 'jira',
            toolName: 'jira.createIssue',
            arguments: { projectKey: 'HAOS', summary: 'Test issue' },
            actor: 'tester',
        });

        expect(proposed.ok).toBe(true);
        expect(proposed.proposal).toBeDefined();
        expect(proposed.proposal?.proposalId).toBeTruthy();
        expect(proposed.proposal?.description).toContain('Propose creating a new Jira issue');
        expect(proposed.result).toMatchObject({ proposal: true });
        expect((proposed.result as { proposal: boolean; message: string }).message).toContain('No live Jira write was executed');
        expect(hub.proposals().length).toBe(1);
        expect(hub.proposals()[0].toolName).toBe('jira.createIssue');
    });

    it('degrades confluence discovery while keeping status reads available', () => {
        const { hub } = createHub();

        expect(hub.tools().some(tool => tool.name === 'confluence.discoveryStatus')).toBe(true);
        expect(hub.tools().some(tool => tool.name === 'confluence.search')).toBe(false);

        const status = hub.callTool({
            serverId: 'confluence',
            toolName: 'confluence.discoveryStatus',
            actor: 'tester',
        });

        expect(status.ok).toBe(true);
        expect(status.result).toMatchObject({
            available: false,
            degraded: true,
            status: 'blocked',
            cloudId: 'f076a948-b3ae-4495-8f1a-62a4418c1752',
            discoveryAvailable: false,
            viewerAvailable: false,
            searchAvailable: false,
        });
    });
});
