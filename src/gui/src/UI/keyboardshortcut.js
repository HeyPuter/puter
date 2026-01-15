export function KeyboardShortcuts () {
    const shortcuts = [
        { key: 'Ctrl + ,', action: 'Open Settings' },
        { key: 'Ctrl + K', action: 'Open Search' },
        { key: 'Ctrl + B', action: 'Toggle Sidebar' },
    ];

    const container = document.createElement('div');
    container.style.padding = '20px';

    const title = document.createElement('h2');
    title.innerText = 'Keyboard Shortcuts';

    const list = document.createElement('ul');
    shortcuts.forEach((s) => {
        const li = document.createElement('li');
        li.innerText = `${s.key} — ${s.action}`;
        list.appendChild(li);
    });

    container.appendChild(title);
    container.appendChild(list);

    return container;
}
