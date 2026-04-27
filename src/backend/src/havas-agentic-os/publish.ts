import type { AuditLog } from './audit.js';
import type { PublishSubmission } from './types.js';
import { actorFrom, asText, createId, nowISO } from './utils.js';

export class PublishPipeline {
    #submissions = new Map<string, PublishSubmission>();
    #audit: AuditLog;

    constructor (audit: AuditLog) {
        this.#audit = audit;
    }

    list (): PublishSubmission[] {
        return [...this.#submissions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    submit (input: { appId?: unknown; name?: unknown; version?: unknown; notes?: unknown; actor?: unknown }): PublishSubmission {
        const name = asText(input.name);
        const version = asText(input.version, '0.1.0');
        if ( ! name ) throw new Error('publish_name_required');
        const submission: PublishSubmission = {
            id: createId('pub'),
            appId: asText(input.appId, name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
            name,
            version,
            status: 'submitted',
            notes: asText(input.notes, 'Submitted from Havas Dev Center'),
            updatedAt: nowISO(),
        };
        this.#submissions.set(submission.id, submission);
        this.#audit.record('publish.submit', input.actor, submission.id, { name, version });
        return { ...submission };
    }

    review (input: { submissionId?: unknown; approved?: unknown; reviewer?: unknown; notes?: unknown }): PublishSubmission {
        const id = asText(input.submissionId);
        const submission = this.#submissions.get(id);
        if ( ! submission ) throw new Error('submission_not_found');
        submission.status = input.approved === false ? 'rejected' : 'approved';
        submission.reviewer = actorFrom(input.reviewer);
        submission.notes = asText(input.notes, submission.notes);
        submission.updatedAt = nowISO();
        this.#audit.record('publish.review', submission.reviewer, id, { status: submission.status });
        return { ...submission };
    }

    publish (input: { submissionId?: unknown; actor?: unknown }): PublishSubmission {
        const id = asText(input.submissionId);
        const submission = this.#submissions.get(id);
        if ( ! submission ) throw new Error('submission_not_found');
        if ( submission.status !== 'approved' ) throw new Error('submission_not_approved');
        submission.status = 'published';
        submission.updatedAt = nowISO();
        this.#audit.record('publish.release', input.actor, id, { appId: submission.appId });
        return { ...submission };
    }
}
