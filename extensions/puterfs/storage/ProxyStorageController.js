export default class {
    constructor (delegate) {
        this.delegate = delegate ?? null;
    }
    setDelegate (delegate) {
        this.delegate = delegate;
    }

    init (...a) {
        return this.delegate.init(...a);
    }
    upload (...a) {
        return this.delegate.upload(...a);
    }
    copy (...a) {
        return this.delegate.copy(...a);
    }
    delete (...a) {
        return this.delegate.delete(...a);
    }
    read (...a) {
        return this.delegate.read(...a);
    }
    getUploadCapabilities (...a) {
        return this.delegate.getUploadCapabilities?.(...a) ?? {
            signedUploads: false,
            multipart: false,
            reason: 'unsupported',
        };
    }
    createSignedUpload (...a) {
        return this.delegate.createSignedUpload(...a);
    }
    createMultipartUpload (...a) {
        return this.delegate.createMultipartUpload(...a);
    }
    signMultipartUploadPart (...a) {
        return this.delegate.signMultipartUploadPart(...a);
    }
    completeMultipartUpload (...a) {
        return this.delegate.completeMultipartUpload(...a);
    }
    abortMultipartUpload (...a) {
        return this.delegate.abortMultipartUpload(...a);
    }
    headObject (...a) {
        return this.delegate.headObject(...a);
    }
    deleteObject (...a) {
        return this.delegate.deleteObject(...a);
    }
    copyObject (...a) {
        return this.delegate.copyObject(...a);
    }
}
