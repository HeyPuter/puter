import type { TaskState, TaskStatus } from './types.js';
import { asText, createId, nowISO } from './utils.js';

const MAX_TASKS = 100;

export class TaskMonitor {
    #tasks = new Map<string, TaskState>();

    list (): TaskState[] {
        return [...this.#tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    create (agentId: string, title: unknown): TaskState {
        const task: TaskState = {
            id: createId('task'),
            agentId,
            title: asText(title, 'Agent task'),
            status: 'queued',
            progress: 0,
            updatedAt: nowISO(),
        };
        this.#tasks.set(task.id, task);
        if ( this.#tasks.size > MAX_TASKS ) {
            const oldest = this.list().at(-1);
            if ( oldest ) this.#tasks.delete(oldest.id);
        }
        return { ...task };
    }

    update (id: string, status: TaskStatus, progress: number, result?: unknown): TaskState {
        const task = this.#tasks.get(id);
        if ( ! task ) throw new Error('task_not_found');
        task.status = status;
        task.progress = Math.max(0, Math.min(100, progress));
        task.result = result;
        task.updatedAt = nowISO();
        return { ...task };
    }
}
