/**
 * Sets up per-window handlers for the responsive settings sidebar pattern.
 * This mirrors the behaviour that used to live in UIWindowSettings and allows
 * any window that renders `.sidebar-toggle` + `.settings-sidebar` markup to
 * opt into the same UX without attaching global document listeners.
 *
 * @param {JQuery} $windowRoot the jQuery-wrapped window element returned by UIWindow
 * @param {Object} [overrides] optional overrides for selectors/sizing
 */
export default function setupMobileSidebar ($windowRoot, overrides = {}) {
    if ( !$windowRoot || $windowRoot.length === 0 ) return;

    const config = {
        sidebarSelector: '.settings-sidebar',
        toggleSelector: '.sidebar-toggle',
        toggleButtonSelector: '.sidebar-toggle-button',
        activeClass: 'active',
        toggleActiveLeft: 243,
        toggleInactiveLeft: 2,
        ...overrides,
    };

    const $sidebar = $windowRoot.find(config.sidebarSelector).first();
    const $toggle = $windowRoot.find(config.toggleSelector).first();
    const $toggleButton = $toggle.find(config.toggleButtonSelector).first();

    if ( $sidebar.length === 0 || $toggle.length === 0 ) {
        return;
    }

    const namespace = `.mobileSidebar-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const setSidebarState = (isActive) => {
        $sidebar.toggleClass(config.activeClass, isActive);
        $toggleButton.toggleClass(config.activeClass, isActive);
        // Match the delayed positioning from the legacy implementation.
        requestAnimationFrame(() => {
            $toggle.css({
                left: isActive ? config.toggleActiveLeft : config.toggleInactiveLeft,
            });
        });
    };

    const closeSidebar = () => setSidebarState(false);

    const handleTogglePointerDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setSidebarState(! $sidebar.hasClass(config.activeClass));
    };

    const handleSidebarItemClick = () => {
        closeSidebar();
    };

    const handleDocumentClick = (event) => {
        const target = event.target;
        if ( !$windowRoot[0]?.isConnected ) {
            cleanup();
            return;
        }
        const insideWindow = $windowRoot.has(target).length > 0;
        const $target = $(target);
        if ( insideWindow ) {
            if (
                $target.closest(config.sidebarSelector).length ||
                $target.closest(config.toggleSelector).length ||
                $target.closest(config.toggleButtonSelector).length
            ) {
                return;
            }
        }
        closeSidebar();
    };

    const cleanup = () => {
        $windowRoot.off(namespace);
        $(document).off(`click${namespace}`, handleDocumentClick);
    };

    $windowRoot.on(`mousedown${namespace}`, config.toggleSelector, handleTogglePointerDown);
    $windowRoot.on(`click${namespace}`, '.settings-sidebar-item', handleSidebarItemClick);
    $(document).on(`click${namespace}`, handleDocumentClick);

    const handleRemoval = () => {
        cleanup();
        $windowRoot.off(`remove${namespace}`, handleRemoval);
    };

    $windowRoot.on(`remove${namespace}`, handleRemoval);
}
