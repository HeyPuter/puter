/**
 * Keyboard Shortcuts Tab
 */

export default {
    id: "keyboard-shortcuts",
    title_i18n_key: "keyboard_shortcuts",
    icon: "keyboard.svg",

    html() {
        const sections = [
            {
                title: "General",
                list: [
                    { keys: ["Ctrl / ⌘", "F"], text: "Search" },
                    { keys: ["Ctrl / ⌘", "Z"], text: "Undo last action" },
                    { keys: ["Esc"], text: "Close menus or dialogs" },
                    { keys: ["F1"], text: "Open Keyboard Shortcuts" }
                ]
            },
            {
                title: "Navigation",
                list: [
                    { keys: ["↑", "↓", "←", "→"], text: "Navigate items" },
                    { keys: ["Enter"], text: "Open selected item" },
                    { keys: ["Tab"], text: "Move to next focusable element" }
                ]
            },
            {
                title: "File Management",
                list: [
                    { keys: ["Ctrl / ⌘", "C"], text: "Copy selected items" },
                    { keys: ["Ctrl / ⌘", "V"], text: "Paste items" },
                    { keys: ["Ctrl / ⌘", "X"], text: "Cut selected items" },
                    { keys: ["Delete"], text: "Move to Trash" },
                    { keys: ["Shift", "Delete"], text: "Delete permanently" }
                ]
            },
            {
                title: "Windows",
                list: [
                    { keys: ["Alt", "F4"], text: "Close current window" }
                ]
            }
        ];

        const renderKeys = (keys) =>
            keys
                .map(k => `<kbd class="ks-key">${k}</kbd>`)
                .join(`<span class="ks-plus">+</span>`);

        let html = `
            <div class="ks-wrapper">
                <h2>Keyboard Shortcuts</h2>
                <p class="ks-subtext">
                    Here are the shortcuts available in Puter.  
                    macOS users can use ⌘ instead of Ctrl.
                </p>
        `;

        sections.forEach(section => {
            html += `
                <div class="ks-section">
                    <h3>${section.title}</h3>
            `;

            section.list.forEach(item => {
                html += `
                    <div class="ks-row">
                        <span class="ks-text">${item.text}</span>
                        <span class="ks-keys">${renderKeys(item.keys)}</span>
                    </div>
                `;
            });

            html += `</div>`;
        });

        html += `
            </div>

            <style>
                .ks-wrapper { padding: 20px; }
                .ks-subtext { color: #666; margin-bottom: 20px; }
                .ks-section { margin-bottom: 24px; }
                .ks-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 6px 0;
                    border-bottom: 1px solid #eee;
                }
                .ks-key {
                    display: inline-block;
                    padding: 4px 8px;
                    background: #f2f2f2;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    margin-right: 4px;
                    font-family: monospace;
                    font-size: 12px;
                }
                .ks-plus { margin: 0 4px; color: #999; }
            </style>
        `;

        return html;
    }
};
