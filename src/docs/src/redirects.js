const redirects = {
    '/Introduction': '/',

    // `puter.perms` collapsed one-method-per-task into `request(resource,
    // details)`, so these pages went. Every one of them shipped, which is the
    // reason for the redirect: an external link or a bookmark would otherwise
    // land on nothing. Pages that only ever existed on the branch that removed
    // them are deliberately absent — nobody could have a link to those.
    '/Perms/requestAppData': '/Perms/appData',
    '/Perms/requestEmail': '/Perms/request',
    '/Perms/requestManageApps': '/Perms/request',
    '/Perms/requestManageSubdomains': '/Perms/request',
    '/Perms/requestReadApps': '/Perms/request',
    '/Perms/requestReadDesktop': '/Perms/request',
    '/Perms/requestReadDocuments': '/Perms/request',
    '/Perms/requestReadPictures': '/Perms/request',
    '/Perms/requestReadSubdomains': '/Perms/request',
    '/Perms/requestReadVideos': '/Perms/request',
    '/Perms/requestWriteDesktop': '/Perms/request',
    '/Perms/requestWriteDocuments': '/Perms/request',
    '/Perms/requestWritePictures': '/Perms/request',
    '/Perms/requestWriteVideos': '/Perms/request',
};

module.exports = redirects;
