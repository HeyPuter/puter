let sidebar = [
    {
        title: 'Overview',
        title_tag: 'Overview',
        children: [
            {
                title: 'Getting Started',
                source: '/getting-started.md',
                path: '/getting-started',
            },
            {
                title: 'Examples',
                source: '/examples.md',
                path: '/examples',
            },
            {
                title: 'Security and Permissions',
                source: '/security.md',
                path: '/security',
            },
            {
                title: 'User Pays Model',
                source: '/user-pays-model.md',
                path: '/user-pays-model',
            }
        ]
    },
    {
        title: 'AI',
        title_tag: 'AI',
        icon: '/assets/img/ai.svg',
        source: '/AI.md',
        path: '/AI',
        children:[
            {
                title: '<code>chat()</code>',
                page_title: '<code>puter.ai.chat()</code>',
                title_tag: 'puter.ai.chat()',
                icon:'/assets/img/function.svg',
                source: '/AI/chat.md',
                path: '/AI/chat',
            },
            {
                title: '<code>txt2img()</code>',
                page_title: '<code>puter.ai.txt2img()</code>',
                title_tag: 'puter.ai.txt2img()',
                icon:'/assets/img/function.svg',
                source: '/AI/txt2img.md',
                path: '/AI/txt2img',
            },
            {
                title: '<code>img2txt()</code>',
                page_title: '<code>puter.ai.img2txt()</code>',
                title_tag: 'puter.ai.img2txt()',
                icon:'/assets/img/function.svg',
                source: '/AI/img2txt.md',
                path: '/AI/img2txt',
            },
            {
                title: '<code>txt2speech()</code>',
                page_title: '<code>puter.ai.txt2speech()</code>',
                title_tag: 'puter.ai.txt2speech()',
                icon:'/assets/img/function.svg',
                source: '/AI/txt2speech.md',
                path: '/AI/txt2speech',
            },

        ]
    },
    {
        'title': 'Apps',
        title_tag: 'Apps',
        icon: '/assets/img/apps.svg',
        source: '/Apps.md',
        path: '/Apps',
        'children': [
            {
                title: '<code>create()</code>',
                page_title: '<code>puter.apps.create()</code>',
                title_tag: 'puter.apps.create()',
                icon:'/assets/img/function.svg',
                source: '/Apps/create.md',
                path: '/Apps/create',
            },
            {
                title: '<code>list()</code>',
                page_title: '<code>puter.apps.list()</code>',
                title_tag: 'puter.apps.list()',
                icon:'/assets/img/function.svg',
                source: '/Apps/list.md',
                path: '/Apps/list',
            },
            {
                title: '<code>delete()</code>',
                page_title: '<code>puter.apps.delete()</code>',
                title_tag: 'puter.apps.delete()',
                icon:'/assets/img/function.svg',
                source: '/Apps/delete.md',
                path: '/Apps/delete',
            },
            {
                title: '<code>update()</code>',
                page_title: '<code>puter.apps.update()</code>',
                title_tag: 'puter.apps.update()',
                icon:'/assets/img/function.svg',
                source: '/Apps/update.md',
                path: '/Apps/update',
            },
            {
                title: '<code>get()</code>',
                page_title: '<code>puter.apps.get()</code>',
                title_tag: 'puter.apps.get()',
                icon:'/assets/img/function.svg',
                source: '/Apps/get.md',
                path: '/Apps/get',
            },
        ]
    },
    {
        title: 'Auth',
        title_tag: 'Auth',
        icon: '/assets/img/auth.svg',
        source: '/Auth.md',
        path: '/Auth',
        children: [
            {
                title: '<code>signIn()</code>',
                page_title: '<code>puter.auth.signIn()</code>',
                title_tag: 'puter.auth.signIn()',
                icon:'/assets/img/function.svg',
                source: '/Auth/signIn.md',
                path: '/Auth/signIn',
            },
            {
                title: '<code>signOut()</code>',
                page_title: '<code>puter.auth.signOut()</code>',
                title_tag: 'puter.auth.signOut()',
                icon:'/assets/img/function.svg',
                source: '/Auth/signOut.md',
                path: '/Auth/signOut',
            },
            {
                title: '<code>isSignedIn()</code>',
                page_title: '<code>puter.auth.isSignedIn()</code>',
                title_tag: 'puter.auth.isSignedIn()',
                icon:'/assets/img/function.svg',
                source: '/Auth/isSignedIn.md',
                path: '/Auth/isSignedIn',
            },
            {
                title: '<code>getUser()</code>',
                page_title: '<code>puter.auth.getUser()</code>',
                title_tag: 'puter.auth.getUser()',
                icon:'/assets/img/function.svg',
                source: '/Auth/getUser.md',
                path: '/Auth/getUser',
            },
        ]
    },
    {
        title: 'Cloud Storage',
        title_tag: 'Cloud Storage',
        icon: '/assets/img/fs.svg',
        source: '/FS.md',
        path: '/FS',
        children: [
            {
                title: '<code>write()</code>',
                page_title: '<code>puter.fs.write()</code>',
                title_tag: 'puter.fs.write()',
                icon:'/assets/img/function.svg',
                source: '/FS/write.md',
                path: '/FS/write',
            },
            {
                title: '<code>read()</code>',
                page_title: '<code>puter.fs.read()</code>',
                title_tag: 'puter.fs.read()',
                icon:'/assets/img/function.svg',
                source: '/FS/read.md',
                path: '/FS/read',
            },
            {
                title: '<code>mkdir()</code>',
                page_title: '<code>puter.fs.mkdir()</code>',
                title_tag: 'puter.fs.mkdir()',
                icon:'/assets/img/function.svg',
                source: '/FS/mkdir.md',
                path: '/FS/mkdir',
            },
            {
                title: '<code>readdir()</code>',
                page_title: '<code>puter.fs.readdir()</code>',
                title_tag: 'puter.fs.readdir()',
                icon:'/assets/img/function.svg',
                source: '/FS/readdir.md',
                path: '/FS/readdir',
            },
            {
                title: '<code>rename()</code>',
                page_title: '<code>puter.fs.rename()</code>',
                title_tag: 'puter.fs.rename()',
                icon:'/assets/img/function.svg',
                source: '/FS/rename.md',
                path: '/FS/rename',
            },
            {
                title: '<code>copy()</code>',
                page_title: '<code>puter.fs.copy()</code>',
                title_tag: 'puter.fs.copy()',
                icon:'/assets/img/function.svg',
                source: '/FS/copy.md',
                path: '/FS/copy',
            },
            {
                title: '<code>move()</code>',
                page_title: '<code>puter.fs.move()</code>',
                title_tag: 'puter.fs.move()',
                icon:'/assets/img/function.svg',
                source: '/FS/move.md',
                path: '/FS/move',
            },
            {
                title: '<code>stat()</code>',
                page_title: '<code>puter.fs.stat()</code>',
                title_tag: 'puter.fs.stat()',
                icon:'/assets/img/function.svg',
                source: '/FS/stat.md',
                path: '/FS/stat',
            },
            {
                title: '<code>delete()</code>',
                page_title: '<code>puter.fs.delete()</code>',
                title_tag: 'puter.fs.delete()',
                icon:'/assets/img/function.svg',
                source: '/FS/delete.md',
                path: '/FS/delete',
            },
            {
                title: '<code>getReadURL()</code>',
                page_title: '<code>puter.fs.getReadURL()</code>',
                title_tag: 'puter.fs.getReadURL()',
                icon:'/assets/img/function.svg',
                source: '/FS/getReadURL.md',
                path: '/FS/getReadURL',
            },
            {
                title: '<code>upload()</code>',
                page_title: '<code>puter.fs.upload()</code>',
                title_tag: 'puter.fs.upload()',
                icon:'/assets/img/function.svg',
                source: '/FS/upload.md',
                path: '/FS/upload',
            },
        ]
    },
    {
        title: 'Serverless Workers',
        title_tag: 'Serverless Workers',
        icon: '/assets/img/workers.svg',
        source: '/Workers.md',
        path: '/Workers',
        children: [
            {
                title: '<code>create()</code>',
                page_title: '<code>puter.workers.create()</code>',
                title_tag: 'puter.workers.create()',
                icon:'/assets/img/function.svg',
                source: '/Workers/create.md',
                path: '/Workers/create',
            },
            {
                title: '<code>delete()</code>',
                page_title: '<code>puter.workers.delete()</code>',
                title_tag: 'puter.workers.delete()',
                icon:'/assets/img/function.svg',
                source: '/Workers/delete.md',
                path: '/Workers/delete',
            },
            {
                title: '<code>list()</code>',
                page_title: '<code>puter.workers.list()</code>',
                title_tag: 'puter.workers.list()',
                icon:'/assets/img/function.svg',
                source: '/Workers/list.md',
                path: '/Workers/list',
            },
            {
                title: '<code>get()</code>',
                page_title: '<code>puter.workers.get()</code>',
                title_tag: 'puter.workers.get()',
                icon:'/assets/img/function.svg',
                source: '/Workers/get.md',
                path: '/Workers/get',
            },
            {
                title: '<code>exec()</code>',
                page_title: '<code>puter.workers.exec()</code>',
                title_tag: 'puter.workers.exec()',
                icon:'/assets/img/function.svg',
                source: '/Workers/exec.md',
                path: '/Workers/exec',
            },
            {
                title: '<code>router</code>',
                page_title: 'The <code>router</code> object',
                title_tag: 'The router object',
                icon:'/assets/img/object.svg',
                source: '/Workers/router.md',
                path: '/Workers/router',
            },
        ]
    },
    {
        title: 'Hosting',
        title_tag: 'Hosting',
        icon: '/assets/img/hosting.svg',
        source: '/Hosting.md',
        path: '/Hosting',
        children: [
            {
                title: '<code>create()</code>',
                page_title: '<code>puter.hosting.create()</code>',
                title_tag: 'puter.hosting.create()',
                icon:'/assets/img/function.svg',
                source: '/Hosting/create.md',
                path: '/Hosting/create',
            },
            {
                title: '<code>list()</code>',
                page_title: '<code>puter.hosting.list()</code>',
                title_tag: 'puter.hosting.list()',
                icon:'/assets/img/function.svg',
                source: '/Hosting/list.md',
                path: '/Hosting/list',
            },
            {
                title: '<code>delete()</code>',
                page_title: '<code>puter.hosting.delete()</code>',
                title_tag: 'puter.hosting.delete()',
                icon:'/assets/img/function.svg',
                source: '/Hosting/delete.md',
                path: '/Hosting/delete',
            },
            {
                title: '<code>update()</code>',
                page_title: '<code>puter.hosting.update()</code>',
                title_tag: 'puter.hosting.update()',
                icon:'/assets/img/function.svg',
                source: '/Hosting/update.md',
                path: '/Hosting/update',
            },
            {
                title: '<code>get()</code>',
                page_title: '<code>puter.hosting.get()</code>',
                title_tag: 'puter.hosting.get()',
                icon:'/assets/img/function.svg',
                source: '/Hosting/get.md',
                path: '/Hosting/get',
            },
        ]
    },
    {
        title: 'Key-Value Store',
        title_tag: 'Key-Value Store',
        icon: '/assets/img/kv.svg',
        source: '/KV.md',
        path: '/KV',
        children: [
            {
                title: '<code>set()</code>',
                page_title: '<code>puter.kv.set()</code>',
                title_tag: 'puter.kv.set()',
                icon:'/assets/img/function.svg',
                source: '/KV/set.md',
                path: '/KV/set',
            },
            {
                title: '<code>get()</code>',
                page_title: '<code>puter.kv.get()</code>',
                title_tag: 'puter.kv.get()',
                icon:'/assets/img/function.svg',
                source: '/KV/get.md',
                path: '/KV/get',
            },
            {
                title: '<code>incr()</code>',
                page_title: '<code>puter.kv.incr()</code>',
                title_tag: 'puter.kv.incr()',
                icon:'/assets/img/function.svg',
                source: '/KV/incr.md',
                path: '/KV/incr',
            },
            {
                title: '<code>decr()</code>',
                page_title: '<code>puter.kv.decr()</code>',
                title_tag: 'puter.kv.decr()',
                icon:'/assets/img/function.svg',
                source: '/KV/decr.md',
                path: '/KV/decr',
            },
            {
                title: '<code>del()</code>',
                page_title: '<code>puter.kv.del()</code>',
                title_tag: 'puter.kv.del()',
                icon:'/assets/img/function.svg',
                source: '/KV/del.md',
                path: '/KV/del',
            },
            {
                title: '<code>list()</code>',
                page_title: '<code>puter.kv.list()</code>',
                title_tag: 'puter.kv.list()',
                icon:'/assets/img/function.svg',
                source: '/KV/list.md',
                path: '/KV/list',
            },
            {
                title: '<code>flush()</code>',
                page_title: '<code>puter.kv.flush()</code>',
                title_tag: 'puter.kv.flush()',
                icon:'/assets/img/function.svg',
                source: '/KV/flush.md',
                path: '/KV/flush',
            },
        ]
    },
    {
        title: `Networking`,
        title_tag: 'Networking',
        icon: '/assets/img/networking.svg',
        source: '/Networking.md',
        path: '/Networking',
        children: [
            {
                title: '<code>Socket</code>',
                page_title: '<code>Socket</code>',
                title_tag: 'Socket',
                icon:'/assets/img/object.svg',
                source: '/Networking/Socket.md',
                path: '/Networking/Socket',
            },
            {
                title: '<code>TLSSocket</code>',
                page_title: '<code>TLSSocket</code>',
                title_tag: 'TLSSocket',
                icon:'/assets/img/object.svg',
                source: '/Networking/TLSSocket.md',
                path: '/Networking/TLSSocket',
            },
            {
                title: '<code>fetch()</code>',
                page_title: '<code>puter.net.fetch()</code>',
                title_tag: 'puter.net.fetch()',
                icon:'/assets/img/function.svg',
                source: '/Networking/fetch.md',
                path: '/Networking/fetch',
            }

        ]
    },
    {
        title: 'UI',
        title_tag: 'UI',
        icon: '/assets/img/ui.svg',
        source: '/UI.md',
        path: '/UI',
        children: [
            {
                title: '<code>authenticateWithPuter()</code>',
                page_title: '<code>puter.ui.authenticateWithPuter()</code>',
                title_tag: 'puter.ui.authenticateWithPuter()',
                icon:'/assets/img/function.svg',
                source: '/UI/authenticateWithPuter.md',
                path: '/UI/authenticateWithPuter',
            },
            {
                title: '<code>alert()</code>',
                page_title: '<code>puter.ui.alert()</code>',
                title_tag: 'puter.ui.alert()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/alert.md',
                path: '/UI/alert',
            },
            {
                title: '<code>contextMenu()</code>',
                page_title: '<code>puter.ui.contextMenu()</code>',
                title_tag: 'puter.ui.contextMenu()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/contextMenu.md',
                path: '/UI/contextMenu',
            },
            {
                title: '<code>createWindow()</code>',
                page_title: '<code>puter.ui.createWindow()</code>',
                title_tag: 'puter.ui.createWindow()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/createWindow.md',
                path: '/UI/createWindow',
            },
            {
                title: '<code>exit()</code>',
                page_title: '<code>puter.exit()</code>',
                title_tag: 'puter.exit()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/exit.md',
                path: '/UI/exit',
            },
            {
                title: '<code>getLanguage()</code>',
                page_title: '<code>puter.ui.getLanguage()</code>',
                title_tag: 'puter.ui.getLanguage()',
                icon:'/assets/img/function.svg',
                source: '/UI/getLanguage.md',
                path: '/UI/getLanguage',
            },
            {
                title: '<code>launchApp()</code>',
                page_title: '<code>puter.ui.launchApp()</code>',
                title_tag: 'puter.ui.launchApp()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/launchApp.md',
                path: '/UI/launchApp',
            },
            {
                title: '<code>on()</code>',
                page_title: '<code>puter.ui.on()</code>',
                title_tag: 'puter.ui.on()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/on.md',
                path: '/UI/on',
            },
            {
                title: '<code>onLaunchedWithItems()</code>',
                page_title: '<code>puter.ui.onLaunchedWithItems()</code>',
                title_tag: 'puter.ui.onLaunchedWithItems()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/onLaunchedWithItems.md',
                path: '/UI/onLaunchedWithItems',
            },
            {
                title: '<code>onWindowClose()</code>',
                page_title: '<code>puter.ui.onWindowClose()</code>',
                title_tag: 'puter.ui.onWindowClose()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/onWindowClose.md',
                path: '/UI/onWindowClose',
            },
            {
                title: '<code>parentApp()</code>',
                page_title: '<code>puter.ui.parentApp()</code>',
                title_tag: 'puter.ui.parentApp()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/parentApp.md',
                path: '/UI/parentApp',
            },
            {
                title: '<code>prompt()</code>',
                page_title: '<code>puter.ui.prompt()</code>',
                title_tag: 'puter.ui.prompt()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/prompt.md',
                path: '/UI/prompt',
            },
            {
                title: '<code>setMenubar()</code>',
                page_title: '<code>puter.ui.setMenubar()</code>',
                title_tag: 'puter.ui.setMenubar()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setMenubar.md',
                path: '/UI/setMenubar',
            },
            {
                title: '<code>setWindowHeight()</code>',
                page_title: '<code>puter.ui.setWindowHeight()</code>',
                title_tag: 'puter.ui.setWindowHeight()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowHeight.md',
                path: '/UI/setWindowHeight',
            },
            {
                title: '<code>setWindowPosition()</code>',
                page_title: '<code>puter.ui.setWindowPosition()</code>',
                title_tag: 'puter.ui.setWindowPosition()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowPosition.md',
                path: '/UI/setWindowPosition',
            },
            {
                title: '<code>setWindowSize()</code>',
                page_title: '<code>puter.ui.setWindowSize()</code>',
                title_tag: 'puter.ui.setWindowSize()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowSize.md',
                path: '/UI/setWindowSize',
            },
            {
                title: '<code>setWindowTitle()</code>',
                page_title: '<code>puter.ui.setWindowTitle()</code>',
                title_tag: 'puter.ui.setWindowTitle()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowTitle.md',
                path: '/UI/setWindowTitle',
            },
            {
                title: '<code>setWindowWidth()</code>',
                page_title: '<code>puter.ui.setWindowWidth()</code>',
                title_tag: 'puter.ui.setWindowWidth()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowWidth.md',
                path: '/UI/setWindowWidth',
            },
            {
                title: '<code>setWindowX()</code>',
                page_title: '<code>puter.ui.setWindowX()</code>',
                title_tag: 'puter.ui.setWindowX()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowX.md',
                path: '/UI/setWindowX',
            },
            {
                title: '<code>setWindowY()</code>',
                page_title: '<code>puter.ui.setWindowY()</code>',
                title_tag: 'puter.ui.setWindowY()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/setWindowY.md',
                path: '/UI/setWindowY',
            },
            {
                title: '<code>showColorPicker()</code>',
                page_title: '<code>puter.ui.showColorPicker()</code>',
                title_tag: 'puter.ui.showColorPicker()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/showColorPicker.md',
                path: '/UI/showColorPicker',
            },
            {
                title: '<code>showDirectoryPicker()</code>',
                page_title: '<code>puter.ui.showDirectoryPicker()</code>',
                title_tag: 'puter.ui.showDirectoryPicker()',
                icon:'/assets/img/function.svg',
                source: '/UI/showDirectoryPicker.md',
                path: '/UI/showDirectoryPicker',
            },
            {
                title: '<code>showFontPicker()</code>',
                page_title: '<code>puter.ui.showFontPicker()</code>',
                title_tag: 'puter.ui.showFontPicker()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/showFontPicker.md',
                path: '/UI/showFontPicker',
            },
            {
                title: '<code>showOpenFilePicker()</code>',
                page_title: '<code>puter.ui.showOpenFilePicker()</code>',
                title_tag: 'puter.ui.showOpenFilePicker()',
                icon:'/assets/img/function.svg',
                source: '/UI/showOpenFilePicker.md',
                path: '/UI/showOpenFilePicker',
            },
            {
                title: '<code>showSaveFilePicker()</code>',
                page_title: '<code>puter.ui.showSaveFilePicker()</code>',
                title_tag: 'puter.ui.showSaveFilePicker()',
                icon:'/assets/img/function.svg',
                source: '/UI/showSaveFilePicker.md',
                path: '/UI/showSaveFilePicker',
            },
            // {
            //     title: '<code>showSpinner()</code>',
            //     page_title: '<code>puter.ui.showSpinner()</code>',
            //     title_tag: 'puter.ui.showSpinner()',
            //     icon:'/assets/img/function.svg',
            //     source: '/UI/showSpinner.md',
            //     path: '/UI/showSpinner',
            // },
            // {
            //     title: '<code>hideSpinner()</code>',
            //     page_title: '<code>puter.ui.hideSpinner()</code>',
            //     title_tag: 'puter.ui.hideSpinner()',
            //     icon:'/assets/img/function.svg',
            //     source: '/UI/hideSpinner.md',
            //     path: '/UI/hideSpinner',
            // },
            {
                title: `<code>socialShare()</code>`,
                page_title: '<code>puter.ui.socialShare()</code>',
                title_tag: 'puter.ui.socialShare()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/socialShare.md',
                path: '/UI/socialShare',
            },
            {
                title: '<code>wasLaunchedWithItems()</code>',
                page_title: '<code>puter.ui.wasLaunchedWithItems()</code>',
                title_tag: 'puter.ui.wasLaunchedWithItems()',
                gui_only: true,
                icon:'/assets/img/function.svg',
                source: '/UI/wasLaunchedWithItems.md',
                path: '/UI/wasLaunchedWithItems',
            },
        ]
    },
    {
        title: `Drivers`,
        title_tag: 'Drivers',
        source: '/Drivers.md',
        path: '/Drivers',
        children: [
            {
                title: '<code>call</code>',
                page_title: '<code>puter.drivers.call()</code>',
                title_tag: 'puter.drivers.call()',
                icon:'/assets/img/function.svg',
                source: '/Drivers/call.md',
                path: '/Drivers/call',
            },
        ]
    },
    {
        title: 'Utilities',
        title_tag: 'Utilities',
        source: '/Utils.md',
        path: '/Utils',
        children: [
            {
                title: '<code>appID</code>',
                page_title: '<code>puter.appID</code>',
                title_tag: 'puter.appID',
                icon:'/assets/img/attr.svg',
                source: '/Utils/appID.md',
                path: '/Utils/appID',
            },
            {
                title: '<code>env</code>',
                page_title: '<code>puter.env</code>',
                title_tag: 'puter.env',
                icon:'/assets/img/attr.svg',
                source: '/Utils/env.md',
                path: '/Utils/env',
            },
            {
                title: '<code>print()</code>',
                page_title: '<code>puter.print()</code>',
                title_tag: 'puter.print()',
                icon:'/assets/img/function.svg',
                source: '/Utils/print.md',
                path: '/Utils/print',
            },
            {
                title: '<code>randName()</code>',
                page_title: '<code>puter.randName()</code>',
                title_tag: 'puter.randName()',
                icon:'/assets/img/function.svg',
                source: '/Utils/randName.md',
                path: '/Utils/randName',
            },
        ]
    },
    {
        title: 'Objects',
        title_tag: 'Objects',
        source: '/Objects.md',
        path: '/Objects',
        children: [
            {
                title: '<code>AppConnection</code>',
                title_tag: 'AppConnection',
                icon:'/assets/img/object.svg',
                source: '/Objects/AppConnection.md',
                path: '/Objects/AppConnection',
            },
            {
                title: '<code>App</code>',
                title_tag: 'App',
                icon:'/assets/img/object.svg',
                source: '/Objects/app.md',
                path: '/Objects/app',
            },
            {
                title: '<code>FSItem</code>',
                title_tag: 'FSItem',
                icon:'/assets/img/object.svg',
                source: '/Objects/fsitem.md',
                path: '/Objects/fsitem',
            },
            {
                title: '<code>Subdomain</code>',
                title_tag: 'Subdomain',
                icon:'/assets/img/object.svg',
                source: '/Objects/subdomain.md',
                path: '/Objects/subdomain',
            },
        ]
    },
]

function addPrevNextLinks(sidebar) {
    let allPages = [];
    
    // Flatten the sidebar structure into a single array of pages
    sidebar.forEach(section => {
        // Add section page if it has source and path
        if (section.source && section.path) {
            allPages.push(section);
        }
        // Add all children
        allPages = allPages.concat(section.children);
    });

    // Add prev and next links
    allPages.forEach((page, index) => {
        if (index > 0) {
            page.prev = {
                title: allPages[index - 1].title,
                path: allPages[index - 1].path
            };
        } else {
            page.prev = null;
        }

        if (index < allPages.length - 1) {
            page.next = {
                title: allPages[index + 1].title,
                path: allPages[index + 1].path
            };
        } else {
            page.next = null;
        }
    });

    return sidebar;
}

// Usage
sidebar = addPrevNextLinks(sidebar);

module.exports = sidebar;
