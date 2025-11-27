import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import * as config from '../config';
import { CommentService } from './CommentService';

describe('CommentService', async () => {
    config.load_config({
        'services': {
            'database': {
                path: ':memory:',
            },
        },
    });

    const testKernel = await createTestKernel({
        serviceMap: {
            'comment': CommentService,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const commentService = testKernel.services!.get('comment') as any;

    it('should be instantiated', () => {
        expect(commentService).toBeInstanceOf(CommentService);
    });

    it('should have db connection after init', () => {
        expect(commentService.db).toBeDefined();
    });

    it('should have uuidv4 module', () => {
        expect(commentService.modules).toBeDefined();
        expect(commentService.modules.uuidv4).toBeDefined();
        expect(typeof commentService.modules.uuidv4).toBe('function');
    });

    it('should have create_comment_ method', () => {
        expect(commentService.create_comment_).toBeDefined();
        expect(typeof commentService.create_comment_).toBe('function');
    });

    it('should have attach_comment_to_fsentry method', () => {
        expect(commentService.attach_comment_to_fsentry).toBeDefined();
        expect(typeof commentService.attach_comment_to_fsentry).toBe('function');
    });

    it('should have get_comments_for_fsentry method', () => {
        expect(commentService.get_comments_for_fsentry).toBeDefined();
        expect(typeof commentService.get_comments_for_fsentry).toBe('function');
    });

    it('should generate UUID for comments', () => {
        const uuid1 = commentService.modules.uuidv4();
        const uuid2 = commentService.modules.uuidv4();
        
        expect(uuid1).toBeDefined();
        expect(uuid2).toBeDefined();
        expect(typeof uuid1).toBe('string');
        expect(typeof uuid2).toBe('string');
        expect(uuid1).not.toBe(uuid2);
    });

    it('should validate UUID format', () => {
        const uuid = commentService.modules.uuidv4();
        
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(uuid).toMatch(uuidRegex);
    });

    it('should create comment with text', async () => {
        const mockReq = {
            body: { text: 'Test comment text' },
            user: { id: 1 },
        };
        const mockRes = {};
        
        // Mock database write
        const originalWrite = commentService.db.write.bind(commentService.db);
        commentService.db.write = vi.fn().mockResolvedValue({ insertId: 123 });
        
        try {
            const result = await commentService.create_comment_({ 
                req: mockReq, 
                res: mockRes 
            });
            
            expect(result).toBeDefined();
            expect(result.id).toBe(123);
            expect(result.uid).toBeDefined();
            expect(typeof result.uid).toBe('string');
            
            // Verify database write was called with correct parameters
            expect(commentService.db.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO `user_comments`'),
                expect.arrayContaining([
                    expect.any(String), // UUID
                    1, // user_id
                    '{}', // metadata
                    'Test comment text',
                ])
            );
        } finally {
            commentService.db.write = originalWrite;
        }
    });

    it('should attach comment to fsentry', async () => {
        const mockNode = {
            get: vi.fn().mockResolvedValue(456), // mysql-id
        };
        const comment = {
            id: 123,
            uid: 'comment-uuid',
        };
        
        const originalWrite = commentService.db.write.bind(commentService.db);
        commentService.db.write = vi.fn().mockResolvedValue({});
        
        try {
            await commentService.attach_comment_to_fsentry({
                node: mockNode,
                comment: comment,
            });
            
            expect(commentService.db.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO `user_fsentry_comments`'),
                expect.arrayContaining([123, 456])
            );
            
            expect(mockNode.get).toHaveBeenCalledWith('mysql-id');
        } finally {
            commentService.db.write = originalWrite;
        }
    });

    it('should call database to get comments for fsentry', async () => {
        const mockNode = {
            get: vi.fn().mockResolvedValue(789),
        };
        
        const originalRead = commentService.db.read.bind(commentService.db);
        commentService.db.read = vi.fn().mockResolvedValue([]);
        
        try {
            // Note: This test only verifies the database call structure
            // Full integration tests would require proper user service setup
            await commentService.get_comments_for_fsentry({
                node: mockNode,
            });
            
            expect(commentService.db.read).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM `user_comments`'),
                expect.arrayContaining([789])
            );
            
            expect(mockNode.get).toHaveBeenCalledWith('mysql-id');
        } finally {
            commentService.db.read = originalRead;
        }
    });

    it('should handle multiple comment attachments', async () => {
        const mockNode = {
            get: vi.fn().mockResolvedValue(999),
        };
        
        const comments = [
            { id: 1, uid: 'uuid-1' },
            { id: 2, uid: 'uuid-2' },
            { id: 3, uid: 'uuid-3' },
        ];
        
        const originalWrite = commentService.db.write.bind(commentService.db);
        commentService.db.write = vi.fn().mockResolvedValue({});
        
        try {
            for (const comment of comments) {
                await commentService.attach_comment_to_fsentry({
                    node: mockNode,
                    comment,
                });
            }
            
            expect(commentService.db.write).toHaveBeenCalledTimes(3);
        } finally {
            commentService.db.write = originalWrite;
        }
    });
});

