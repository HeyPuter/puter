import type { AuditEvent } from './types.js';
import { actorFrom, createId, nowISO } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';

const MAX_AUDIT_EVENTS = 300;
const DEFAULT_AUDIT_FILE = path.join(process.cwd(), '.havas-agentic-os-audit.jsonl');

export class AuditLog {
    #events: AuditEvent[] = [];
    #appendIndex = 0;
    #filePath: string;

    constructor (filePath = process.env.HAVAS_AGENTIC_OS_AUDIT_FILE || DEFAULT_AUDIT_FILE) {
        this.#filePath = filePath;
    }

    record (action: string, actor: unknown, target: string, details: Record<string, unknown> = {}): AuditEvent {
        const event: AuditEvent = {
            id: createId('audit'),
            action,
            actor: actorFrom(actor),
            target,
            details,
            createdAt: nowISO(),
            appendIndex: ++this.#appendIndex,
        };
        this.#appendToDisk(event);
        this.#events.unshift(event);
        this.#events = this.#events.slice(0, MAX_AUDIT_EVENTS);
        return event;
    }

    query (filters: { action?: string; target?: string; limit?: number } = {}): AuditEvent[] {
        const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
        return this.#events
            .filter(event => !filters.action || event.action === filters.action)
            .filter(event => !filters.target || event.target === filters.target)
            .slice(0, limit);
    }

    filePath (): string {
        return this.#filePath;
    }

    #appendToDisk (event: AuditEvent): void {
        try {
            fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
            fs.appendFileSync(this.#filePath, `${JSON.stringify(event)}\n`, 'utf8');
        } catch {
            // Keep runtime available even if append-only persistence is unavailable.
        }
    }
}
