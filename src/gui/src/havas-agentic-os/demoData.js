export const SECTIONS = [
    {
        id: 'app-center',
        title: 'App Center',
        glyph: 'AC',
        summary: 'Home, apps, wishlist, reviews',
        mode: 'cards',
        filters: ['installed', 'wishlist', 'review', 'featured'],
        views: [
            { id: 'home', label: 'Home' },
            { id: 'myApps', label: 'My Apps' },
            { id: 'wishlist', label: 'Wishlist' },
            { id: 'myReviews', label: 'My Reviews' },
        ],
    },
    {
        id: 'dev-center',
        title: 'Dev Center',
        glyph: 'DC',
        summary: 'Publish pipeline',
        mode: 'table',
        filters: ['draft', 'review', 'approved', 'worker'],
        views: [
            { id: 'createApp', label: 'Create App' },
            { id: 'createWorker', label: 'Create Worker' },
            { id: 'reviewQueue', label: 'Review Queue' },
        ],
    },
    {
        id: 'marketplace',
        title: 'Marketplace',
        glyph: 'MP',
        summary: 'Agent inventory',
        mode: 'cards',
        filters: ['featured', 'agent', 'installed', 'request'],
        views: [
            { id: 'featured', label: 'Featured' },
            { id: 'agentTools', label: 'Agent Tools' },
            { id: 'installed', label: 'Installed' },
            { id: 'requests', label: 'Requests' },
            { id: 'system', label: 'System' },
        ],
    },
    {
        id: 'settings',
        title: 'Settings',
        glyph: 'ST',
        summary: 'Permissions, logs, memory',
        mode: 'table',
        filters: ['permission', 'log', 'memory', 'policy'],
        views: [
            { id: 'permissions', label: 'Permissions' },
            { id: 'logs', label: 'Logs' },
            { id: 'memory', label: 'Memory' },
        ],
    },
    {
        id: 'task-monitor',
        title: 'Task Monitor',
        glyph: 'TM',
        summary: 'Plan-act-observe logs',
        mode: 'table',
        filters: ['plan', 'act', 'observe', 'blocked'],
        views: [
            { id: 'plan', label: 'Plan' },
            { id: 'act', label: 'Act' },
            { id: 'observe', label: 'Observe' },
        ],
    },
];

export const APP_SECTIONS = {
    'app-center': 'app-center',
    'dev-center': 'dev-center',
    marketplace: 'marketplace',
    settings: 'settings',
    'task-monitor': 'task-monitor',
};

export const DESKTOP_APPS = [
    { title: 'MCP Connections', name: 'mcp-connections', tone: 'blue', glyph: 'MC' },
    { title: 'App Center', name: 'app-center', tone: 'red', glyph: 'AC' },
    { title: 'Dev Center', name: 'dev-center', tone: 'blue', glyph: 'DC' },
    { title: 'Code', name: 'code-workspace', tone: 'green', glyph: '{}' },
    { title: 'Jira', name: 'jira', tone: 'blue', glyph: 'JI' },
    { title: 'Confluence', name: 'confluence', tone: 'slate', glyph: 'CF' },
    { title: 'Marketplace', name: 'marketplace', tone: 'gold', glyph: 'MP' },
    { title: 'Task Monitor', name: 'task-monitor', tone: 'green', glyph: 'TM' },
    { title: 'Settings', name: 'settings', tone: 'slate', glyph: 'ST' },
    { title: 'Documents', name: 'documents', tone: 'slate', glyph: 'DO' },
    { title: 'Editor', name: 'editor', tone: 'blue', glyph: 'ED' },
];

export const DOCK_APPS = [
    { title: 'MCP Connections', name: 'mcp-connections', tone: 'blue', glyph: 'MC' },
    { title: 'App Center', name: 'app-center', tone: 'red', glyph: 'AC' },
    { title: 'Dev Center', name: 'dev-center', tone: 'blue', glyph: 'DC' },
    { title: 'Code', name: 'code-workspace', tone: 'green', glyph: '{}' },
    { title: 'Jira', name: 'jira', tone: 'blue', glyph: 'JI' },
    { title: 'Confluence', name: 'confluence', tone: 'slate', glyph: 'CF' },
    { title: 'Marketplace', name: 'marketplace', tone: 'gold', glyph: 'MP' },
    { title: 'Task Monitor', name: 'task-monitor', tone: 'green', glyph: 'TM' },
    { sep: true },
    { title: 'Documents', name: 'documents', tone: 'slate', glyph: 'DO' },
    { title: 'Editor', name: 'editor', tone: 'blue', glyph: 'ED' },
];

export const SYSTEM_STATUS = [
    { label: 'Runtime', value: 'Online', detail: 'demo fallback ready' },
    { label: 'MCP', value: '3/3', detail: 'code, Jira, Confluence' },
    { label: 'Publish Queue', value: '7', detail: '2 awaiting review' },
    { label: 'Permissions', value: '42', detail: '5 elevated scopes' },
    { label: 'Tasks', value: '18', detail: '3 observing' },
];

const apps = [
    { id: 'pmai', title: 'PMAI Planner', kind: 'featured agent', status: 'Installed', statusTone: 'good', owner: 'Strategy', metric: '94% adoption', glyph: 'PA', summary: 'Plans briefs, decomposes goals, and hands tasks to delivery agents.' },
    { id: 'devops-release', title: 'DevOps Release Copilot', kind: 'installed worker', status: 'Installed', statusTone: 'good', owner: 'Platform', metric: '12 runs', glyph: 'DR', summary: 'Build checks, release notes, rollback plans, and deployment gates.' },
    { id: 'openclaw', title: 'OpenClaw Intel', kind: 'featured agent', status: 'Featured', statusTone: 'warn', owner: 'Insights', metric: '3 signals', glyph: 'OI', summary: 'Collects public market signals and converts them into opportunities.' },
    { id: 'brand-hub', title: 'Brand Asset Hub', kind: 'wishlist request', status: 'Wishlist', statusTone: 'neutral', owner: 'Creative', metric: 'Q2', glyph: 'BH', summary: 'Templates, campaign-ready assets, and brand governance checks.' },
];

const devRows = [
    { id: 'cx-app-shell', title: 'Create App: CX App Shell', status: 'Draft', statusTone: 'neutral', owner: 'Dev Center', summary: 'Manifest, icon pack, scopes, install copy, screenshots.', phase: 'draft app' },
    { id: 'brief-worker', title: 'Create Worker: Brief Compiler', status: 'Approved', statusTone: 'good', owner: 'Worker Runtime', summary: 'Queue trigger, memory read scope, and audit writer.', phase: 'worker approved' },
    { id: 'openclaw-review', title: 'Review Queue: OpenClaw v0.8', status: 'Review', statusTone: 'warn', owner: 'Marketplace Ops', summary: 'Needs external source disclosure before marketplace publish.', phase: 'review queue' },
    { id: 'policy-pack', title: 'Review Queue: Policy Pack', status: 'Blocked', statusTone: 'bad', owner: 'Governance', summary: 'Missing escalation owner for destructive operations.', phase: 'review blocked' },
];

const marketplace = [
    { id: 'agent-tools', title: 'Agent Tool Belt', kind: 'agent tool featured', status: 'Featured', statusTone: 'good', owner: 'System', metric: '8 tools', glyph: 'AT', summary: 'Shared tools for search, summarize, publish, approve, and report.' },
    { id: 'installed-runtime', title: 'Installed Runtime Pack', kind: 'installed system', status: 'Installed', statusTone: 'good', owner: 'Runtime', metric: 'Core', glyph: 'IR', summary: 'Default agents, task queue, policy gate, memory index, audit writer.' },
    { id: 'request-hubspot', title: 'HubSpot Agent Connector', kind: 'request agent', status: 'Requested', statusTone: 'warn', owner: 'CRM', metric: 'Approval', glyph: 'HC', summary: 'Requested connector for campaign and customer journey handoff.' },
    { id: 'system-policy', title: 'System Policy Manager', kind: 'system installed', status: 'System', statusTone: 'neutral', owner: 'Governance', metric: 'v1.4', glyph: 'SP', summary: 'Permission templates, exception review, and audit retention rules.' },
];

const settings = [
    { id: 'scope-memory', title: 'Memory read/write', scope: 'permission memory policy', status: 'Needs approval', statusTone: 'warn', summary: 'Workers can read campaign memory and append observations.' },
    { id: 'publish-log', title: 'Publish audit log', scope: 'log audit policy', status: 'Enabled', statusTone: 'good', summary: 'Every app publish event records actor, manifest, scopes, and review result.' },
    { id: 'memory-retention', title: 'Memory retention', scope: 'memory policy', status: '30 days', statusTone: 'neutral', summary: 'Demo workspace memories expire unless pinned by the owner.' },
    { id: 'external-tools', title: 'External tool permission', scope: 'permission policy', status: 'Restricted', statusTone: 'bad', summary: 'Public web scans require disclosure and cannot access authenticated sources.' },
];

const tasks = [
    { id: 'plan-brief', title: 'Plan: Launch App Center review', state: 'In progress', statusTone: 'warn', actor: 'PMAI', summary: 'Define publish criteria, owners, screenshots, permissions, and QA gates.', phase: 'plan' },
    { id: 'act-worker', title: 'Act: Stage worker manifest', state: 'Running', statusTone: 'good', actor: 'DevOps Copilot', summary: 'Validating manifest and worker trigger schema before review.', phase: 'act' },
    { id: 'observe-audit', title: 'Observe: Audit append', state: 'Complete', statusTone: 'good', actor: 'Audit Writer', summary: 'Captured plan, action, result, and policy decision in task log.', phase: 'observe' },
    { id: 'blocked-policy', title: 'Blocked: External scan scope', state: 'Blocked', statusTone: 'bad', actor: 'Policy Manager', summary: 'OpenClaw scan needs source disclosure before publish.', phase: 'blocked' },
    { id: 'approval-code-write', title: 'Approval: Code write scope', state: 'Pending approval', statusTone: 'warn', actor: 'CODE MCP', summary: 'Agent requests workspace write permission for src/gui only.', phase: 'approval permission' },
    { id: 'approval-jira-comment', title: 'Approval: Jira comment sync', state: 'Approved', statusTone: 'good', actor: 'JIRA MCP', summary: 'Issue comments can be summarized and linked to acceptance criteria.', phase: 'approval permission' },
    { id: 'approval-conf-ask', title: 'Permission: Confluence ask', state: 'Read only', statusTone: 'neutral', actor: 'CONFLUENCE MCP', summary: 'Ask mode can read spaces and recent pages; write actions remain gated.', phase: 'permission observe' },
];

export const AGENTIC_FALLBACK = {
    'app-center': {
        home: apps,
        myApps: apps.filter(item => item.kind.includes('installed')),
        wishlist: apps.filter(item => item.kind.includes('wishlist')),
        myReviews: apps.filter(item => item.kind.includes('featured')),
    },
    'dev-center': {
        createApp: devRows.filter(item => item.phase.includes('app')),
        createWorker: devRows.filter(item => item.phase.includes('worker')),
        reviewQueue: devRows.filter(item => item.phase.includes('review')),
    },
    marketplace: {
        featured: marketplace.filter(item => item.kind.includes('featured')),
        agentTools: marketplace.filter(item => item.kind.includes('agent')),
        installed: marketplace.filter(item => item.kind.includes('installed')),
        requests: marketplace.filter(item => item.kind.includes('request')),
        system: marketplace.filter(item => item.kind.includes('system')),
    },
    settings: {
        permissions: settings.filter(item => item.scope.includes('permission')),
        logs: settings.filter(item => item.scope.includes('log')),
        memory: settings.filter(item => item.scope.includes('memory')),
    },
    'task-monitor': {
        plan: tasks.filter(item => item.phase.includes('plan')),
        act: tasks.filter(item => item.phase.includes('act')),
        observe: tasks.filter(item => item.phase.includes('observe') || item.phase.includes('blocked')),
    },
};

export const MCP_FALLBACK = {
    connections: [
        { id: 'code', title: 'CODE MCP', provider: 'Workspace', status: 'Connected', statusTone: 'good', permission: '1/2 granted', approval: '1 write scope gated', scopes: ['code:read', 'code:write'], health: 'connected', lastAudit: 'mcp.workspace.view • just now', capabilities: [{ name: 'code-workspace', permissions: ['code:read', 'code:write'] }], tools: [{ name: 'code.search', write: false }, { name: 'code.read', write: false }, { name: 'code.diff', write: false }, { name: 'code.apply_patch', write: true }] },
        { id: 'jira', title: 'JIRA MCP', provider: 'Atlassian', status: 'Connected', statusTone: 'good', permission: '1/2 granted', approval: '5 proposal write tools gated', scopes: ['jira:read', 'jira:write'], health: 'connected', lastAudit: 'mcp.workspace.view • just now', capabilities: [{ name: 'jira-projects', permissions: ['jira:read'] }, { name: 'jira-write', permissions: ['jira:write'] }], tools: [{ name: 'jira.discoveryStatus', write: false }, { name: 'jira.projectEvidence', write: false }, { name: 'jira.issueEvidence', write: false }, { name: 'jira.createIssue', write: true, proposalDescription: 'Propose creating a new Jira issue.' }, { name: 'jira.transitionIssue', write: true, proposalDescription: 'Propose transitioning a Jira issue.' }, { name: 'jira.addComment', write: true, proposalDescription: 'Propose adding a comment to a Jira issue.' }, { name: 'jira.assignIssue', write: true, proposalDescription: 'Propose assigning a Jira issue.' }, { name: 'jira.updateLabels', write: true, proposalDescription: 'Propose updating labels on a Jira issue.' }] },
        { id: 'confluence', title: 'CONFLUENCE MCP', provider: 'Atlassian', status: 'Read only', statusTone: 'warn', permission: '1/2 granted', approval: '1 write scope gated', scopes: ['confluence:read', 'confluence:write'], health: 'connected', lastAudit: 'mcp.workspace.view • just now', capabilities: [{ name: 'confluence-spaces', permissions: ['confluence:read', 'confluence:write'] }], tools: [{ name: 'confluence.search_pages', write: false }, { name: 'confluence.get_page', write: false }, { name: 'confluence.create_page', write: true }, { name: 'confluence.update_page', write: true }] },
    ],
    approvals: [
        { id: 'ap-1', title: 'CODE write in src/gui', state: 'Pending', statusTone: 'warn', owner: 'UI Builder', detail: 'Requires explicit task scope match.' },
        { id: 'ap-2', title: 'Jira comment append', state: 'Approved', statusTone: 'good', owner: 'Delivery Lead', detail: 'Allowed for selected issue only.' },
        { id: 'ap-3', title: 'Confluence page update', state: 'Blocked', statusTone: 'bad', owner: 'Knowledge Owner', detail: 'MCP is currently read only.' },
        { id: 'ap-jira-create', title: 'Jira createIssue proposal', state: 'Awaiting approval', statusTone: 'warn', owner: 'JIRA MCP', detail: 'Proposal write-path. No live Jira write executed. Approve to audit.' },
        { id: 'ap-jira-transition', title: 'Jira transitionIssue proposal', state: 'Awaiting approval', statusTone: 'warn', owner: 'JIRA MCP', detail: 'Proposal write-path. No live Jira write executed. Approve to audit.' },
    ],
};

export const CODE_FALLBACK = {
    files: [
        { path: 'src/gui/src/UI/UICXOSDesktop.js', type: 'js', status: 'modified' },
        { path: 'src/gui/src/havas-agentic-os/demoData.js', type: 'js', status: 'modified' },
        { path: 'src/gui/src/havas-agentic-os/styles.js', type: 'css', status: 'modified' },
    ],
    file: {
        path: 'src/gui/src/UI/UICXOSDesktop.js',
        body: 'MCP-first UI surface. Select Diff, History, Search, or PR for workspace context.',
        status: 'Read from CODE MCP or demo fallback',
    },
    diff: [
        { file: 'UICXOSDesktop.js', change: '+ MCP windows, command palettes, task approvals' },
        { file: 'demoData.js', change: '+ CODE/JIRA/CONFLUENCE fallback payloads' },
        { file: 'styles.js', change: '+ dark workspace layouts' },
    ],
    history: [
        { id: 'h1', title: 'UI Builder scoped changes', author: 'agent', time: 'now' },
        { id: 'h2', title: 'Havas desktop shell', author: 'workspace', time: 'previous' },
    ],
    search: [
        { file: 'UICXOSDesktop.js', line: 42, text: '/api/havas-agentic-os/mcp/*' },
        { file: 'demoData.js', line: 180, text: 'CODE_FALLBACK' },
    ],
    pr: [
        { title: 'Ready for UI review', state: 'Draft', checks: 'node --check pending' },
        { title: 'Approval gate', state: 'Required', checks: 'CODE write scope pending' },
    ],
    agent: [
        { role: 'UI Builder', text: 'Owns desktop UI files only.' },
        { role: 'Policy', text: 'Backend and docs are out of scope.' },
        { role: 'Tools', text: 'code.search • code.read • code.diff • code.apply_patch [approval]' },
    ],
};

export const JIRA_FALLBACK = {
    cloudId: 'f076a948-b3ae-4495-8f1a-62a4418c1752',
    availability: {
        projects: true,
        search: false,
        searchReason: 'Rovo search unavailable (app missing or 403).',
    },
    projects: [
        { key: 'HAOS', name: 'Havas Agentic OS', lead: 'Platform', projectTypeKey: 'software', state: 'live sync' },
        { key: 'CX', name: 'CX Delivery', lead: 'Experience', projectTypeKey: 'business', state: 'live sync' },
    ],
    boards: [
        { id: 'board-1', name: 'Agentic OS Sprint', type: 'Scrum', projectKey: 'HAOS' },
        { id: 'board-2', name: 'Integrations Kanban', type: 'Kanban', projectKey: 'CX' },
    ],
    issues: [
        { key: 'HAOS-42', title: 'Add MCP-first CODE workspace', status: 'In Progress', assignee: 'UI Builder' },
        { key: 'HAOS-43', title: 'Expose Jira acceptance criteria', status: 'Review', assignee: 'Delivery' },
        { key: 'CX-18', title: 'Confluence ask mode', status: 'Ready', assignee: 'Knowledge' },
    ],
    detail: {
        key: 'HAOS-42',
        title: 'Add MCP-first CODE workspace',
        status: 'In Progress',
        summary: 'Tree, tabs, diff, history, search, PR context, and agent panel.',
    },
    comments: [
        { author: 'Delivery Lead', text: 'Show permission states in Task Monitor.' },
        { author: 'UI Builder', text: 'No backend or docs changes.' },
    ],
    acceptanceCriteria: [
        'CODE, JIRA, and CONFLUENCE are reachable from desktop and dock.',
        'Every integration reads /api/havas-agentic-os/mcp/* first.',
        'Demo fallback keeps the UI usable when MCP is offline.',
        'Jira write tools use proposal-and-approval flows. No live write is executed.',
    ],
    search: {
        available: false,
        reason: 'Rovo search unavailable (app missing or 403).',
    },
    writePath: {
        mode: 'proposal',
        note: 'Jira write tools are first-class proposal-and-approval flows. No live Atlassian write is executed.',
        proposalToolCount: 5,
        approvalRequired: true,
    },
    proposals: [
        {
            proposalId: 'proposal-demo-001',
            toolName: 'jira.createIssue',
            description: 'Propose creating a new Jira issue with the given fields. This is a proposal only — no live Atlassian write is performed.',
            actor: 'demo-operator',
            auditId: 'audit-demo-001',
            createdAt: '2026-04-27T10:00:00.000Z',
        },
        {
            proposalId: 'proposal-demo-002',
            toolName: 'jira.transitionIssue',
            description: 'Propose transitioning a Jira issue to a new status. This is a proposal only — no live Atlassian write is performed.',
            actor: 'demo-operator',
            auditId: 'audit-demo-002',
            createdAt: '2026-04-27T10:05:00.000Z',
        },
    ],
    tools: {
        reads: ['jira.discoveryStatus', 'jira.projectEvidence', 'jira.issueEvidence'],
        writes: ['jira.createIssue', 'jira.transitionIssue', 'jira.addComment', 'jira.assignIssue', 'jira.updateLabels'],
        proposals: [
            { name: 'jira.createIssue', description: 'Propose creating a new Jira issue with the given fields. This is a proposal only — no live Atlassian write is performed.' },
            { name: 'jira.transitionIssue', description: 'Propose transitioning a Jira issue to a new status. This is a proposal only — no live Atlassian write is performed.' },
            { name: 'jira.addComment', description: 'Propose adding a comment to a Jira issue. This is a proposal only — no live Atlassian write is performed.' },
            { name: 'jira.assignIssue', description: 'Propose assigning a Jira issue to a user. This is a proposal only — no live Atlassian write is performed.' },
            { name: 'jira.updateLabels', description: 'Propose adding or removing labels on a Jira issue. This is a proposal only — no live Atlassian write is performed.' },
        ],
    },
};

export const CONFLUENCE_FALLBACK = {
    cloudId: 'f076a948-b3ae-4495-8f1a-62a4418c1752',
    availability: {
        discovery: false,
        discoveryReason: 'Discovery is blocked unless the backend returns Confluence data.',
        viewer: true,
    },
    spaces: [
        { key: 'HAOS', name: 'Havas Agentic OS', access: 'Read' },
        { key: 'CXOS', name: 'CX Operating System', access: 'Read' },
    ],
    recent: [
        { title: 'MCP Integration Contract', space: 'HAOS', updated: 'Today', excerpt: 'Viewer payload is available even when discovery stays blocked.' },
        { title: 'Agent Permission Matrix', space: 'HAOS', updated: 'Yesterday', excerpt: 'Write actions stay approval-gated for Confluence tools.' },
    ],
    search: [
        { title: 'CODE Workspace Notes', excerpt: 'Tree, diff, PR, and history are MCP-backed.' },
        { title: 'Jira Delivery Flow', excerpt: 'Issues include comments and acceptance criteria.' },
    ],
    viewer: {
        title: 'MCP Integration Contract',
        space: 'HAOS',
        body: 'CODE, JIRA, and CONFLUENCE surfaces must use MCP endpoints first and fallback to local demo data.',
    },
    ask: [
        { question: 'What is gated?', answer: 'Writes, comments, publishing, and destructive actions require approval states in Task Monitor.' },
        { question: 'What is read only?', answer: 'Confluence ask and viewer modes are read only in the fallback contract.' },
    ],
    discovery: {
        available: false,
        reason: 'Discovery is blocked unless the backend returns Confluence data.',
    },
};

export const COMMAND_FALLBACK = [
    { id: 'open-mcp', title: 'Open MCP Connections', type: 'window', target: 'mcp-connections' },
    { id: 'open-code', title: 'Open Code Workspace', type: 'window', target: 'code-workspace' },
    { id: 'open-jira', title: 'Open Jira', type: 'window', target: 'jira' },
    { id: 'open-confluence', title: 'Open Confluence', type: 'window', target: 'confluence' },
    { id: 'open-task-monitor', title: 'Open Task Monitor', type: 'section', target: 'task-monitor' },
    { id: 'search-code', title: 'Search code for ...', type: 'mcp:code.search', target: 'code-workspace', subtitle: 'CODE • code:read' },
    { id: 'find-jira', title: 'Find Jira issue ...', type: 'mcp:jira.issueEvidence', target: 'jira', subtitle: 'JIRA • jira:read' },
    { id: 'jira-proposals', title: 'Review Jira proposals ...', type: 'section', target: 'task-monitor', subtitle: 'JIRA • 2 proposals pending' },
    { id: 'summarize-confluence', title: 'Summarize Confluence page ...', type: 'mcp:confluence.get_page', target: 'confluence', subtitle: 'CONFLUENCE • confluence:read' },
    { id: 'run-pipeline', title: 'Run pipeline ...', type: 'mcp:code.apply_patch', target: 'task-monitor', subtitle: 'CODE • code:write • Pending' },
];
