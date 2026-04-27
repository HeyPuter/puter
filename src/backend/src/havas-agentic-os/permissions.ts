import type { PermissionGrant } from './types.js';
import { actorFrom, asText, createId, nowISO } from './utils.js';

export class PermissionStore {
    #grants = new Map<string, PermissionGrant>();

    list (agentId?: unknown): PermissionGrant[] {
        const id = asText(agentId);
        return [...this.#grants.values()]
            .filter(grant => !id || grant.agentId === id)
            .map(grant => ({ ...grant }));
    }

    approve (input: { agentId: unknown; scope: unknown; actor?: unknown; reason?: unknown }): PermissionGrant {
        const agentId = asText(input.agentId);
        const scope = asText(input.scope);
        if ( !agentId || !scope ) throw new Error('agentId_and_scope_required');
        const id = `${agentId}:${scope}`;
        const grant: PermissionGrant = {
            id,
            agentId,
            scope,
            status: 'approved',
            actor: actorFrom(input.actor),
            reason: asText(input.reason, 'approved for demo workspace'),
            updatedAt: nowISO(),
        };
        this.#grants.set(id, grant);
        return { ...grant };
    }

    revoke (input: { agentId: unknown; scope: unknown; actor?: unknown; reason?: unknown }): PermissionGrant {
        const grant = this.approve(input);
        grant.status = 'revoked';
        grant.reason = asText(input.reason, 'revoked');
        grant.updatedAt = nowISO();
        this.#grants.set(grant.id, grant);
        return { ...grant };
    }

    has (agentId: string, scopes: string[]): boolean {
        return scopes.every(scope => this.#grants.get(`${agentId}:${scope}`)?.status === 'approved');
    }
}
