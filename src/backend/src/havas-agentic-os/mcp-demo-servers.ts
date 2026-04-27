import type { MCPCapability, MCPToolDefinition } from './types.js';
import { getImportedJiraEvidence, jiraEvidenceAvailability } from './jira-catalog.js';
import { assertMCPProtocol, makeConnectionState, type MCPDemoServer } from './mcp-hub.js';
import { asText, nowISO } from './utils.js';

interface DemoServerConfig {
    id: string;
    name: string;
    authMode: string;
    capabilities: Omit<MCPCapability, 'serverId'>[];
    tools: Omit<MCPToolDefinition, 'serverId'>[];
    handlers?: Record<string, (input: unknown) => unknown>;
}

class DemoMCPServer implements MCPDemoServer {
    id: string;
    name: string;
    authMode: string;
    capabilities: MCPCapability[];
    tools: MCPToolDefinition[];
    #handlers: Record<string, (input: unknown) => unknown>;

    constructor (config: DemoServerConfig) {
        this.id = config.id;
        this.name = config.name;
        this.authMode = config.authMode;
        this.capabilities = config.capabilities.map(capability => ({ ...capability, serverId: config.id }));
        this.tools = config.tools.map(tool => ({ ...tool, serverId: config.id }));
        this.#handlers = config.handlers || {};
    }

    connect (input: { protocol: unknown; auth?: Record<string, unknown> }) {
        assertMCPProtocol(input.protocol);
        return makeConnectionState(this, input.auth);
    }

    health () {
        return { status: 'connected' as const, checkedAt: nowISO() };
    }

    callTool (name: string, input: unknown): unknown {
        const tool = this.tools.find(candidate => candidate.name === name);
        if ( ! tool ) throw new Error('mcp_tool_not_found');
        const handler = this.#handlers[name];
        if ( handler ) return handler(input);
        return {
            server: this.id,
            tool: name,
            mode: 'demo-adapter',
            accepted: true,
            summary: `${name} accepted MCP request`,
            payload: scrubInput(input),
        };
    }
}

const retry = { maxAttempts: 3, backoffMs: 300 };
const ATLASSIAN_SITE = process.env.HAVAS_AGENTIC_OS_ATLASSIAN_SITE || 'waltzai.atlassian.net';
const ATLASSIAN_CLOUD_ID = process.env.HAVAS_AGENTIC_OS_ATLASSIAN_CLOUD_ID || 'f076a948-b3ae-4495-8f1a-62a4418c1752';
const ROVO_SEARCH_AVAILABLE = envFlag('HAVAS_AGENTIC_OS_ATLASSIAN_ROVO_SEARCH', false);
const CONFLUENCE_DISCOVERY_AVAILABLE = envFlag('HAVAS_AGENTIC_OS_ATLASSIAN_CONFLUENCE_DISCOVERY', false);
const jiraAvailability = jiraEvidenceAvailability();
const jiraEvidence = getImportedJiraEvidence();
const textResultSchema = {
    type: 'object',
    properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        summary: { type: 'string' },
        accepted: { type: 'boolean' },
        payload: { type: 'object' },
    },
};

export const createDemoMCPServers = (): MCPDemoServer[] => [
    new DemoMCPServer({
        id: 'code',
        name: 'CODE MCP Adapter',
        authMode: 'workspace-token',
        capabilities: [
            {
                name: 'code-workspace',
                description: 'Search, read, diff, and patch repository code through MCP tools.',
                permissions: ['code:read', 'code:write'],
            },
        ],
        tools: [
            tool('code.openRepo', 'Open a repository in the Code workspace.', ['code:read'], false, 'read'),
            tool('code.listFiles', 'List repository tree entries.', ['code:read'], false, 'read'),
            tool('code.openFile', 'Read a bounded code file segment.', ['code:read'], false, 'read'),
            tool('code.search', 'Search repository code paths and symbols.', ['code:read'], false, 'read'),
            tool('code.showDiff', 'Show a diff against main or staged changes.', ['code:read'], false, 'read'),
            tool('code.listBranches', 'List branches in the current repository.', ['code:read'], false, 'read'),
            tool('code.switchBranch', 'Switch the working branch.', ['code:write'], true, 'write'),
            tool('code.listCommits', 'List commit history.', ['code:read'], false, 'read'),
            tool('code.showHistory', 'Show file or repository history.', ['code:read'], false, 'read'),
            tool('code.runPipeline', 'Run tests or pipeline tasks.', ['code:write'], true, 'execute'),
            tool('code.generateSummary', 'Generate a repository summary through orchestrator context.', ['code:read'], false, 'read'),
        ],
    }),
    new DemoMCPServer({
        id: 'jira',
        name: 'JIRA Atlassian MCP',
        authMode: 'oauth',
        capabilities: [
            {
                name: 'jira-projects',
                description: 'Report Jira backend availability and imported operator-verified Atlassian evidence.',
                permissions: ['jira:read'],
            },
            {
                name: 'jira-write',
                description: 'Proposal write-path for Jira issues. No live Atlassian write is executed; proposals require approval and are recorded in the audit log.',
                permissions: ['jira:write'],
            },
        ],
        tools: [
            tool('jira.discoveryStatus', 'Report Jira MCP backend availability.', ['jira:read'], false, 'read'),
            tool('jira.projectEvidence', 'Read imported Jira project evidence captured outside the backend service.', ['jira:read'], false, 'read'),
            tool('jira.issueEvidence', 'Read imported Jira issue evidence captured outside the backend service.', ['jira:read'], false, 'read'),
            tool(
                'jira.createIssue',
                'Propose creating a Jira issue. No live write is executed.',
                ['jira:write'],
                true,
                'write',
                'Propose creating a new Jira issue with the given fields. This is a proposal only — no live Atlassian write is performed.',
            ),
            tool(
                'jira.transitionIssue',
                'Propose transitioning a Jira issue. No live write is executed.',
                ['jira:write'],
                true,
                'write',
                'Propose transitioning a Jira issue to a new status. This is a proposal only — no live Atlassian write is performed.',
            ),
            tool(
                'jira.addComment',
                'Propose adding a comment to a Jira issue. No live write is executed.',
                ['jira:write'],
                true,
                'write',
                'Propose adding a comment to a Jira issue. This is a proposal only — no live Atlassian write is performed.',
            ),
            tool(
                'jira.assignIssue',
                'Propose assigning a Jira issue. No live write is executed.',
                ['jira:write'],
                true,
                'write',
                'Propose assigning a Jira issue to a user. This is a proposal only — no live Atlassian write is performed.',
            ),
            tool(
                'jira.updateLabels',
                'Propose updating labels on a Jira issue. No live write is executed.',
                ['jira:write'],
                true,
                'write',
                'Propose adding or removing labels on a Jira issue. This is a proposal only — no live Atlassian write is performed.',
            ),
        ],
        handlers: {
            'jira.discoveryStatus': () => ({
                source: jiraEvidence.source,
                server: 'jira',
                tool: 'jira.discoveryStatus',
                cloudId: jiraEvidence.cloudId || ATLASSIAN_CLOUD_ID,
                site: jiraEvidence.site || ATLASSIAN_SITE,
                available: false,
                degraded: true,
                status: 'blocked',
                backendFetchAvailable: jiraAvailability.backendFetchAvailable,
                projectCatalogAvailable: jiraAvailability.projectCatalogAvailable,
                issueDiscoveryAvailable: jiraAvailability.issueDiscoveryAvailable,
                writeAvailable: jiraAvailability.writeAvailable,
                evidenceAvailable: jiraAvailability.evidenceAvailable,
                importedAt: jiraEvidence.importedAt,
                reason: jiraAvailability.blockedReason,
            }),
            'jira.projectEvidence': () => ({
                source: jiraEvidence.source,
                server: 'jira',
                tool: 'jira.projectEvidence',
                cloudId: jiraEvidence.cloudId || ATLASSIAN_CLOUD_ID,
                site: jiraEvidence.site || ATLASSIAN_SITE,
                importedAt: jiraEvidence.importedAt,
                evidenceOnly: jiraEvidence.evidenceOnly,
                note: jiraEvidence.note,
                items: jiraEvidence.projects.map(project => ({
                    id: project.id,
                    key: project.key,
                    name: project.name,
                    projectTypeKey: project.projectTypeKey,
                    simplified: project.simplified,
                    style: project.style,
                    isPrivate: project.isPrivate,
                    entityId: project.entityId,
                    issueTypes: project.issueTypes.map(issueType => ({ ...issueType })),
                })),
            }),
            'jira.issueEvidence': () => ({
                source: jiraEvidence.source,
                server: 'jira',
                tool: 'jira.issueEvidence',
                cloudId: jiraEvidence.cloudId || ATLASSIAN_CLOUD_ID,
                site: jiraEvidence.site || ATLASSIAN_SITE,
                importedAt: jiraEvidence.importedAt,
                evidenceOnly: jiraEvidence.evidenceOnly,
                note: `${jiraEvidence.note} Recent TES issue evidence was imported from structured JQL results.`,
                items: jiraEvidence.recentIssues.map(issue => ({ ...issue })),
            }),
        },
    }),
    new DemoMCPServer({
        id: 'confluence',
        name: 'CONFLUENCE Atlassian MCP',
        authMode: 'oauth',
        capabilities: [
            {
                name: 'confluence-spaces',
                description: CONFLUENCE_DISCOVERY_AVAILABLE
                    ? 'Search, read, and write Confluence pages through Atlassian MCP tools.'
                    : 'Confluence discovery is unavailable; expose status only through MCP.',
                permissions: CONFLUENCE_DISCOVERY_AVAILABLE ? ['confluence:read', 'confluence:write'] : ['confluence:read'],
            },
        ],
        tools: CONFLUENCE_DISCOVERY_AVAILABLE
            ? [
                tool('confluence.discoveryStatus', 'Report Confluence MCP discovery availability.', ['confluence:read'], false, 'read'),
                tool('confluence.listSpaces', 'List Confluence spaces.', ['confluence:read'], false, 'read'),
                tool('confluence.listPages', 'List pages by space.', ['confluence:read'], false, 'read'),
                tool('confluence.getPage', 'Get one Confluence page.', ['confluence:read'], false, 'read'),
                tool('confluence.search', 'Search Confluence pages.', ['confluence:read'], false, 'read'),
                tool('confluence.createPage', 'Create an approved Confluence page.', ['confluence:write'], true, 'write'),
                tool('confluence.updatePage', 'Update an approved Confluence page.', ['confluence:write'], true, 'write'),
            ]
            : [
                tool('confluence.discoveryStatus', 'Report Confluence MCP discovery availability.', ['confluence:read'], false, 'read'),
            ],
        handlers: {
            'confluence.discoveryStatus': () => ({
                source: 'atlassian-mcp',
                server: 'confluence',
                tool: 'confluence.discoveryStatus',
                cloudId: ATLASSIAN_CLOUD_ID,
                site: ATLASSIAN_SITE,
                available: CONFLUENCE_DISCOVERY_AVAILABLE,
                degraded: !CONFLUENCE_DISCOVERY_AVAILABLE,
                status: CONFLUENCE_DISCOVERY_AVAILABLE ? 'available' : 'blocked',
                rovoSearchAvailable: ROVO_SEARCH_AVAILABLE,
                discoveryAvailable: CONFLUENCE_DISCOVERY_AVAILABLE,
                viewerAvailable: CONFLUENCE_DISCOVERY_AVAILABLE,
                pageReadAvailable: CONFLUENCE_DISCOVERY_AVAILABLE,
                searchAvailable: CONFLUENCE_DISCOVERY_AVAILABLE && ROVO_SEARCH_AVAILABLE,
                searchToolAvailable: CONFLUENCE_DISCOVERY_AVAILABLE,
                writeAvailable: CONFLUENCE_DISCOVERY_AVAILABLE,
                reason: CONFLUENCE_DISCOVERY_AVAILABLE
                    ? 'Confluence discovery tools are registered through Atlassian MCP.'
                    : 'Rovo search failed or app access is unavailable, so Confluence discovery remains MCP-status only.',
            }),
            'confluence.listSpaces': () => ({
                source: 'atlassian-mcp',
                server: 'confluence',
                tool: 'confluence.listSpaces',
                cloudId: ATLASSIAN_CLOUD_ID,
                site: ATLASSIAN_SITE,
                items: [
                    { key: 'HAOS', name: 'Havas Agentic OS', access: 'Read' },
                    { key: 'CXOS', name: 'CX Operating System', access: 'Read' },
                ],
            }),
            'confluence.listPages': input => ({
                source: 'atlassian-mcp',
                server: 'confluence',
                tool: 'confluence.listPages',
                cloudId: ATLASSIAN_CLOUD_ID,
                site: ATLASSIAN_SITE,
                request: scrubInput(input),
                items: [
                    { title: 'MCP Integration Contract', space: 'HAOS', updated: 'Today' },
                    { title: 'Agent Permission Matrix', space: 'HAOS', updated: 'Yesterday' },
                ],
            }),
            'confluence.getPage': input => ({
                source: 'atlassian-mcp',
                server: 'confluence',
                tool: 'confluence.getPage',
                cloudId: ATLASSIAN_CLOUD_ID,
                site: ATLASSIAN_SITE,
                request: scrubInput(input),
                item: {
                    title: 'MCP Integration Contract',
                    space: 'HAOS',
                    body: 'CODE, JIRA, and CONFLUENCE surfaces must use MCP endpoints first and fallback to local demo data.',
                },
            }),
            'confluence.search': input => ({
                source: 'atlassian-mcp',
                server: 'confluence',
                tool: 'confluence.search',
                cloudId: ATLASSIAN_CLOUD_ID,
                site: ATLASSIAN_SITE,
                request: scrubInput(input),
                items: [
                    { title: 'CODE Workspace Notes', excerpt: 'Tree, diff, PR, and history are MCP-backed.' },
                    { title: 'Jira Delivery Flow', excerpt: 'Issues include comments and acceptance criteria.' },
                ],
            }),
        },
    }),
];

function tool (
    name: string,
    description: string,
    permissions: string[],
    write: boolean,
    actionType: 'read' | 'write' | 'execute',
    proposalDescription?: string,
): Omit<MCPToolDefinition, 'serverId'> {
    return {
        name,
        description,
        actionType,
        permissions,
        write,
        proposalDescription,
        retry,
        inputSchema: {
            type: 'object',
            additionalProperties: true,
        },
        outputSchema: textResultSchema,
    };
}

function scrubInput (input: unknown): unknown {
    if ( !input || typeof input !== 'object' ) return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, value]) => {
        const normalized = key.toLowerCase();
        if ( normalized.includes('token') || normalized.includes('secret') || normalized.includes('password') ) {
            return [key, '[redacted]'];
        }
        return [key, typeof value === 'string' ? asText(value, value) : value];
    }));
}

function envFlag (name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if ( value === undefined ) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
