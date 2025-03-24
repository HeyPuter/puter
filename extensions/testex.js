// Test extension for event listeners

extension.on('core.ai.prompt.check-usage', event => {
    console.log('GOT AI.PROMPT.CHECK-USAGE EVENT', event);
});

extension.on('core.ai.prompt.complete', event => {
    console.log('GOT AI.PROMPT.COMPLETE EVENT', event);
});

extension.on('core.ai.prompt.report-usage', event => {
    console.log('GOT AI.PROMPT.REPORT-USAGE EVENT', event);
});

extension.on('core.ai.prompt.validate', event => {
    console.log('GOT AI.PROMPT.VALIDATE EVENT', event);
});

extension.on('core.app.new-icon', event => {
    console.log('GOT APP.NEW-ICON EVENT', event);
});

extension.on('core.app.rename', event => {
    console.log('GOT APP.RENAME EVENT', event);
});

extension.on('core.apps.invalidate', event => {
    console.log('GOT APPS.INVALIDATE EVENT', event);
});

extension.on('core.email.validate', event => {
    console.log('GOT EMAIL.VALIDATE EVENT', event);
});

extension.on('core.fs.create.directory', event => {
    console.log('GOT FS.CREATE.DIRECTORY EVENT', event);
});

extension.on('core.fs.create.file', event => {
    console.log('GOT FS.CREATE.FILE EVENT', event);
});

extension.on('core.fs.create.shortcut', event => {
    console.log('GOT FS.CREATE.SHORTCUT EVENT', event);
});

extension.on('core.fs.create.symlink', event => {
    console.log('GOT FS.CREATE.SYMLINK EVENT', event);
});

extension.on('core.fs.move.file', event => {
    console.log('GOT FS.MOVE.FILE EVENT', event);
});

extension.on('core.fs.pending.file', event => {
    console.log('GOT FS.PENDING.FILE EVENT', event);
});

extension.on('core.fs.storage.progress.copy', event => {
    console.log('GOT FS.STORAGE.PROGRESS.COPY EVENT', event);
});

extension.on('core.fs.storage.upload-progress', event => {
    console.log('GOT FS.STORAGE.UPLOAD-PROGRESS EVENT', event);
});

extension.on('core.fs.write.file', event => {
    console.log('GOT FS.WRITE.FILE EVENT', event);
});

extension.on('core.ip.validate', event => {
    console.log('GOT IP.VALIDATE EVENT', event);
});

extension.on('core.outer.fs.write-hash', event => {
    console.log('GOT OUTER.FS.WRITE-HASH EVENT', event);
});

extension.on('core.outer.gui.item.added', event => {
    console.log('GOT OUTER.GUI.ITEM.ADDED EVENT', event);
});

extension.on('core.outer.gui.item.moved', event => {
    console.log('GOT OUTER.GUI.ITEM.MOVED EVENT', event);
});

extension.on('core.outer.gui.item.pending', event => {
    console.log('GOT OUTER.GUI.ITEM.PENDING EVENT', event);
});

extension.on('core.outer.gui.item.updated', event => {
    console.log('GOT OUTER.GUI.ITEM.UPDATED EVENT', event);
});

extension.on('core.outer.gui.notif.ack', event => {
    console.log('GOT OUTER.GUI.NOTIF.ACK EVENT', event);
});

extension.on('core.outer.gui.notif.message', event => {
    console.log('GOT OUTER.GUI.NOTIF.MESSAGE EVENT', event);
});

extension.on('core.outer.gui.notif.persisted', event => {
    console.log('GOT OUTER.GUI.NOTIF.PERSISTED EVENT', event);
});

extension.on('core.outer.gui.notif.unreads', event => {
    console.log('GOT OUTER.GUI.NOTIF.UNREADS EVENT', event);
});

extension.on('core.outer.gui.submission.done', event => {
    console.log('GOT OUTER.GUI.SUBMISSION.DONE EVENT', event);
});

extension.on('core.puter-exec.submission.done', event => {
    console.log('GOT PUTER-EXEC.SUBMISSION.DONE EVENT', event);
});

extension.on('core.request.measured', event => {
    console.log('GOT REQUEST.MEASURED EVENT', event);
});

extension.on('core.sns', event => {
    console.log('GOT SNS EVENT', event);
});

extension.on('core.template-service.hello', event => {
    console.log('GOT TEMPLATE-SERVICE.HELLO EVENT', event);
});

extension.on('core.usages.query', event => {
    console.log('GOT USAGES.QUERY EVENT', event);
});

extension.on('core.user.email-changed', event => {
    console.log('GOT USER.EMAIL-CHANGED EVENT', event);
});

extension.on('core.user.email-confirmed', event => {
    console.log('GOT USER.EMAIL-CONFIRMED EVENT', event);
});

extension.on('core.user.save_account', event => {
    console.log('GOT USER.SAVE_ACCOUNT EVENT', event);
});

extension.on('core.web.socket.connected', event => {
    console.log('GOT WEB.SOCKET.CONNECTED EVENT', event);
});

extension.on('core.web.socket.user-connected', event => {
    console.log('GOT WEB.SOCKET.USER-CONNECTED EVENT', event);
});

extension.on('core.wisp.get-policy', event => {
    console.log('GOT WISP.GET-POLICY EVENT', event);
});

