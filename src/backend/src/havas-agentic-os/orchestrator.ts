import type { AuditLog } from './audit.js';
import type { MemoryStore } from './memory.js';
import type { MCPHub } from './mcp-hub.js';
import type { PermissionStore } from './permissions.js';
import type { AgentRegistry } from './registry.js';
import type { TaskMonitor } from './tasks.js';
import type { AgentDefinition, MCPToolCallResult, TaskState } from './types.js';
import { actorFrom, asText } from './utils.js';

export class AgentOrchestrator {
    #registry: AgentRegistry;
    #permissions: PermissionStore;
    #memory: MemoryStore;
    #tasks: TaskMonitor;
    #audit: AuditLog;
    #mcp: MCPHub;

    constructor (deps: {
        registry: AgentRegistry;
        permissions: PermissionStore;
        memory: MemoryStore;
        tasks: TaskMonitor;
        audit: AuditLog;
        mcp: MCPHub;
    }) {
        this.#registry = deps.registry;
        this.#permissions = deps.permissions;
        this.#memory = deps.memory;
        this.#tasks = deps.tasks;
        this.#audit = deps.audit;
        this.#mcp = deps.mcp;
    }

    install (agentId: unknown, actor?: unknown): AgentDefinition {
        const agent = this.#registry.install(agentId);
        this.#audit.record('agent.install', actor, agent.id, { scopes: agent.scopes });
        return agent;
    }

    run (input: { agentId?: unknown; goal?: unknown; actor?: unknown }): { agent: AgentDefinition; task: TaskState; requiresApproval: string[] } {
        const agentId = asText(input.agentId);
        const actor = actorFrom(input.actor);
        const agent = this.#registry.get(agentId);
        if ( ! agent ) throw new Error('agent_not_found');

        const approved = this.#permissions.has(agent.id, agent.scopes);
        const missingScopes = approved ? [] : agent.scopes;
        if ( missingScopes.length ) {
            this.#audit.record('agent.run.blocked', actor, agent.id, { missingScopes });
            return {
                agent,
                task: this.#tasks.create(agent.id, 'Waiting for permissions'),
                requiresApproval: missingScopes,
            };
        }

        const runningAgent = this.#registry.markRunning(agent.id);
        const task = this.#tasks.create(agent.id, input.goal || `${agent.name} run`);
        this.#tasks.update(task.id, 'completed', 100, {
            message: `${runningAgent.name} completed demo-safe local run.`,
        });
        this.#memory.set({
            namespace: actor,
            key: `last-run:${agent.id}`,
            value: { goal: asText(input.goal, 'status'), taskId: task.id },
        });
        this.#audit.record('agent.run', actor, agent.id, { taskId: task.id });
        return { agent: runningAgent, task: this.#tasks.list()[0], requiresApproval: [] };
    }

    runMCP (input: {
        intent?: unknown;
        serverId?: unknown;
        toolName?: unknown;
        arguments?: unknown;
        actor?: unknown;
        approval?: { approved?: unknown; reason?: unknown };
    }): { task: TaskState; toolCall: MCPToolCallResult } {
        const actor = actorFrom(input.actor);
        const tool = this.#mcp.selectTool(input);
        const task = this.#tasks.create(`mcp:${tool.serverId}`, asText(input.intent, tool.description));
        const toolCall = this.#mcp.callTool({ ...input, protocol: 'mcp', actor });
        const status = toolCall.requiresApproval
            ? 'queued'
            : toolCall.ok
                ? 'completed'
                : 'failed';
        this.#tasks.update(task.id, status, toolCall.requiresApproval ? 10 : toolCall.ok ? 100 : 90, {
            chain: [
                {
                    step: 'select_tool',
                    serverId: tool.serverId,
                    toolName: tool.name,
                },
                {
                    step: 'call_tool',
                    ok: toolCall.ok,
                    auditId: toolCall.auditId,
                    approvalMode: toolCall.approvalMode,
                    permissionDecision: toolCall.permissionDecision,
                },
            ],
            toolCall,
        });
        this.#audit.record('agent.mcp.select', actor, tool.name, {
            serverId: tool.serverId,
            mcpFirst: true,
            write: tool.write,
            retry: tool.retry,
        });
        return { task: this.#tasks.list().find(item => item.id === task.id) || task, toolCall };
    }
}
