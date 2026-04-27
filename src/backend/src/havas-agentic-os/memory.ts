import type { MemoryRecord } from './types.js';
import { asText, nowISO } from './utils.js';

const MAX_MEMORY_RECORDS = 100;

export class MemoryStore {
    #records = new Map<string, MemoryRecord>();

    list (namespace: unknown = 'default'): MemoryRecord[] {
        const ns = asText(namespace, 'default');
        return [...this.#records.values()]
            .filter(record => record.namespace === ns)
            .map(record => ({ ...record }));
    }

    set (input: { namespace?: unknown; key: unknown; value: unknown }): MemoryRecord {
        const namespace = asText(input.namespace, 'default');
        const key = asText(input.key);
        if ( ! key ) throw new Error('memory_key_required');
        const record = { key, value: input.value ?? null, namespace, updatedAt: nowISO() };
        this.#records.set(`${namespace}:${key}`, record);
        if ( this.#records.size > MAX_MEMORY_RECORDS ) {
            const firstKey = this.#records.keys().next().value;
            if ( typeof firstKey === 'string' ) this.#records.delete(firstKey);
        }
        return { ...record };
    }

    delete (namespace: unknown, key: unknown): boolean {
        return this.#records.delete(`${asText(namespace, 'default')}:${asText(key)}`);
    }
}
