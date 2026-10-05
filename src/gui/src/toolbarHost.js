import { toolbarBounds, toolbarChannel } from './helpers/toolbarEmbed.js';

const attached = new WeakSet();
function attach (frame) {
    if ( attached.has(frame) ) return;
    attached.add(frame);
    const origin = new URL(frame.src, location.href).origin;
    let panel = null;
    let panelHeight;
    let placeholder;
    let previousStyle;
    const send = action => frame.contentWindow?.postMessage({ channel: toolbarChannel, action }, origin);
    const position = () => {
        if ( !panel || !placeholder ) return;
        const bounds = toolbarBounds(placeholder.getBoundingClientRect(),
            { width: innerWidth, height: innerHeight }, panel, panelHeight);
        Object.assign(frame.style, {
            position: 'fixed', zIndex: '2147483000', margin: '0', maxWidth: 'none', maxHeight: 'none',
            width: `${bounds.width}px`, height: `${bounds.height}px`,
            left: `${bounds.left}px`, top: `${bounds.top}px`, right: 'auto', bottom: 'auto',
        });
    };
    const close = () => {
        panel = null;
        if ( placeholder ) {
            if ( previousStyle === null ) frame.removeAttribute('style');
            else frame.setAttribute('style', previousStyle);
            placeholder.remove();
            placeholder = null;
        }
    };
    const onMessage = event => {
        if ( event.source !== frame.contentWindow || event.origin !== origin ||
            event.data?.channel !== toolbarChannel ) return;
        if ( event.data.action === 'session-changed' ) {
            close();
            frame.dispatchEvent(new CustomEvent('puter:session-changed', { bubbles: true }));
        }
        if ( event.data.action !== 'panel' ) return;
        if ( event.data.panel === null ) { close(); return; }
        if ( !['apps', 'account'].includes(event.data.panel) ) return;
        panel = event.data.panel;
        panelHeight = event.data.height;
        if ( !placeholder ) {
            const rect = frame.getBoundingClientRect();
            const style = getComputedStyle(frame);
            previousStyle = frame.getAttribute('style');
            placeholder = document.createElement('span');
            Object.assign(placeholder.style, {
                display: 'inline-block', width: `${rect.width}px`, height: `${rect.height}px`,
                verticalAlign: style.verticalAlign, margin: style.margin, flexShrink: '0',
            });
            placeholder.setAttribute('aria-hidden', 'true');
            frame.before(placeholder);
            frame.style.position = 'fixed';
        }
        position();
    };
    const onPointer = event => {
        if ( panel && event.target !== frame ) { close(); send('close'); }
    };
    const onKey = event => {
        if ( event.key === 'Escape' && panel ) { close(); send('close'); frame.focus(); }
    };
    const onLoad = () => { close(); send('init'); };
    window.addEventListener('message', onMessage);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    frame.addEventListener('load', onLoad);
    send('init');
    const observer = new MutationObserver(() => {
        if ( frame.isConnected ) return;
        close();
        window.removeEventListener('message', onMessage);
        window.removeEventListener('resize', position);
        window.removeEventListener('scroll', position, true);
        document.removeEventListener('pointerdown', onPointer);
        document.removeEventListener('keydown', onKey);
        frame.removeEventListener('load', onLoad);
        attached.delete(frame);
        observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

function scan () {
    document.querySelectorAll('iframe[data-puter-toolbar]').forEach(attach);
}
if ( document.readyState === 'loading' ) document.addEventListener('DOMContentLoaded', scan, { once: true });
else scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
