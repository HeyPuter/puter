export type AgentStatus = 'available' | 'installed' | 'running' | 'disabled';
export type PermissionStatus = 'pending' | 'approved' | 'revoked';
export type PublishStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'published';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ApprovalMode = 'not_required' | 'approve_once' | 'approve_per_action';
export type PermissionDecision = 'allowed' | 'denied' | 'approved_once' | 'approved_per_action';
export type MCPActionType = 'read' | 'write' | 'execute';

export interface AgentDefinition {
    id: string;
    name: string;
    category: string;
    summary: string;
    scopes: string[];
    status: AgentStatus;
    version: string;
}

export interface PermissionGrant {
    id: string;
    agentId: string;
    scope: string;
    status: PermissionStatus;
    actor: string;
    reason: string;
    updatedAt: string;
}

export interface AuditEvent {
    id: string;
    action: string;
    actor: string;
    target: string;
    details: Record<string, unknown>;
    createdAt: string;
    appendIndex: number;
}

export interface MemoryRecord {
    key: string;
    value: unknown;
    namespace: string;
    updatedAt: string;
}

export interface PublishSubmission {
    id: string;
    appId: string;
    name: string;
    version: string;
    status: PublishStatus;
    notes: string;
    reviewer?: string;
    updatedAt: string;
}

export interface TaskState {
    id: string;
    agentId: string;
    title: string;
    status: TaskStatus;
    progress: number;
    result?: unknown;
    updatedAt: string;
}

export type MCPServerStatus = 'disconnected' | 'connected' | 'unhealthy';

export interface MCPToolDefinition {
    name: string;
    serverId: string;
    description: string;
    actionType: MCPActionType;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    permissions: string[];
    write: boolean;
    proposalDescription?: string;
    retry: {
        maxAttempts: number;
        backoffMs: number;
    };
}

export interface MCPCapability {
    serverId: string;
    name: string;
    description: string;
    permissions: string[];
}

export interface MCPConnectionState {
    serverId: string;
    status: MCPServerStatus;
    protocol: 'mcp';
    auth: {
        mode: string;
        configured: boolean;
    };
    grantedPermissions: string[];
    requestedPermissions: string[];
    approvalMode: ApprovalMode;
    lastConnectedAt?: string;
    lastHealthAt?: string;
    lastError?: string;
    secretRef?: string;
    reconnect: {
        attempts: number;
        nextBackoffMs: number;
    };
}

export interface MCPToolError {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown> | null;
}

export interface MCPToolCallResult {
    serverId: string;
    toolName: string;
    actionType: MCPActionType;
    ok: boolean;
    result?: unknown;
    error?: MCPToolError | null;
    requiresApproval?: boolean;
    approvalScope?: string;
    approvalMode: ApprovalMode;
    permissionDecision: PermissionDecision;
    auditId?: string;
    timestamp: string;
    retry: {
        attempt: number;
        maxAttempts: number;
        backoffMs: number;
    };
    proposal?: {
        proposalId: string;
        description: string;
        auditId: string;
        timestamp: string;
    };
}

export interface ProposalRecord {
    proposalId: string;
    serverId: string;
    toolName: string;
    description: string;
    actor: string;
    auditId: string;
    createdAt: string;
}
