export const agenticOSStyles = String.raw`
.welcome-window,
.window-welcome,
.window-backdrop,
.modal-backdrop,
.captcha-modal,
.context-menu-sheet-backdrop,
.cx-chat-widget,
.btn-show-ai {
    display: none !important;
}
.havas-agentic-os {
    --ha-red: #e60000;
    --ha-bg: #090a0c;
    --ha-panel: rgba(18, 20, 24, 0.92);
    --ha-panel-2: rgba(255, 255, 255, 0.055);
    --ha-line: rgba(255, 255, 255, 0.11);
    --ha-text: #f5f7fb;
    --ha-muted: rgba(245, 247, 251, 0.62);
    --ha-good: #36d399;
    --ha-warn: #f6c453;
    --ha-bad: #ff6b6b;
    color: var(--ha-text);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    position: fixed;
    user-select: none;
    z-index: 850;
}
.havas-agentic-os * { box-sizing: border-box; }
.ha-wallpaper {
    background:
        radial-gradient(circle at 18% 24%, rgba(230, 0, 0, 0.22), transparent 28%),
        radial-gradient(circle at 76% 18%, rgba(70, 120, 255, 0.14), transparent 24%),
        linear-gradient(135deg, #08090c 0%, #14171d 46%, #0c0d10 100%);
    inset: 0;
    position: absolute;
}
.ha-topbar {
    align-items: center;
    background: rgba(5, 6, 8, 0.72);
    border-bottom: 1px solid var(--ha-line);
    display: flex;
    gap: 18px;
    height: 32px;
    justify-content: center;
    left: 0;
    pointer-events: auto;
    position: fixed;
    right: 0;
    top: 0;
}
.ha-topbar span,
.ha-topbar time { color: var(--ha-muted); font-size: 12px; }
.ha-topbar time { position: absolute; right: 18px; }
.ha-desktop-icons {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, 78px);
    left: 16px;
    pointer-events: auto;
    position: fixed;
    top: 48px;
}
.ha-desk-icon,
.ha-dock-item,
.ha-nav button,
.ha-chips button,
.ha-card button,
.ha-row,
.ha-commands button,
.ha-chat-form button,
.ha-ghost {
    cursor: pointer;
    font: inherit;
}
.ha-desk-icon {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--ha-text);
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-height: 78px;
    padding: 4px;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.65);
}
.ha-icon,
.ha-card-icon {
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    height: 42px;
    justify-content: center;
    letter-spacing: 0;
    width: 42px;
}
.ha-icon.red { background: linear-gradient(135deg, #e60000, #8f1111); }
.ha-icon.blue { background: linear-gradient(135deg, #2b6cff, #18386f); }
.ha-icon.gold { background: linear-gradient(135deg, #f6c453, #8b6216); color: #17120a; }
.ha-icon.green { background: linear-gradient(135deg, #36d399, #14684c); color: #07120d; }
.ha-icon.slate { background: linear-gradient(135deg, #566070, #20252e); }
.ha-window {
    background: var(--ha-panel);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    display: none;
    height: min(720px, calc(100vh - 96px));
    left: 132px;
    pointer-events: auto;
    position: fixed;
    top: 52px;
    width: min(1120px, calc(100vw - 468px));
}
.ha-window.open { display: flex; flex-direction: column; }
.ha-titlebar {
    align-items: center;
    border-bottom: 1px solid var(--ha-line);
    display: flex;
    height: 58px;
    justify-content: space-between;
    padding: 0 16px;
}
.ha-titlebar strong,
.ha-chat strong { display: block; font-size: 15px; }
.ha-titlebar span,
.ha-chat span { color: var(--ha-muted); display: block; font-size: 12px; margin-top: 3px; }
.ha-title-actions { display: flex; gap: 8px; }
.ha-ghost {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--ha-line);
    border-radius: 6px;
    color: var(--ha-text);
    padding: 7px 10px;
}
.ha-body {
    display: grid;
    flex: 1;
    grid-template-columns: 230px 1fr;
    min-height: 0;
}
.ha-nav {
    border-right: 1px solid var(--ha-line);
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    padding: 14px;
}
.ha-nav button {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--ha-text);
    display: grid;
    gap: 10px;
    grid-template-columns: 32px 1fr;
    padding: 10px;
    text-align: left;
}
.ha-nav button.active,
.ha-nav button:hover {
    background: rgba(230, 0, 0, 0.13);
    border-color: rgba(230, 0, 0, 0.35);
}
.ha-nav small { color: var(--ha-muted); display: block; font-size: 11px; margin-top: 2px; }
.ha-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    padding: 16px;
}
.ha-hero {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(260px, 1fr) minmax(330px, 0.9fr);
}
.ha-hero h1 {
    font-size: 32px;
    letter-spacing: 0;
    line-height: 1.05;
    margin: 0 0 8px;
}
.ha-hero p {
    color: var(--ha-muted);
    line-height: 1.45;
    margin: 0;
    max-width: 620px;
}
.ha-status-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, 1fr);
}
.ha-status-card,
.ha-card {
    background: var(--ha-panel-2);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
}
.ha-status-card { padding: 10px; }
.ha-status-card span,
.ha-status-card small,
.ha-meta,
.ha-row small { color: var(--ha-muted); font-size: 11px; }
.ha-status-card strong { display: block; font-size: 18px; margin: 4px 0; }
.ha-toolbar {
    align-items: center;
    display: flex;
    gap: 10px;
    margin: 16px 0 12px;
}
.ha-search {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--ha-line);
    border-radius: 7px;
    color: var(--ha-text);
    min-width: 230px;
    outline: none;
    padding: 10px 12px;
}
.ha-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
}
.ha-chips button {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-text);
    padding: 7px 10px;
}
.ha-chips button.active {
    background: var(--ha-red);
    border-color: var(--ha-red);
}
.ha-chip-gap { width: 8px; }
.ha-content {
    min-height: 0;
    overflow: auto;
    padding-right: 4px;
}
.ha-card-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(240px, 1fr));
}
.ha-card {
    min-height: 210px;
    padding: 14px;
}
.ha-card-top,
.ha-meta,
.ha-actions {
    align-items: center;
    display: flex;
    justify-content: space-between;
}
.ha-card h3 { font-size: 18px; margin: 14px 0 8px; }
.ha-card p {
    color: rgba(245, 247, 251, 0.76);
    line-height: 1.42;
    margin: 0 0 16px;
}
.ha-pill {
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-text);
    display: inline-flex;
    font-size: 11px;
    justify-content: center;
    padding: 4px 8px;
}
.ha-pill.good { background: rgba(54, 211, 153, 0.15); color: var(--ha-good); }
.ha-pill.warn { background: rgba(246, 196, 83, 0.14); color: var(--ha-warn); }
.ha-pill.bad { background: rgba(255, 107, 107, 0.14); color: var(--ha-bad); }
.ha-pill.neutral { background: rgba(255, 255, 255, 0.08); color: var(--ha-muted); }
.ha-actions { gap: 8px; justify-content: flex-start; margin-top: 14px; }
.ha-actions button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--ha-line);
    border-radius: 6px;
    color: var(--ha-text);
    padding: 8px 10px;
}
.ha-table {
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    overflow: hidden;
}
.ha-row {
    align-items: center;
    background: rgba(255, 255, 255, 0.045);
    border: 0;
    border-bottom: 1px solid var(--ha-line);
    color: var(--ha-text);
    display: grid;
    gap: 14px;
    grid-template-columns: 1.6fr 0.8fr 110px;
    min-height: 72px;
    padding: 12px 14px;
    text-align: left;
    width: 100%;
}
.ha-row:hover { background: rgba(230, 0, 0, 0.1); }
.ha-row strong,
.ha-row small { display: block; }
.ha-row small { line-height: 1.35; margin-top: 4px; }
.ha-empty {
    border: 1px dashed var(--ha-line);
    border-radius: 8px;
    color: var(--ha-muted);
    padding: 28px;
    text-align: center;
}
.ha-chat {
    background: rgba(12, 13, 16, 0.94);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    bottom: 74px;
    display: flex;
    flex-direction: column;
    height: 450px;
    pointer-events: auto;
    position: fixed;
    right: 18px;
    width: 310px;
}
.ha-chat header {
    align-items: center;
    border-bottom: 1px solid var(--ha-line);
    display: flex;
    justify-content: space-between;
    padding: 12px;
}
.ha-messages {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    padding: 12px;
}
.ha-msg {
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.075);
    border-radius: 8px;
    max-width: 92%;
    padding: 9px 10px;
}
.ha-msg.user {
    align-self: flex-end;
    background: rgba(230, 0, 0, 0.28);
}
.ha-msg span { color: var(--ha-text); display: block; font-size: 13px; line-height: 1.35; }
.ha-msg small { color: var(--ha-muted); display: block; font-size: 10px; margin-top: 5px; }
.ha-commands {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 12px 10px;
}
.ha-commands button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-text);
    padding: 6px 8px;
}
.ha-chat-form {
    border-top: 1px solid var(--ha-line);
    display: grid;
    gap: 8px;
    grid-template-columns: 1fr auto;
    padding: 10px;
}
.ha-chat-form input {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--ha-line);
    border-radius: 7px;
    color: var(--ha-text);
    outline: none;
    padding: 9px;
}
.ha-chat-form button {
    background: var(--ha-red);
    border: 0;
    border-radius: 7px;
    color: #fff;
    padding: 0 12px;
}
.ha-dock {
    align-items: end;
    background: rgba(10, 11, 14, 0.78);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    bottom: 14px;
    display: flex;
    gap: 8px;
    left: 50%;
    padding: 8px 10px;
    pointer-events: auto;
    position: fixed;
    transform: translateX(-50%);
}
.ha-dock-item {
    background: transparent;
    border: 0;
    color: var(--ha-text);
    padding: 0;
    position: relative;
}
.ha-dock-label {
    background: rgba(0, 0, 0, 0.84);
    border-radius: 6px;
    bottom: 50px;
    color: #fff;
    display: none;
    font-size: 11px;
    left: 50%;
    padding: 5px 7px;
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
}
.ha-dock-item:hover .ha-dock-label { display: block; }
.ha-dock-sep {
    background: var(--ha-line);
    height: 36px;
    margin: 2px 2px 0;
    width: 1px;
}
.ha-integration-window {
    left: 156px;
    top: 70px;
    width: min(1060px, calc(100vw - 510px));
}
.ha-integration-body,
.ha-code-body,
.ha-jira-body,
.ha-confluence-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.ha-integration-body {
    display: grid;
    gap: 14px;
    grid-template-columns: 1fr 320px;
    padding: 14px;
}
.ha-mcp-list {
    display: grid;
    gap: 12px;
    overflow: auto;
}
.ha-connection-card,
.ha-approval-panel,
.ha-approval-item,
.ha-agent-note,
.ha-availability-card,
.ha-status-banner,
.ha-detail-panel,
.ha-split-panel > div {
    background: var(--ha-panel-2);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
}
.ha-connection-card {
    display: grid;
    gap: 10px;
    grid-template-columns: 1fr auto;
    padding: 14px;
}
.ha-connection-card span,
.ha-connection-card p,
.ha-approval-item span,
.ha-approval-item p,
.ha-agent-note p,
.ha-detail-panel p,
.ha-split-panel p,
.ha-code-content small {
    color: var(--ha-muted);
}
.ha-connection-card p {
    grid-column: 1 / -1;
    margin: 0;
}
.ha-connection-meta,
.ha-tool-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    grid-column: 1 / -1;
}
.ha-connection-meta span {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-muted);
    font-size: 11px;
    padding: 5px 8px;
}
.ha-scope-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    grid-column: 1 / -1;
}
.ha-scope-list span {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-text);
    font-size: 11px;
    padding: 5px 8px;
}
.ha-tool-pill {
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    font-size: 11px;
    padding: 5px 8px;
}
.ha-tool-pill.warn {
    background: rgba(246, 196, 83, 0.14);
    color: var(--ha-warn);
}
.ha-tool-pill.neutral {
    background: rgba(255, 255, 255, 0.07);
    color: var(--ha-text);
}
.ha-approval-panel {
    overflow: auto;
    padding: 14px;
}
.ha-approval-panel h2,
.ha-availability-header h2,
.ha-code-tree h2,
.ha-code-agent h2,
.ha-jira-sidebar h2,
.ha-confluence-sidebar h2,
.ha-jira-main h2,
.ha-confluence-main h2,
.ha-task-monitor-grid h2 {
    font-size: 13px;
    margin: 0 0 10px;
}
.ha-approval-item {
    margin-bottom: 10px;
    padding: 12px;
}
.ha-approval-item strong,
.ha-approval-item span {
    display: block;
}
.ha-code-body {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 260px;
}
.ha-code-tree,
.ha-code-agent,
.ha-jira-sidebar,
.ha-confluence-sidebar {
    border-right: 1px solid var(--ha-line);
    overflow: auto;
    padding: 14px;
}
.ha-code-agent {
    border-left: 1px solid var(--ha-line);
    border-right: 0;
}
.ha-code-tree button,
.ha-jira-sidebar button,
.ha-confluence-sidebar button {
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    color: var(--ha-text);
    display: block;
    margin-bottom: 8px;
    padding: 10px;
    text-align: left;
    width: 100%;
}
.ha-code-tree small,
.ha-jira-sidebar span,
.ha-confluence-sidebar span {
    color: var(--ha-muted);
    display: block;
    font-size: 11px;
    margin-top: 4px;
}
.ha-code-main,
.ha-jira-main,
.ha-confluence-main {
    min-width: 0;
    overflow: auto;
    padding: 14px;
}
.ha-code-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}
.ha-code-tabs button {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--ha-line);
    border-radius: 7px;
    color: var(--ha-text);
    cursor: pointer;
    padding: 8px 11px;
}
.ha-code-tabs button.active,
.ha-primary {
    background: var(--ha-red);
    border-color: var(--ha-red);
    color: #fff;
}
.ha-code-content pre {
    background: rgba(0, 0, 0, 0.24);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    color: var(--ha-text);
    margin: 0 0 10px;
    min-height: 300px;
    overflow: auto;
    padding: 14px;
    white-space: pre-wrap;
}
.ha-agent-note {
    margin-bottom: 10px;
    padding: 12px;
}
.ha-primary {
    border: 1px solid var(--ha-red);
    border-radius: 7px;
    cursor: pointer;
    padding: 9px 11px;
}
.ha-jira-body,
.ha-confluence-body {
    display: grid;
    grid-template-columns: 250px 1fr;
}
.ha-jira-main,
.ha-confluence-main {
    display: grid;
    gap: 12px;
}
.ha-availability-panel {
    display: grid;
    gap: 10px;
}
.ha-availability-header {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
}
.ha-availability-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}
.ha-availability-card {
    padding: 12px;
}
.ha-availability-card strong,
.ha-availability-card span {
    display: block;
}
.ha-availability-card p {
    color: var(--ha-muted);
    margin: 8px 0 0;
}
.ha-status-banner {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 14px;
}
.ha-status-banner strong {
    display: block;
    font-size: 13px;
    margin-bottom: 4px;
}
.ha-status-banner p {
    color: var(--ha-muted);
    margin: 0;
}
.ha-status-banner.blocked {
    background: rgba(255, 107, 107, 0.08);
    border-color: rgba(255, 107, 107, 0.2);
}
.ha-status-banner.proposal {
    background: rgba(246, 196, 83, 0.08);
    border-color: rgba(246, 196, 83, 0.25);
}
.ha-proposals-panel {
    background: var(--ha-panel-2);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    padding: 14px;
}
.ha-proposals-panel h2 {
    font-size: 13px;
    margin: 0 0 6px;
}
.ha-proposals-note {
    color: var(--ha-muted);
    font-size: 12px;
    margin: 0 0 10px;
}
.ha-proposal-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    padding: 12px;
}
.ha-proposal-card p {
    color: var(--ha-muted);
    font-size: 12px;
    margin: 6px 0 0;
}
.ha-proposal-header {
    align-items: center;
    display: flex;
    justify-content: space-between;
}
.ha-proposal-header strong {
    font-size: 13px;
}
.ha-proposal-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.ha-proposal-meta span {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--ha-line);
    border-radius: 999px;
    color: var(--ha-muted);
    font-size: 11px;
    padding: 4px 8px;
}
.ha-detail-panel,
.ha-split-panel > div {
    padding: 14px;
}
.ha-split-panel {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ha-task-monitor-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
}
.ha-row.compact {
    grid-template-columns: 1.4fr 0.7fr 120px;
    min-height: 64px;
}
.ha-row.compact.proposal {
    border-left: 3px solid var(--ha-warn);
    padding-left: 8px;
    background: var(--ha-warn-surface, rgba(230, 0, 0, 0.08));
}
.ha-toolbar.compact {
    margin: 0 0 10px;
}
.ha-palette {
    align-items: flex-start;
    background: rgba(0, 0, 0, 0.46);
    display: flex;
    inset: 0;
    justify-content: center;
    padding-top: 12vh;
    pointer-events: auto;
    position: fixed;
    z-index: 920;
}
.ha-palette[hidden] { display: none; }
.ha-palette-box {
    background: rgba(14, 15, 18, 0.98);
    border: 1px solid var(--ha-line);
    border-radius: 8px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    width: min(620px, calc(100vw - 32px));
}
.ha-palette-input {
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    border-bottom: 1px solid var(--ha-line);
    color: var(--ha-text);
    font: inherit;
    outline: none;
    padding: 14px;
    width: 100%;
}
.ha-palette-results {
    max-height: 420px;
    overflow: auto;
    padding: 8px;
}
.ha-palette-results button {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--ha-text);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    padding: 10px;
    text-align: left;
    width: 100%;
}
.ha-palette-results button:hover {
    background: rgba(230, 0, 0, 0.14);
    border-color: rgba(230, 0, 0, 0.32);
}
.ha-palette-results span {
    color: var(--ha-muted);
}
@media (max-width: 980px) {
    .ha-window {
        height: min(700px, calc(100vh - 104px));
        left: 12px;
        top: 44px;
        width: calc(100vw - 24px);
    }
    .ha-integration-window { width: calc(100vw - 24px); }
    .ha-body { grid-template-columns: 1fr; }
    .ha-integration-body,
    .ha-code-body,
    .ha-jira-body,
    .ha-confluence-body,
    .ha-availability-grid,
    .ha-task-monitor-grid,
    .ha-split-panel {
        grid-template-columns: 1fr;
    }
    .ha-code-agent,
    .ha-code-tree,
    .ha-jira-sidebar,
    .ha-confluence-sidebar {
        border-left: 0;
        border-right: 0;
        border-bottom: 1px solid var(--ha-line);
    }
    .ha-nav {
        border-bottom: 1px solid var(--ha-line);
        border-right: 0;
        flex-direction: row;
        overflow-x: auto;
    }
    .ha-nav button { min-width: 190px; }
    .ha-hero,
    .ha-card-grid { grid-template-columns: 1fr; }
    .ha-toolbar { align-items: stretch; flex-direction: column; }
    .ha-search { width: 100%; }
    .ha-chat { display: none; }
    .ha-desktop-icons { grid-template-columns: repeat(2, 70px); }
}
`;
