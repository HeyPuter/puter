/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
const express = require('express');

const router = new express.Router();
const jsonBody = express.json({ limit: '1mb' });

let corePromise;
const getCore = async () => {
    if ( ! corePromise ) {
        corePromise = import('../havas-agentic-os/index.js').then(mod => mod.havasAgenticOS);
    }
    return corePromise;
};

const ok = (res, data = {}) => res.json({ ok: true, ...data });

const handle = fn => async (req, res) => {
    try {
        return await fn(req, res, await getCore());
    } catch ( error ) {
        const code = error?.message || 'havas_agentic_os_error';
        return res.status(400).json({ ok: false, code });
    }
};

const glyphFor = value => String(value || '')
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const ATLASSIAN_SITE = {
    cloudId: process.env.HAVAS_ATLASSIAN_CLOUD_ID || 'f076a948-b3ae-4495-8f1a-62a4418c1752',
    name: process.env.HAVAS_ATLASSIAN_SITE_NAME || 'waltzai',
    url: process.env.HAVAS_ATLASSIAN_SITE_URL || 'https://waltzai.atlassian.net',
    jiraProjectsAvailable: true,
    rovoSearchAvailable: false,
    confluenceDiscoveryAvailable: false,
};

const JIRA_CATALOG = {
    importedAt: '2026-04-27T00:00:00.000Z',
    source: 'atlassian-rovo-mcp',
    note: 'Operator-verified Atlassian MCP evidence imported during development. This backend service does not fetch live Jira project state.',
};
const JIRA_AVAILABILITY = {
    backendFetchAvailable: false,
    projectCatalogAvailable: false,
    issueDiscoveryAvailable: false,
    writeAvailable: false,
    evidenceAvailable: true,
    blockedReason: 'The backend service has no live Atlassian MCP bridge for Jira project reads, issue discovery, or Jira writes. Only imported operator-verified MCP evidence is available.',
};

const mcpConnection = (core, serverId) => core?.mcp?.clients?.get(serverId) || null;
const mcpToolsFor = (core, serverId) => core?.mcp?.tools?.().filter(tool => tool.serverId === serverId) || [];
const hasMCPTool = (core, toolName) => core.mcp.tools().some(tool => tool.name === toolName);

const atlassianAvailability = (core, surface, status = {}) => {
    const connection = mcpConnection(core, surface);
    const connected = connection?.status === 'connected';
    if ( surface === 'jira' ) {
        const toolNames = mcpToolsFor(core, 'jira').map(tool => tool.name);
        const allTools = mcpToolsFor(core, 'jira');
        const backendFetchAvailable = Boolean(status.backendFetchAvailable ?? JIRA_AVAILABILITY.backendFetchAvailable);
        const projectsAvailable = Boolean(status.projectCatalogAvailable ?? JIRA_AVAILABILITY.projectCatalogAvailable);
        const searchAvailable = Boolean(status.issueDiscoveryAvailable ?? JIRA_AVAILABILITY.issueDiscoveryAvailable);
        const evidenceAvailable = Boolean(status.evidenceAvailable ?? JIRA_AVAILABILITY.evidenceAvailable);
        const writeAvailable = Boolean(status.writeAvailable ?? JIRA_AVAILABILITY.writeAvailable);
        const proposalWriteTools = allTools.filter(tool => tool.write && tool.proposalDescription);
        return {
            cloudId: ATLASSIAN_SITE.cloudId,
            connected,
            status: connected ? (backendFetchAvailable ? 'available' : 'blocked') : 'disconnected',
            backendFetchAvailable,
            projects: projectsAvailable,
            search: searchAvailable,
            evidenceAvailable,
            evidenceImportedAt: status.importedAt || JIRA_CATALOG.importedAt,
            evidenceSource: status.source || JIRA_CATALOG.source,
            readTools: toolNames.filter(name => name.startsWith('jira.')),
            writeTools: proposalWriteTools.map(tool => tool.name),
            proposalWriteTools: proposalWriteTools.map(tool => ({
                name: tool.name,
                description: tool.proposalDescription,
            })),
            degraded: !connected || !backendFetchAvailable,
            searchReason: searchAvailable
                ? 'Live Jira issue discovery is available.'
                : JIRA_AVAILABILITY.blockedReason,
            blockedReason: JIRA_AVAILABILITY.blockedReason,
            writeAvailable,
            writePath: 'proposal',
            writePathNote: 'Jira write tools are first-class proposal-and-approval flows. No live Atlassian write is executed. Proposals are recorded in the audit log and require approval.',
        };
    }

    const toolNames = mcpToolsFor(core, 'confluence').map(tool => tool.name);
    const discovery = Boolean(status.discoveryAvailable ?? toolNames.includes('confluence.listSpaces'));
    const viewer = Boolean(status.viewerAvailable ?? status.pageReadAvailable ?? toolNames.includes('confluence.getPage'));
    const search = Boolean(status.searchAvailable ?? toolNames.includes('confluence.search'));
    const writeTools = toolNames.filter(name => name === 'confluence.createPage' || name === 'confluence.updatePage');
    const blockedReason = status.reason || (discovery
        ? 'Confluence discovery is available through Atlassian MCP.'
        : 'Confluence discovery is blocked because the app/search surface is unavailable on this instance.');
    return {
        cloudId: ATLASSIAN_SITE.cloudId,
        connected,
        status: connected ? (discovery ? 'available' : 'blocked') : 'disconnected',
        discovery,
        viewer,
        search,
        readTools: toolNames.filter(name => !writeTools.includes(name)),
        writeTools,
        degraded: !connected || !discovery,
        blockedReason,
    };
};

const mcpApprovalRows = core => {
    const writeToolCounts = core.mcp.tools().reduce((acc, tool) => {
        if ( tool.write ) acc[tool.serverId] = (acc[tool.serverId] || 0) + 1;
        return acc;
    }, {});
    return core.mcp.clients.list().flatMap(connection => (
        connection.requestedPermissions.map(permission => {
            const isWrite = permission.endsWith(':write');
            const granted = connection.grantedPermissions.includes(permission);
            return {
                id: `${connection.serverId}:${permission}`,
                title: `${connection.serverId.toUpperCase()} ${permission}`,
                state: granted ? 'Approved' : isWrite ? `Pending (${connection.approvalMode})` : 'Read only',
                statusTone: granted ? 'good' : isWrite ? 'warn' : 'neutral',
                owner: connection.serverId.toUpperCase(),
                approvalMode: connection.approvalMode,
                approvalScope: permission,
                detail: isWrite
                    ? `${writeToolCounts[connection.serverId] || 0} write tool${(writeToolCounts[connection.serverId] || 0) === 1 ? '' : 's'} gated by ${connection.approvalMode}.`
                    : 'Read capability available through MCP.',
            };
        })
    ));
};

const dashboardPayload = core => {
    const agents = core.registry.list();
    const submissions = core.publish.list();
    const permissions = core.permissions.list();
    const tasks = core.tasks.list();
    const audits = core.audit.query({ limit: 25 });
    const agentCards = agents.map(agent => ({
        id: agent.id,
        title: agent.name,
        kind: `${agent.category} agent ${agent.status}`,
        status: agent.status,
        statusTone: agent.status === 'running' ? 'warn' : agent.status === 'installed' ? 'good' : 'neutral',
        owner: agent.category,
        metric: agent.version,
        glyph: glyphFor(agent.name),
        summary: agent.summary,
        version: agent.version,
    }));
    const devRows = submissions.map(submission => ({
        id: submission.id,
        title: `${submission.name} ${submission.version}`,
        status: submission.status,
        statusTone: submission.status === 'published' || submission.status === 'approved' ? 'good' : submission.status === 'rejected' ? 'bad' : 'warn',
        owner: submission.reviewer || 'Dev Center',
        summary: submission.notes,
        phase: submission.status,
    }));
    const permissionRows = permissions.map(permission => ({
        id: permission.id,
        title: `${permission.agentId} / ${permission.scope}`,
        scope: permission.scope,
        status: permission.status,
        statusTone: permission.status === 'approved' ? 'good' : permission.status === 'revoked' ? 'bad' : 'warn',
        summary: permission.reason,
        actor: permission.actor,
    }));
    const auditRows = audits.map(event => ({
        id: event.id,
        title: event.action,
        status: 'Logged',
        statusTone: 'neutral',
        actor: event.actor,
        summary: `${event.target} / ${event.createdAt}`,
    }));
    const taskRows = tasks.map(task => ({
        id: task.id,
        title: task.title,
        state: task.status,
        status: task.status,
        statusTone: task.status === 'completed' ? 'good' : task.status === 'failed' ? 'bad' : 'warn',
        actor: task.agentId,
        summary: task.result?.message || `${task.progress}% complete`,
        phase: task.status,
    }));

    return {
        'app-center': {
            home: agentCards,
            myApps: agentCards.filter(agent => agent.status !== 'available'),
            wishlist: agentCards.filter(agent => agent.status === 'available'),
            myReviews: auditRows,
        },
        'dev-center': {
            createApp: devRows.filter(row => row.phase === 'draft' || row.phase === 'submitted'),
            createWorker: devRows.filter(row => row.phase === 'approved'),
            reviewQueue: devRows.filter(row => row.phase === 'submitted' || row.phase === 'rejected'),
        },
        marketplace: {
            featured: agentCards,
            agentTools: agentCards.filter(agent => agent.kind.includes('agent')),
            installed: agentCards.filter(agent => agent.status !== 'available'),
            requests: permissionRows.filter(row => row.status !== 'approved').concat(mcpApprovalRows(core).filter(row => row.state !== 'Approved')),
            system: agentCards.filter(agent => agent.owner === 'operations' || agent.owner === 'memory'),
        },
        settings: {
            permissions: permissionRows.concat(mcpApprovalRows(core)),
            logs: auditRows,
            memory: core.memory.list().map(record => ({
                id: `${record.namespace}:${record.key}`,
                title: record.key,
                scope: record.namespace,
                status: 'Remembered',
                statusTone: 'neutral',
                summary: JSON.stringify(record.value),
            })),
        },
        'task-monitor': {
            plan: taskRows.filter(row => row.phase === 'queued'),
            act: taskRows.filter(row => row.phase === 'running'),
            observe: taskRows.filter(row => row.phase === 'completed' || row.phase === 'failed'),
        },
    };
};

const codeWorkspacePayload = () => ({
    files: [
        { path: 'src/gui/src/UI/UICXOSDesktop.js', type: 'js', status: 'modified' },
        { path: 'src/backend/src/havas-agentic-os/mcp-hub.ts', type: 'ts', status: 'new' },
        { path: 'src/backend/src/routers/havas-agentic-os.js', type: 'js', status: 'modified' },
    ],
    file: {
        path: 'src/backend/src/havas-agentic-os/mcp-hub.ts',
        body: 'MCP Hub exposes tools, capabilities, connect, health, permission negotiation, and audited tool calls.',
        status: 'Read through CODE MCP demo adapter',
    },
    diff: [
        { file: 'mcp-hub.ts', change: '+ MCP client registry, capability list, permission negotiation' },
        { file: 'mcp-demo-servers.ts', change: '+ CODE/JIRA/CONFLUENCE MCP adapters' },
        { file: 'UICXOSDesktop.js', change: '+ MCP windows and command palette' },
    ],
    history: [
        { id: 'mcp-1', title: 'MCP Hub integrated', author: 'Backend Builder', time: 'now' },
        { id: 'ui-1', title: 'MCP-first desktop apps', author: 'UI Builder', time: 'now' },
    ],
    search: [
        { file: 'havas-agentic-os.js', line: 145, text: '/api/havas-agentic-os/mcp/tools' },
        { file: 'UICXOSDesktop.js', line: 31, text: '/api/havas-agentic-os/mcp/*' },
    ],
    pr: [
        { title: 'MCP spine ready for demo', state: 'Draft', checks: 'build + smoke required' },
        { title: 'Write scopes approval', state: 'Required', checks: 'CODE/JIRA/CONFLUENCE writes gated' },
    ],
    agent: [
        { role: 'Orchestrator', text: 'MCP tools are preferred and non-MCP protocols are rejected.' },
        { role: 'Audit', text: 'Tool calls append mcp.tool.* events without auth secrets.' },
    ],
});

const runMCPRead = (core, actor, serverId, toolName, args = {}) => {
    if ( ! hasMCPTool(core, toolName) ) {
        return {
            ok: false,
            toolName,
            error: {
                code: 'mcp_tool_unavailable',
                message: `${toolName} is unavailable in the current MCP registry`,
                retryable: false,
                details: { serverId, toolName },
            },
        };
    }
    return core.mcp.callTool({
        serverId,
        toolName,
        actor,
        arguments: args,
    });
};

const itemsFrom = run => run?.ok ? run.result?.items || [] : [];
const itemFrom = run => run?.ok ? run.result?.item || null : null;

const jiraPayload = (core, actor) => {
    const statusRun = runMCPRead(core, actor, 'jira', 'jira.discoveryStatus');
    const evidenceRun = runMCPRead(core, actor, 'jira', 'jira.projectEvidence');
    const issueEvidenceRun = runMCPRead(core, actor, 'jira', 'jira.issueEvidence');
    const status = statusRun.ok ? (statusRun.result || {}) : {};
    const availability = atlassianAvailability(core, 'jira', status);
    const proposalToolNames = core.mcp.proposalTools()
        .filter(tool => tool.serverId === 'jira')
        .map(tool => tool.name);
    const proposals = core.mcp.proposals()
        .filter(proposal => proposal.serverId === 'jira')
        .map(proposal => ({
            proposalId: proposal.proposalId,
            toolName: proposal.toolName,
            description: proposal.description,
            actor: proposal.actor,
            auditId: proposal.auditId,
            createdAt: proposal.createdAt,
        }));
    return {
        provider: {
            site: status.site || evidenceRun.result?.site || ATLASSIAN_SITE.name,
            url: ATLASSIAN_SITE.url,
            cloudId: status.cloudId || evidenceRun.result?.cloudId || ATLASSIAN_SITE.cloudId,
            mode: 'atlassian-mcp-evidence-only',
            searchAvailable: availability.search,
            jiraProjectsAvailable: availability.projects,
            backendFetchAvailable: availability.backendFetchAvailable,
            evidenceImportedAt: availability.evidenceImportedAt,
        },
        degraded: true,
        availability: {
            ...availability,
            ...(statusRun.ok ? status : {}),
        },
        tools: {
            reads: ['jira.discoveryStatus', 'jira.projectEvidence', 'jira.issueEvidence'].filter(toolName => hasMCPTool(core, toolName)),
            writes: proposalToolNames,
            proposals: availability.proposalWriteTools || [],
        },
        writePath: {
            mode: 'proposal',
            note: availability.writePathNote || 'Jira write tools are first-class proposal-and-approval flows. No live Atlassian write is executed.',
            proposalToolCount: proposalToolNames.length,
            approvalRequired: true,
        },
        proposals,
        projects: [],
        boards: [],
        issues: [],
        issueDiscovery: {
            available: false,
            blocked: true,
            reason: JIRA_AVAILABILITY.blockedReason,
        },
        projectEvidence: evidenceRun.ok ? {
            evidenceOnly: true,
            importedAt: evidenceRun.result?.importedAt || JIRA_CATALOG.importedAt,
            source: evidenceRun.result?.source || JIRA_CATALOG.source,
            note: evidenceRun.result?.note || JIRA_CATALOG.note,
            projects: itemsFrom(evidenceRun),
        } : null,
        issueEvidence: issueEvidenceRun.ok ? {
            evidenceOnly: true,
            importedAt: issueEvidenceRun.result?.importedAt || JIRA_CATALOG.importedAt,
            source: issueEvidenceRun.result?.source || JIRA_CATALOG.source,
            note: issueEvidenceRun.result?.note || JIRA_CATALOG.note,
            issues: itemsFrom(issueEvidenceRun),
        } : null,
        detail: null,
        comments: [],
        acceptanceCriteria: [
            'Live Jira project and issue reads stay unavailable until this backend can fetch through a real Atlassian MCP bridge.',
            'Imported Jira project and issue evidence is labeled as operator-verified evidence, not backend-fetched live state.',
            'Availability is surfaced explicitly instead of fabricating external Jira data.',
            'Jira write tools use proposal-and-approval flows. No live Atlassian write is executed. Proposals are audited and require approval.',
        ],
        audits: [statusRun.auditId, evidenceRun.auditId, issueEvidenceRun.auditId].filter(Boolean),
    };
};

const confluencePayload = (core, actor) => {
    const statusRun = runMCPRead(core, actor, 'confluence', 'confluence.discoveryStatus');
    const status = statusRun.ok ? (statusRun.result || {}) : {};
    const availability = atlassianAvailability(core, 'confluence', status);
    const provider = {
        site: status.site || ATLASSIAN_SITE.name,
        url: ATLASSIAN_SITE.url,
        cloudId: status.cloudId || ATLASSIAN_SITE.cloudId,
        mode: availability.discovery ? 'atlassian-mcp-structured' : 'atlassian-mcp-status-only',
        searchAvailable: availability.search,
        confluenceDiscoveryAvailable: availability.discovery,
        connected: availability.connected,
    };

    if ( ! availability.discovery ) {
        return {
            provider,
            degraded: availability.degraded,
            availability: {
                ...availability,
                ...(statusRun.ok ? status : {}),
            },
            tools: {
                reads: ['confluence.discoveryStatus'].filter(toolName => hasMCPTool(core, toolName)),
                writes: availability.writeTools,
            },
            spaces: [],
            recent: [],
            search: [],
            viewer: null,
            ask: [
                { question: 'What is available?', answer: 'Confluence MCP status plus connection, approval, and permission surfaces remain available.' },
                { question: 'What is blocked?', answer: availability.blockedReason },
            ],
            audits: [statusRun.auditId].filter(Boolean),
            blocked: {
                reason: availability.blockedReason,
                discovery: availability.discovery,
                search: availability.search,
                viewer: availability.viewer,
            },
        };
    }

    const spacesRun = runMCPRead(core, actor, 'confluence', 'confluence.listSpaces');
    const pagesRun = runMCPRead(core, actor, 'confluence', 'confluence.listPages', { spaceKey: 'HAOS' });
    const searchRun = runMCPRead(core, actor, 'confluence', 'confluence.search', { query: 'MCP' });
    const pageRun = runMCPRead(core, actor, 'confluence', 'confluence.getPage', { pageId: 'mcp-integration-contract' });
    return {
        provider: {
            ...provider,
            site: pageRun.result?.site || searchRun.result?.site || spacesRun.result?.site || provider.site,
            cloudId: pageRun.result?.cloudId || searchRun.result?.cloudId || spacesRun.result?.cloudId || provider.cloudId,
        },
        degraded: false,
        availability: {
            ...availability,
            ...(statusRun.ok ? status : {}),
        },
        tools: {
            reads: ['confluence.listSpaces', 'confluence.listPages', 'confluence.getPage', 'confluence.search'].filter(toolName => hasMCPTool(core, toolName)),
            writes: ['confluence.createPage', 'confluence.updatePage'].filter(toolName => hasMCPTool(core, toolName)),
        },
        spaces: itemsFrom(spacesRun),
        recent: itemsFrom(pagesRun),
        search: itemsFrom(searchRun),
        viewer: itemFrom(pageRun),
        ask: [
            { question: 'What is gated?', answer: 'Writes, comments, publishing, and destructive actions require approval states in Task Monitor.' },
            { question: 'What is read only?', answer: 'Confluence viewer modes stay read-only until write permissions are granted.' },
        ],
        audits: [spacesRun.auditId, pagesRun.auditId, searchRun.auditId, pageRun.auditId].filter(Boolean),
    };
};

const commandPayload = core => {
    const pendingJiraProposals = core.mcp.proposals().filter(p => p.serverId === 'jira');
    return [
        { id: 'open-mcp', title: 'Open MCP Connections', type: 'window', target: 'mcp-connections' },
        { id: 'open-code', title: 'Open Code Workspace', type: 'window', target: 'code-workspace' },
        { id: 'open-jira', title: 'Open Jira', type: 'window', target: 'jira' },
        { id: 'open-confluence', title: 'Open Confluence', type: 'window', target: 'confluence' },
        { id: 'open-task-monitor', title: 'Open Task Monitor', type: 'section', target: 'task-monitor' },
        { id: 'search-code', title: 'Search code for ...', type: 'mcp:code.search', target: 'code-workspace' },
        {
            id: 'find-jira',
            title: hasMCPTool(core, 'jira.issueEvidence')
                ? 'Review Jira issue evidence'
                : hasMCPTool(core, 'jira.projectEvidence')
                    ? 'Review Jira project evidence'
                    : 'Check Jira availability',
            type: hasMCPTool(core, 'jira.issueEvidence')
                ? 'mcp:jira.issueEvidence'
                : hasMCPTool(core, 'jira.projectEvidence')
                    ? 'mcp:jira.projectEvidence'
                    : 'mcp:jira.discoveryStatus',
            target: 'jira',
        },
        {
            id: 'jira-proposals',
            title: `Review Jira proposals (${pendingJiraProposals.length} pending)`,
            type: 'section',
            target: 'task-monitor',
        },
        {
            id: 'summarize-confluence',
            title: hasMCPTool(core, 'confluence.getPage') ? 'Summarize Confluence page ...' : 'Check Confluence MCP status',
            type: hasMCPTool(core, 'confluence.getPage') ? 'mcp:confluence.getPage' : 'mcp:confluence.discoveryStatus',
            target: 'confluence',
        },
        { id: 'run-pipeline', title: 'Run pipeline ...', type: 'mcp:code.runPipeline', target: 'task-monitor' },
    ];
};

router.get('/api/havas-agentic-os/inventory', handle(async (req, res, core) => ok(res, {
    agents: core.registry.list(),
    permissions: core.permissions.list(),
    submissions: core.publish.list(),
})));

router.get('/api/havas-agentic-os/dashboard', handle(async (req, res, core) => ok(res, { data: dashboardPayload(core) })));

router.post('/api/havas-agentic-os/install', jsonBody, handle(async (req, res, core) => ok(res, {
    agent: core.orchestrator.install(req.body?.agentId, req.body?.actor),
})));

router.post('/api/havas-agentic-os/run', jsonBody, handle(async (req, res, core) => ok(res, {
    run: core.orchestrator.run(req.body || {}),
})));

router.get('/api/havas-agentic-os/mcp/tools', handle(async (req, res, core) => ok(res, {
    tools: core.mcp.tools(),
    proposalTools: core.mcp.proposalTools(),
    auditFile: core.audit.filePath(),
})));

router.get('/api/havas-agentic-os/mcp/proposals', handle(async (req, res, core) => ok(res, {
    proposals: core.mcp.proposals().map(proposal => ({
        ...proposal,
        statusTone: 'warn',
        status: 'Awaiting approval',
    })),
    proposalTools: core.mcp.proposalTools().map(tool => ({
        name: tool.name,
        serverId: tool.serverId,
        description: tool.proposalDescription,
        approvalScope: tool.permissions.find(scope => scope.endsWith(':write')) || tool.permissions[0],
    })),
    auditFile: core.audit.filePath(),
})));

router.get('/api/havas-agentic-os/mcp/dashboard', handle(async (req, res, core) => ok(res, {
    data: dashboardPayload(core),
})));

router.get('/api/havas-agentic-os/mcp/connections', handle(async (req, res, core) => {
    const connections = core.mcp.clients.list().map(connection => ({
        id: connection.serverId,
        title: `${connection.serverId.toUpperCase()} MCP`,
        provider: connection.serverId === 'code' ? 'Workspace' : 'Atlassian',
        status: connection.status === 'connected' ? 'Connected' : 'Disconnected',
        statusTone: connection.status === 'connected' ? 'good' : 'bad',
        permission: `${connection.grantedPermissions.length}/${connection.requestedPermissions.length} granted`,
        approval: connection.approvalMode,
        scopes: connection.requestedPermissions,
        lastError: connection.lastError || '',
        secretRef: connection.secretRef || '',
    }));
    return ok(res, {
        connections,
        approvals: mcpApprovalRows(core),
    });
}));

router.get('/api/havas-agentic-os/mcp/code', handle(async (req, res, core) => {
    core.audit.record('mcp.workspace.view', req.query?.actor, 'code');
    return ok(res, { data: codeWorkspacePayload() });
}));

router.get('/api/havas-agentic-os/mcp/jira', handle(async (req, res, core) => {
    const actor = req.query?.actor || 'viewer';
    core.audit.record('mcp.workspace.view', actor, 'jira');
    return ok(res, { data: jiraPayload(core, actor) });
}));

router.post('/api/havas-agentic-os/mcp/jira/proposals', jsonBody, handle(async (req, res, core) => {
    const body = req.body || {};
    const actor = body.actor || 'operator';
    const toolName = String(body.toolName || '').trim();
    const proposalTools = core.mcp.proposalTools().filter(tool => tool.serverId === 'jira');

    if ( ! toolName ) throw new Error('toolName_required');
    if ( ! proposalTools.some(tool => tool.name === toolName) ) throw new Error('jira_proposal_tool_not_allowed');

    const run = core.orchestrator.runMCP({
        intent: body.intent || toolName,
        serverId: 'jira',
        toolName,
        actor,
        arguments: body.arguments || {},
    });

    const proposal = core.mcp.proposals().find(item => item.proposalId === run.toolCall?.proposal?.proposalId) || null;

    core.tasks.create('mcp:jira:proposal', `Submitted Jira proposal: ${toolName}`);
    core.audit.record('jira.proposal.submit', actor, toolName, {
        proposalId: proposal?.proposalId,
        auditId: run.toolCall?.auditId,
        proposalOnly: true,
        liveJiraWriteExecuted: false,
    });

    return ok(res, {
        submission: {
            actor,
            toolName,
            proposalOnly: true,
            liveJiraWriteExecuted: false,
            writePathNote: 'Jira write tools are first-class proposal-and-approval flows. No live Atlassian write is executed. Proposals are recorded in the audit log and require approval.',
            proposal,
            taskMonitor: {
                pendingCount: core.mcp.proposals().filter(item => item.serverId === 'jira').length,
            },
        },
        run,
    });
}));

router.get('/api/havas-agentic-os/mcp/confluence', handle(async (req, res, core) => {
    const actor = req.query?.actor || 'viewer';
    core.audit.record('mcp.workspace.view', actor, 'confluence');
    return ok(res, { data: confluencePayload(core, actor) });
}));

router.get('/api/havas-agentic-os/mcp/commands', handle(async (req, res, core) => ok(res, {
    commands: commandPayload(core),
})));

router.post('/api/havas-agentic-os/mcp/tools', jsonBody, handle(async (req, res, core) => {
    const run = core.orchestrator.runMCP(req.body || {});
    return ok(res, {
        run,
        approval: {
            requiresApproval: run.toolCall?.requiresApproval || false,
            approvalScope: run.toolCall?.approvalScope || null,
            approvalMode: run.toolCall?.approvalMode,
            permissionDecision: run.toolCall?.permissionDecision,
            auditId: run.toolCall?.auditId || null,
        },
    });
}));

router.get('/api/havas-agentic-os/mcp/capabilities', handle(async (req, res, core) => ok(res, {
    capabilities: core.mcp.capabilities(),
    connections: core.mcp.clients.list(),
    auditFile: core.audit.filePath(),
})));

router.post('/api/havas-agentic-os/mcp/connect', jsonBody, handle(async (req, res, core) => ok(res, {
    connection: core.mcp.connect(req.body || {}),
})));

router.get('/api/havas-agentic-os/mcp/health', handle(async (req, res, core) => ok(res, {
    health: core.mcp.health(req.query?.serverId),
    checkedAt: new Date().toISOString(),
})));

router.get('/api/havas-agentic-os/mcp/availability', handle(async (req, res, core) => ok(res, {
    atlassian: {
        site: ATLASSIAN_SITE.name,
        url: ATLASSIAN_SITE.url,
        cloudId: ATLASSIAN_SITE.cloudId,
        jira: atlassianAvailability(core, 'jira'),
        confluence: (() => {
            const statusRun = runMCPRead(core, req.query?.actor || 'viewer', 'confluence', 'confluence.discoveryStatus');
            return {
                ...atlassianAvailability(core, 'confluence', statusRun.ok ? (statusRun.result || {}) : {}),
                ...(statusRun.ok ? statusRun.result || {} : {}),
            };
        })(),
    },
})));

router.get('/api/havas-agentic-os/mcp/task-monitor', handle(async (req, res, core) => {
    const jiraAvailability = atlassianAvailability(core, 'jira');
    const jiraProposals = core.mcp.proposals()
        .filter(p => p.serverId === 'jira')
        .map(p => ({
            ...p,
            status: 'Awaiting approval',
            statusTone: 'warn',
        }));
    return ok(res, {
        approvals: mcpApprovalRows(core),
        state: {
            tasks: core.tasks.list(),
            audits: core.audit.query({ limit: 10 }),
            connections: core.mcp.clients.list(),
            auditFile: core.audit.filePath(),
        },
        jiraProposals: {
            writePath: {
                mode: jiraAvailability.writePath,
                note: jiraAvailability.writePathNote,
                approvalRequired: true,
            },
            pendingCount: jiraProposals.length,
            latestProposal: jiraProposals[0] || null,
            proposals: jiraProposals,
        },
    });
}));

router.post('/api/havas-agentic-os/mcp/task-monitor', jsonBody, handle(async (req, res, core) => {
    const message = String(req.body?.message || '').trim();
    const normalizedMessage = message.toLowerCase();
    const confluenceReadTool = hasMCPTool(core, 'confluence.search') ? 'confluence.search' : 'confluence.discoveryStatus';
    const jiraReadTool = hasMCPTool(core, 'jira.issueEvidence')
        ? 'jira.issueEvidence'
        : hasMCPTool(core, 'jira.projectEvidence')
            ? 'jira.projectEvidence'
            : 'jira.discoveryStatus';
    const jiraProposalTool = normalizedMessage.includes('comment')
        ? 'jira.addComment'
        : normalizedMessage.includes('transition') || normalizedMessage.includes('move issue') || normalizedMessage.includes('change status')
            ? 'jira.transitionIssue'
            : normalizedMessage.includes('assign')
                ? 'jira.assignIssue'
                : normalizedMessage.includes('label')
                    ? 'jira.updateLabels'
                    : normalizedMessage.includes('create issue') || normalizedMessage.includes('new issue')
                        ? 'jira.createIssue'
                        : null;
    const serverId = normalizedMessage.includes('jira')
        ? 'jira'
        : normalizedMessage.includes('confluence')
            ? 'confluence'
            : 'code';
    const toolName = normalizedMessage.includes('pipeline')
        ? 'code.runPipeline'
        : serverId === 'jira'
            ? jiraProposalTool || jiraReadTool
            : serverId === 'confluence'
                ? confluenceReadTool
                : 'code.search';
    const run = core.orchestrator.runMCP({
        intent: message || 'code search',
        serverId,
        actor: req.body?.actor || 'operator',
        arguments: { query: message || 'status' },
        toolName,
        approval: req.body?.approval,
    });
    const proposal = run.toolCall?.proposal || null;
    return ok(res, {
        reply: proposal
            ? `Jira proposal recorded: ${proposal.proposalId}. No live Jira write executed. Review in Task Monitor.`
            : run.toolCall.requiresApproval
                ? `MCP approval required: ${run.toolCall.approvalScope}`
                : run.toolCall.ok
                    ? `MCP task completed through ${run.toolCall.toolName}`
                    : `MCP task failed through ${run.toolCall.toolName}`,
        approval: {
            requiresApproval: run.toolCall.requiresApproval || false,
            approvalScope: run.toolCall.approvalScope || null,
            approvalMode: run.toolCall.approvalMode,
            permissionDecision: run.toolCall.permissionDecision,
            auditId: run.toolCall.auditId || null,
        },
        proposal: proposal ? {
            proposalId: proposal.proposalId,
            toolName: proposal.toolName,
            description: proposal.description,
            auditId: run.toolCall.auditId || null,
            pendingCount: core.mcp.proposals().filter(item => item.serverId === 'jira').length,
            liveJiraWriteExecuted: false,
        } : null,
        run,
    });
}));

router.post('/api/havas-agentic-os/mcp/permissions', jsonBody, handle(async (req, res, core) => ok(res, {
    connection: core.mcp.negotiate(req.body || {}),
})));

router.get('/api/havas-agentic-os/permissions', handle(async (req, res, core) => ok(res, {
    permissions: core.permissions.list(req.query?.agentId),
})));

router.post('/api/havas-agentic-os/permissions/approve', jsonBody, handle(async (req, res, core) => {
    const grant = core.permissions.approve(req.body || {});
    core.audit.record('permission.approve', grant.actor, grant.agentId, { scope: grant.scope });
    return ok(res, { permission: grant });
}));

router.post('/api/havas-agentic-os/permissions/revoke', jsonBody, handle(async (req, res, core) => {
    const grant = core.permissions.revoke(req.body || {});
    core.audit.record('permission.revoke', grant.actor, grant.agentId, { scope: grant.scope });
    return ok(res, { permission: grant });
}));

router.get('/api/havas-agentic-os/audits', handle(async (req, res, core) => ok(res, {
    audits: core.audit.query(req.query || {}),
})));

router.get('/api/havas-agentic-os/memory', handle(async (req, res, core) => ok(res, {
    memory: core.memory.list(req.query?.namespace),
})));

router.post('/api/havas-agentic-os/memory', jsonBody, handle(async (req, res, core) => {
    const record = core.memory.set(req.body || {});
    core.audit.record('memory.set', req.body?.actor, `${record.namespace}:${record.key}`);
    return ok(res, { memory: record });
}));

router.delete('/api/havas-agentic-os/memory/:key', handle(async (req, res, core) => {
    const deleted = core.memory.delete(req.query?.namespace, req.params.key);
    core.audit.record('memory.delete', req.query?.actor, `${req.query?.namespace || 'default'}:${req.params.key}`, { deleted });
    return ok(res, { deleted });
}));

router.get('/api/havas-agentic-os/publish', handle(async (req, res, core) => ok(res, {
    submissions: core.publish.list(),
})));

router.post('/api/havas-agentic-os/publish/submit', jsonBody, handle(async (req, res, core) => ok(res, {
    submission: core.publish.submit(req.body || {}),
})));

router.post('/api/havas-agentic-os/publish/review', jsonBody, handle(async (req, res, core) => ok(res, {
    submission: core.publish.review(req.body || {}),
})));

router.post('/api/havas-agentic-os/publish/publish', jsonBody, handle(async (req, res, core) => ok(res, {
    submission: core.publish.publish(req.body || {}),
})));

router.get('/api/havas-agentic-os/tasks', handle(async (req, res, core) => ok(res, {
    tasks: core.tasks.list(),
})));

router.get('/api/havas-agentic-os/task-monitor', handle(async (req, res, core) => ok(res, {
    state: {
        tasks: core.tasks.list(),
        audits: core.audit.query({ limit: 10 }),
        installedAgents: core.registry.list().filter(agent => agent.status !== 'available'),
    },
})));

router.post('/api/havas-agentic-os/task-monitor', jsonBody, handle(async (req, res, core) => {
    const message = String(req.body?.message || '').trim();
    const run = core.orchestrator.run({
        agentId: 'task-monitor',
        goal: message || 'operator command',
        actor: req.body?.actor || 'operator',
    });
    return ok(res, {
        reply: run.requiresApproval.length
            ? `Permission approval required: ${run.requiresApproval.join(', ')}`
            : `Task Monitor completed: ${run.task.title}`,
        run,
    });
}));

module.exports = router;
