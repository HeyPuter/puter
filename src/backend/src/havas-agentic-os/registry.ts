import type { AgentDefinition } from './types.js';
import { asText } from './utils.js';

const seedAgents: AgentDefinition[] = [
    {
        id: 'app-center-curator',
        name: 'App Center Curator',
        category: 'marketplace',
        summary: 'Indexes installable tools and keeps Havas app metadata consistent.',
        scopes: ['inventory:read', 'apps:install'],
        status: 'available',
        version: '0.1.0',
    },
    {
        id: 'dev-center-publisher',
        name: 'Dev Center Publisher',
        category: 'publish',
        summary: 'Stages submissions, review decisions, and marketplace publishing.',
        scopes: ['publish:submit', 'publish:review', 'publish:release'],
        status: 'available',
        version: '0.1.0',
    },
    {
        id: 'task-monitor',
        name: 'Task Monitor',
        category: 'operations',
        summary: 'Tracks agent runs, pipeline jobs, and operator-visible outcomes.',
        scopes: ['tasks:read', 'tasks:write'],
        status: 'installed',
        version: '0.1.0',
    },
    {
        id: 'memory-steward',
        name: 'Memory Steward',
        category: 'memory',
        summary: 'Stores demo-safe workspace notes without secrets or external calls.',
        scopes: ['memory:read', 'memory:write'],
        status: 'installed',
        version: '0.1.0',
    },
];

export class AgentRegistry {
    #agents = new Map(seedAgents.map(agent => [agent.id, { ...agent }]));

    list (): AgentDefinition[] {
        return [...this.#agents.values()].map(agent => ({ ...agent }));
    }

    get (agentId: unknown): AgentDefinition | undefined {
        return this.#agents.get(asText(agentId));
    }

    install (agentId: unknown): AgentDefinition {
        const id = asText(agentId);
        const agent = this.#agents.get(id);
        if ( ! agent ) throw new Error('agent_not_found');
        agent.status = 'installed';
        return { ...agent };
    }

    markRunning (agentId: string): AgentDefinition {
        const agent = this.#agents.get(agentId);
        if ( ! agent ) throw new Error('agent_not_found');
        agent.status = 'running';
        return { ...agent };
    }
}
