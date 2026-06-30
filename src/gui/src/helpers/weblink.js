import UIWindow from '../UI/UIWindow.js';
import mime from '../lib/mime.js';

const WEBLINK_ICON_ALLOWLIST = [
    'data:image/png;base64,',
    'data:image/jpeg;base64,',
    'data:image/jpg;base64,',
    'data:image/gif;base64,',
    'data:image/webp;base64,',
    'data:image/svg+xml;base64,',
];
const WEBLINK_ICON_MIME_ALLOWLIST = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
];

export const defaultWeblinkIcon = () => window.icons['link.svg'];

export const isValidWeblinkIcon = (icon) => {
    if ( typeof icon !== 'string' || icon.length === 0 ) {
        return false;
    }

    if ( icon === defaultWeblinkIcon() ) {
        return true;
    }

    return WEBLINK_ICON_ALLOWLIST.some(prefix => icon.toLowerCase().startsWith(prefix));
};

export const createWeblinkData = ({ url, domain, linkName, simpleName, icon = defaultWeblinkIcon() }) => ({
    url: url,
    type: 'weblink',
    domain: domain,
    icon: isValidWeblinkIcon(icon) ? icon : defaultWeblinkIcon(),
    created: Date.now(),
    modified: Date.now(),
    version: '2.1',
    metadata: {
        originalUrl: url,
        linkName: linkName,
        simpleName: simpleName,
    },
});

export const parseWeblinkData = async (content) => {
    const text = typeof content === 'string' ? content : await content.text();

    try {
        return JSON.parse(text);
    } catch (e) {
        if ( text.startsWith('http://') || text.startsWith('https://') ) {
            const url = new URL(text);
            const domain = url.hostname;
            const simpleName = domain.replace(/^www\./, '').split('.')[0];
            const linkName = simpleName.charAt(0).toUpperCase() + simpleName.slice(1);

            return createWeblinkData({
                url: text,
                domain: domain,
                linkName: linkName,
                simpleName: simpleName,
            });
        }

        throw e;
    }
};

export const readWeblinkData = async (path) => {
    const content = await puter.fs.read({ path: path });
    return parseWeblinkData(content);
};

const readFileAsDataUrl = async (file) => await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

const inferImageMimeFromBlob = async (file) => {
    if ( !file?.slice || !file?.arrayBuffer ) {
        return null;
    }

    const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());

    if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47
    ) {
        return 'image/png';
    }

    if ( bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF ) {
        return 'image/jpeg';
    }

    if (
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46
    ) {
        return 'image/gif';
    }

    if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp';
    }

    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trimStart();
    if ( text.startsWith('<svg') || text.startsWith('<?xml') && text.includes('<svg') ) {
        return 'image/svg+xml';
    }

    return null;
};

const normalizeImageDataUrl = async (dataUrl, fsentry, file) => {
    if ( typeof dataUrl !== 'string' ) {
        return dataUrl;
    }

    if ( isValidWeblinkIcon(dataUrl) ) {
        return dataUrl;
    }

    const inferredMime = [
        fsentry.type,
        file?.type,
        mime.getType(fsentry.name ?? fsentry.path ?? ''),
    ]
        .map(type => type?.toLowerCase())
        .find(type => WEBLINK_ICON_MIME_ALLOWLIST.includes(type)) ??
        await inferImageMimeFromBlob(file);

    if ( !WEBLINK_ICON_MIME_ALLOWLIST.includes(inferredMime) ) {
        return dataUrl;
    }

    return dataUrl.replace(/^data:[^,]*,/i, `data:${inferredMime};base64,`);
};

const readIconFromFsEntry = async (fsentry) => {
    const file = await puter.fs.read(fsentry.path);
    const icon = await normalizeImageDataUrl(
        await readFileAsDataUrl(file),
        fsentry,
        file,
    );

    if ( !isValidWeblinkIcon(icon) ) {
        throw new Error('Please choose a PNG, JPG, GIF, WebP, or SVG image.');
    }

    return icon;
};

const centerDialog = (elDialog, elItem) => {
    const $dialog = $(elDialog);
    const $parentWindow = $(elItem).closest('.window');
    const parentOffset = $parentWindow.length ? $parentWindow.offset() : null;
    const parentWidth = $parentWindow.length ? $parentWindow.outerWidth() : window.innerWidth;
    const parentHeight = $parentWindow.length ? $parentWindow.outerHeight() : window.innerHeight;
    const parentLeft = parentOffset?.left ?? 0;
    const parentTop = parentOffset?.top ?? 0;
    const left = parentLeft + parentWidth / 2 - $dialog.outerWidth() / 2;
    const top = parentTop + parentHeight / 2 - $dialog.outerHeight() / 2;

    $dialog.css({
        left: `${Math.max(0, left) }px`,
        top: `${Math.max(window.toolbar_height ?? 0, top) }px`,
    });
};

export const chooseWeblinkIcon = async (elItem) => await new Promise((resolve, reject) => {
    const receiverUuid = `weblink-icon-picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const $receiver = $('<div>')
        .addClass('window')
        .attr('data-element_uuid', receiverUuid)
        .css('display', 'none')
        .appendTo('body');

    const cleanup = () => {
        $receiver.off('file_opened');
        $receiver.remove();
    };

    $receiver.on('file_opened', async function (e) {
        try {
            const selectedFile = Array.isArray(e.detail) ? e.detail[0] : e.detail;

            if ( !selectedFile?.path ) {
                cleanup();
                resolve(null);
                return;
            }

            const icon = await readIconFromFsEntry(selectedFile);
            cleanup();
            resolve(icon);
        } catch (error) {
            cleanup();
            reject(error);
        }
    });

    UIWindow({
        path: `/${window.user.username}/Desktop`,
        parent_uuid: receiverUuid,
        allowed_file_types: 'image/*',
        show_maximize_button: false,
        show_minimize_button: false,
        title: i18n('window_title_open'),
        is_dir: true,
        is_openFileDialog: true,
        selectable_body: false,
        backdrop: true,
        close_on_backdrop_click: true,
        stay_on_top: true,
    }).then((elDialog) => {
        centerDialog(elDialog, elItem);
    }).catch((error) => {
        cleanup();
        reject(error);
    });
});

export const updateWeblinkIcon = async ({ path, icon }) => {
    const data = await readWeblinkData(path);
    const now = Date.now();
    data.icon = icon;
    data.modified = now;
    data.version = data.version ?? '2.1';
    data.metadata = data.metadata ?? {};
    data.metadata.icon = icon;

    await puter.fs.write(path, JSON.stringify(data), { overwrite: true });
    return data;
};

export const changeWeblinkIcon = async (elItem) => {
    const $item = $(elItem);
    const icon = await chooseWeblinkIcon(elItem);

    if ( !icon ) {
        return null;
    }

    await updateWeblinkIcon({
        path: $item.attr('data-path'),
        icon: icon,
    });

    $item.find('.item-icon > img').attr('src', icon);
    $item.attr('data-icon', icon);

    return icon;
};

export const getWeblinkIcon = async (fsentry) => {
    try {
        const data = await readWeblinkData(fsentry.path);
        const icon = data.icon ?? data.metadata?.icon;

        if ( isValidWeblinkIcon(icon) ) {
            return icon;
        }
    } catch (e) {
        // Older weblinks may contain only a URL or malformed legacy JSON.
    }

    return defaultWeblinkIcon();
};
