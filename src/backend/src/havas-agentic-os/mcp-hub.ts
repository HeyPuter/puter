import type { AuditLog } from './audit.js';
import { AuthStateStore } from './auth-state.js';
import type {
    ApprovalMode,
    MCPCapability,
    MCPConnectionState,
    MCPServerStatus,
    MCPToolError,
    MCPToolCallResult,
    MCPToolDefinition,
    ProposalRecord,
} from './types.js';
import { actorFrom, asText, createId, nowISO } from './utils.js';

export interface MCPDemoServer {
    id: string;
    name: string;
    authMode: string;
    capabilities: MCPCapability[];
    tools: MCPToolDefinition[];
    connect(input: { protocol: unknown; auth?: Record<string, unknown> }): MCPConnectionState;
    health(): { status: MCPServerStatus; checkedAt: string };
    callTool(name: string, input: unknown): unknown;
}

export class MCPServerRegistry {
    #servers = new Map<string, MCPDemoServer>();

    register (server: MCPDemoServer): void {
        this.#servers.set(server.id, server);
    }

    get (serverId: unknown): MCPDemoServer | undefined {
        return this.#servers.get(asText(serverId));
    }

    list (): MCPDemoServer[] {
        return [...this.#servers.values()];
    }
}

export class MCPClientRegistry {
    #connections = new Map<string, MCPConnectionState>();

    get (serverId: string): MCPConnectionState | undefined {
        const state = this.#connections.get(serverId);
        return state ? copyConnection(state) : undefined;
    }

    set (state: MCPConnectionState): MCPConnectionState {
        this.#connections.set(state.serverId, copyConnection(state));
        return copyConnection(state);
    }

    list (): MCPConnectionState[] {
        return [...this.#connections.values()].map(copyConnection);
    }
}

export class MCPHub {
    readonly servers = new MCPServerRegistry();
    readonly clients = new MCPClientRegistry();
    #audit: AuditLog;
    #authState: AuthStateStore;
    #proposals = new Map<string, ProposalRecord>();

    constructor (audit: AuditLog, authState = new AuthStateStore()) {
        this.#audit = audit;
        this.#authState = authState;
    }

    register (server: MCPDemoServer): void {
        this.servers.register(server);
        this.clients.set({
            serverId: server.id,
            status: 'disconnected',
            protocol: 'mcp',
            auth: { mode: server.authMode, configured: false },
            grantedPermissions: this.#permissionsFor(server).filter(permission => permission.endsWith(':read')),
            requestedPermissions: this.#permissionsFor(server),
            approvalMode: 'approve_per_action',
            reconnect: { attempts: 0, nextBackoffMs: 250 },
        });
    }

    tools (): MCPToolDefinition[] {
        return this.servers.list().flatMap(server => server.tools.map(tool => ({ ...tool })));
    }

    capabilities (): MCPCapability[] {
        return this.servers.list().flatMap(server => server.capabilities.map(capability => ({ ...capability })));
    }

    proposalTools (): MCPToolDefinition[] {
        return this.tools().filter(tool => Boolean(tool.proposalDescription));
    }

    proposals (): ProposalRecord[] {
        return [...this.#proposals.values()];
    }

    connect (input: { serverId: unknown; protocol?: unknown; auth?: Record<string, unknown>; actor?: unknown }): MCPConnectionState {
        const server = this.#server(input.serverId);
        const state = server.connect({ protocol: input.protocol || 'mcp', auth: input.auth });
        const current = this.clients.get(server.id);
        const secretRef = this.#authState.save(server.id, input.auth);
        const connected = this.clients.set({
            ...state,
            grantedPermissions: current?.grantedPermissions || this.#permissionsFor(server).filter(permission => permission.endsWith(':read')),
            requestedPermissions: this.#permissionsFor(server),
            approvalMode: current?.approvalMode || 'approve_per_action',
            secretRef: secretRef || current?.secretRef,
            reconnect: { attempts: 0, nextBackoffMs: 250 },
        });
        this.#audit.record('mcp.connect', input.actor, server.id, {
            protocol: connected.protocol,
            status: connected.status,
            auth: connected.auth,
        });
        return connected;
    }

    health (serverId?: unknown): MCPConnectionState[] {
        const servers = asText(serverId) ? [this.#server(serverId)] : this.servers.list();
        return servers.map(server => {
            const current = this.clients.get(server.id);
            const health = server.health();
            const attempts = health.status === 'connected' ? 0 : (current?.reconnect.attempts || 0) + 1;
            return this.clients.set({
                serverId: server.id,
                status: health.status,
                protocol: 'mcp',
                auth: current?.auth || { mode: server.authMode, configured: false },
                grantedPermissions: current?.grantedPermissions || this.#permissionsFor(server).filter(permission => permission.endsWith(':read')),
                requestedPermissions: this.#permissionsFor(server),
                approvalMode: current?.approvalMode || 'approve_per_action',
                lastConnectedAt: current?.lastConnectedAt,
                lastHealthAt: health.checkedAt,
                lastError: current?.lastError,
                secretRef: current?.secretRef,
                reconnect: {
                    attempts,
                    nextBackoffMs: Math.min(8000, 250 * Math.max(1, 2 ** attempts)),
                },
            });
        });
    }

    negotiate (input: {
        serverId: unknown;
        permissions?: unknown;
        actor?: unknown;
        approvalMode?: unknown;
    }): MCPConnectionState {
        const server = this.#server(input.serverId);
        const requested = new Set(this.#permissionsFor(server));
        const granted = Array.isArray(input.permissions)
            ? input.permissions.map(item => asText(item)).filter(permission => requested.has(permission))
            : [];
        const current = this.clients.get(server.id);
        const approvalMode = asApprovalMode(input.approvalMode, current?.approvalMode);
        const state = this.clients.set({
            serverId: server.id,
            status: current?.status || 'disconnected',
            protocol: 'mcp',
            auth: current?.auth || { mode: server.authMode, configured: false },
            grantedPermissions: [...new Set([...(current?.grantedPermissions || []), ...granted])],
            requestedPermissions: [...requested],
            approvalMode,
            lastConnectedAt: current?.lastConnectedAt,
            lastHealthAt: current?.lastHealthAt,
            lastError: current?.lastError,
            secretRef: current?.secretRef,
            reconnect: current?.reconnect || { attempts: 0, nextBackoffMs: 250 },
        });
        this.#audit.record('mcp.permissions.negotiate', input.actor, server.id, {
            grantedPermissions: state.grantedPermissions,
            requestedPermissions: state.requestedPermissions,
            approvalMode: state.approvalMode,
        });
        return state;
    }

    selectTool (input: { intent?: unknown; serverId?: unknown; toolName?: unknown; write?: unknown }): MCPToolDefinition {
        const explicit = asText(input.toolName);
        const serverId = asText(input.serverId);
        const intent = asText(input.intent).toLowerCase();
        const tools = this.tools()
            .filter(tool => !serverId || tool.serverId === serverId)
            .filter(tool => explicit ? tool.name === explicit : true)
            .filter(tool => input.write === undefined || tool.write === Boolean(input.write));
        const selected = tools.find(tool => intent && intent.includes(tool.serverId))
            || tools.find(tool => intent && intent.includes(tool.name.split('.').at(-1) || tool.name))
            || tools[0];
        if ( ! selected ) throw new Error('mcp_tool_not_found');
        return selected;
    }

    callTool (input: {
        serverId?: unknown;
        toolName?: unknown;
        intent?: unknown;
        arguments?: unknown;
        protocol?: unknown;
        actor?: unknown;
        approval?: { approved?: unknown; reason?: unknown; mode?: unknown };
    }): MCPToolCallResult {
        if ( asText(input.protocol || 'mcp') !== 'mcp' ) throw new Error('mcp_protocol_required');
        const tool = this.selectTool(input);
        const server = this.#server(tool.serverId);
        const state = this.clients.get(server.id);
        if ( state?.status !== 'connected' ) throw new Error('mcp_server_not_connected');
        const retry = { attempt: 1, ...tool.retry };
        const timestamp = nowISO();
        const permission = tool.permissions.find(candidate => candidate.endsWith(tool.write ? ':write' : ':read'))
            || tool.permissions[0];
        if ( permission && !state.grantedPermissions.includes(permission) ) {
            const denied = this.#audit.record('mcp.tool.denied', input.actor, tool.name, {
                serverId: server.id,
                permission,
                reason: 'permission_not_granted',
            });
            return {
                serverId: server.id,
                toolName: tool.name,
                actionType: tool.actionType,
                ok: false,
                error: makeError('mcp_permission_denied', `Missing permission: ${permission}`, false, { permission }),
                approvalMode: state.approvalMode,
                permissionDecision: 'denied',
                auditId: denied.id,
                timestamp,
                retry,
            };
        }
        if ( tool.write && state.approvalMode === 'approve_per_action' && input.approval?.approved !== true ) {
            const approvalRequired = this.#audit.record('mcp.tool.approval_required', input.actor, tool.name, {
                serverId: server.id,
                approvalScope: `mcp:${tool.name}`,
                retry,
                approvalMode: state.approvalMode,
            });
            return {
                serverId: server.id,
                toolName: tool.name,
                actionType: tool.actionType,
                ok: false,
                requiresApproval: true,
                approvalScope: `mcp:${tool.name}`,
                approvalMode: state.approvalMode,
                permissionDecision: 'denied',
                auditId: approvalRequired.id,
                timestamp,
                retry,
            };
        }
        const callId = createId('mcp_call');
        if ( tool.write && tool.proposalDescription ) {
            const proposalId = createId('proposal');
            const proposalAudit = this.#audit.record('mcp.tool.proposal_submitted', input.actor, tool.name, {
                proposalId,
                callId,
                serverId: server.id,
                description: tool.proposalDescription,
                approvalMode: state.approvalMode,
            });
            this.#proposals.set(proposalId, {
                proposalId,
                serverId: server.id,
                toolName: tool.name,
                description: tool.proposalDescription,
                actor: actorFrom(input.actor),
                auditId: proposalAudit.id,
                createdAt: timestamp,
            });
            return {
                serverId: server.id,
                toolName: tool.name,
                actionType: tool.actionType,
                ok: true,
                result: {
                    proposal: true,
                    proposalId,
                    tool: tool.name,
                    description: tool.proposalDescription,
                    auditId: proposalAudit.id,
                    message: `Proposal submitted for ${tool.name}. No live Jira write was executed. Approve to track this proposal in the audit log.`,
                },
                error: null,
                approvalMode: state.approvalMode,
                permissionDecision: 'approved_per_action',
                auditId: proposalAudit.id,
                timestamp,
                retry,
                proposal: {
                    proposalId,
                    description: tool.proposalDescription,
                    auditId: proposalAudit.id,
                    timestamp,
                },
            };
        }
        try {
            const result = server.callTool(tool.name, input.arguments || {});
            const audit = this.#audit.record('mcp.tool.call', input.actor, tool.name, {
                callId,
                serverId: server.id,
                write: tool.write,
                retry,
                approvalMode: tool.write ? state.approvalMode : 'not_required',
                result: 'success',
            });
            return {
                serverId: server.id,
                toolName: tool.name,
                actionType: tool.actionType,
                ok: true,
                result,
                error: null,
                approvalMode: tool.write ? state.approvalMode : 'not_required',
                permissionDecision: tool.write
                    ? state.approvalMode === 'approve_once'
                        ? 'approved_once'
                        : 'approved_per_action'
                    : 'allowed',
                auditId: audit.id,
                timestamp,
                retry,
            };
        } catch ( error ) {
            const toolError = makeError(
                'mcp_tool_failed',
                error instanceof Error ? error.message : 'Unknown MCP tool failure',
                true,
                { callId, serverId: server.id },
            );
            const audit = this.#audit.record('mcp.tool.error', input.actor, tool.name, {
                callId,
                serverId: server.id,
                write: tool.write,
                retry,
                error: toolError,
            });
            this.clients.set({
                ...state,
                lastError: toolError.message,
            });
            return {
                serverId: server.id,
                toolName: tool.name,
                actionType: tool.actionType,
                ok: false,
                error: toolError,
                approvalMode: tool.write ? state.approvalMode : 'not_required',
                permissionDecision: 'denied',
                auditId: audit.id,
                timestamp,
                retry,
            };
        }
    }

    #server (serverId: unknown): MCPDemoServer {
        const server = this.servers.get(serverId);
        if ( ! server ) throw new Error('mcp_server_not_found');
        return server;
    }

    #permissionsFor (server: MCPDemoServer): string[] {
        return [...new Set(server.tools.flatMap(tool => tool.permissions))];
    }
}

function copyConnection (state: MCPConnectionState): MCPConnectionState {
    return {
        ...state,
        auth: { ...state.auth },
        grantedPermissions: [...state.grantedPermissions],
        requestedPermissions: [...state.requestedPermissions],
        approvalMode: state.approvalMode,
        lastError: state.lastError,
        secretRef: state.secretRef,
        reconnect: { ...state.reconnect },
    };
}

export const makeConnectionState = (server: MCPDemoServer, auth?: Record<string, unknown>): MCPConnectionState => ({
    serverId: server.id,
    status: 'connected',
    protocol: 'mcp',
    auth: {
        mode: server.authMode,
        configured: Object.keys(auth || {}).length > 0,
    },
    grantedPermissions: server.tools.flatMap(tool => tool.permissions).filter(permission => permission.endsWith(':read')),
    requestedPermissions: server.tools.flatMap(tool => tool.permissions),
    approvalMode: 'approve_per_action',
    lastConnectedAt: nowISO(),
    reconnect: { attempts: 0, nextBackoffMs: 250 },
});

export const assertMCPProtocol = (protocol: unknown): void => {
    if ( asText(protocol) !== 'mcp' ) throw new Error('mcp_protocol_required');
};

export const actorForMCP = actorFrom;

function asApprovalMode (value: unknown, fallback: ApprovalMode = 'approve_per_action'): ApprovalMode {
    const mode = asText(value);
    if ( mode === 'approve_once' || mode === 'approve_per_action' || mode === 'not_required' ) return mode;
    return fallback;
}

function makeError (
    code: string,
    message: string,
    retryable: boolean,
    details: Record<string, unknown> | null = null,
): MCPToolError {
    return { code, message, retryable, details };
}
