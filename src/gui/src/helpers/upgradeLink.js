export function openRequestedUpgrade (target = window) {
    const url = new URL(target.location.href);
    if ( url.searchParams.get('upgrade') !== '1' || typeof target.UIUpgradeAccount !== 'function' ) return;
    url.searchParams.delete('upgrade');
    target.history.replaceState(target.history.state, '', url.href);
    new target.UIUpgradeAccount().open_as_window();
}
