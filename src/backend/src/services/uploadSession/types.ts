export type UploadSessionStatus =
    | 'prepared'
    | 'uploading'
    | 'completing'
    | 'completed'
    | 'aborted'
    | 'expired'
    | 'failed';

export type UploadSessionMode = 'single' | 'multipart';

export interface UploadSessionMetadata {
    [key: string]: unknown;
}

export interface UploadSessionRecord {
    id: number;
    uid: string;
    user_id: number;
    app_id: number | null;
    parent_uid: string;
    parent_path: string;
    target_name: string;
    target_path: string;
    overwrite_target_uid: string | null;
    content_type: string;
    size: number;
    checksum_sha256: string | null;
    upload_mode: UploadSessionMode;
    multipart_upload_id: string | null;
    multipart_part_size: number | null;
    multipart_part_count: number | null;
    storage_provider: string;
    bucket: string | null;
    bucket_region: string | null;
    staging_key: string;
    status: UploadSessionStatus;
    failure_reason: string | null;
    metadata: UploadSessionMetadata;
    created_at: number;
    updated_at: number;
    expires_at: number;
    consumed_at: number | null;
    completed_at: number | null;
}
