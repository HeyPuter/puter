import { AuditLog } from './audit.js';
import { MemoryStore } from './memory.js';
import { MCPHub } from './mcp-hub.js';
import { createDemoMCPServers } from './mcp-demo-servers.js';
import { AgentOrchestrator } from './orchestrator.js';
import { PermissionStore } from './permissions.js';
import { PublishPipeline } from './publish.js';
import { AgentRegistry } from './registry.js';
import { TaskMonitor } from './tasks.js';

const audit = new AuditLog();
const registry = new AgentRegistry();
const permissions = new PermissionStore();
const memory = new MemoryStore();
const tasks = new TaskMonitor();
const publish = new PublishPipeline(audit);
const mcp = new MCPHub(audit);
createDemoMCPServers().forEach(server => {
    mcp.register(server);
    mcp.connect({ serverId: server.id, protocol: 'mcp', actor: 'system' });
});
const orchestrator = new AgentOrchestrator({ registry, permissions, memory, tasks, audit, mcp });

audit.record('system.ready', 'havas-agentic-os', 'core', { mode: 'self-hosted-demo' });

export const havasAgenticOS = {
    audit,
    registry,
    permissions,
    memory,
    tasks,
    publish,
    mcp,
    orchestrator,
};

export type HavasAgenticOS = typeof havasAgenticOS;
