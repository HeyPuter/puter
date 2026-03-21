import { describe, expect, it, vi } from 'vitest';
import { UploadSessionService } from './UploadSessionService.js';

const createService = () => {
    const service = new UploadSessionService({
        services: {
            get: vi.fn(),
        },
        config: {
            services: {},
            server_id: 'test-server',
            signed_uploads: {
                session_ttl_seconds: 3600,
            },
        },
        name: 'upload-session',
        args: {},
        context: {
            get: vi.fn(),
        },
    });
    service.global_config = {
        signed_uploads: {
            session_ttl_seconds: 3600,
        },
    };
    service.db = {
        read: vi.fn(),
        write: vi.fn(),
    };
    return service;
};

describe('UploadSessionService', () => {
    it('creates a session and returns normalized metadata', async () => {
        const service = createService();
        service.db.write.mockResolvedValue({ anyRowsAffected: true });
        service.db.read.mockResolvedValue([{
            uid: 'session-uid',
            user_id: 42,
            metadata_json: JSON.stringify({
                operationId: 'op-1',
            }),
        }]);

        const session = await service.createSession({
            uid: 'session-uid',
            userId: 42,
            parentUid: 'parent-uid',
            parentPath: '/user/Documents',
            targetName: 'hello.txt',
            targetPath: '/user/Documents/hello.txt',
            contentType: 'text/plain',
            size: 11,
            uploadMode: 'single',
            storageProvider: 'S3StorageController',
            stagingKey: 'upload-session/42/session-uid',
        });

        expect(service.db.write).toHaveBeenCalledTimes(1);
        expect(service.db.read).toHaveBeenCalledTimes(1);
        expect(session.uid).toBe('session-uid');
        expect(session.metadata.operationId).toBe('op-1');
    });

    it('uses compare-and-set style update when consuming for completion', async () => {
        const service = createService();
        service.db.write.mockResolvedValue({ anyRowsAffected: true });

        const consumed = await service.consumeForComplete({
            uid: 'session-uid',
            userId: 42,
        });

        expect(consumed).toBe(true);
        expect(service.db.write).toHaveBeenCalledTimes(1);
        expect(service.db.write.mock.calls[0][0]).toContain('WHERE `uid` = ?');
        expect(service.db.write.mock.calls[0][0]).toContain('`status` IN (?, ?)');
    });

    it('expires pending sessions and returns normalized rows', async () => {
        const service = createService();
        service.db.read.mockResolvedValue([{
            uid: 'session-uid',
            user_id: 42,
            metadata_json: '{}',
            status: 'prepared',
            expires_at: 1,
        }]);
        service.db.write.mockResolvedValue({ anyRowsAffected: true });

        const expired = await service.markExpiredPendingSessions({ limit: 1 });

        expect(expired).toHaveLength(1);
        expect(expired[0].uid).toBe('session-uid');
        expect(service.db.write).toHaveBeenCalledTimes(1);
    });
});
