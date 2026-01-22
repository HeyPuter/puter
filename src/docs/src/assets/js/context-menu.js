jQuery(document).ready(function () {
    // Dropdown toggle functionality
    $(document).on('click', '.dropdown-button', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $('.menu-dropdown-items').toggle();
    });

    // Menu button click handlers
    $(document).on('click', '#menu-copy-page', async function (e) {
        const markdownUrl = new URL('index.md', window.location.href).toString();
        try {
            /**
             * The MIT License (MIT) Copyright (c) 2021 Cloudflare, Inc.
             * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
             * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
             */
            const clipboardItem = new ClipboardItem({
                ['text/plain']: fetch(markdownUrl)
                    .then((r) => r.text())
                    .then((t) => new Blob([t], { type: 'text/plain' }))
                    .catch((e) => {
                        throw new Error(`Received ${e.message} for ${markdownUrl}`);
                    }),
            });

            await navigator.clipboard.write([clipboardItem]);

            const buttonElement = document.querySelector('#menu-copy-page span');
            const originalContent = buttonElement.innerHTML;
            buttonElement.textContent = 'Copied!';

            setTimeout(() => {
                buttonElement.innerHTML = originalContent;
            }, 2000);
        } catch ( error ) {
            console.error('Failed to copy Markdown:', error);
        }
    });

    $(document).on('click', '#menu-view-markdown', function (e) {
        window.open(new URL('index.md', window.location.href), '_blank');
    });

    $(document).on('click', '#menu-open-chatgpt', function (e) {
        const message = `Read from ${window.location.href} so I can ask questions about it.`;
        window.open(`https://chat.openai.com/?q=${message}`, '_blank');
    });

    $(document).on('click', '#menu-open-claude', function (e) {
        const message = `Read from ${window.location.href} so I can ask questions about it.`;
        window.open(`https://claude.ai/new?q=${message}`, '_blank');
    });
});

// Close menu dropdown if clicking outside
$(document).on('click', function (e) {
    if ( ! $(e.target).closest('.menu-item-main').length ) {
        $('.menu-dropdown-items').hide();
    }
    if ( ! $(e.target).closest('.menu-item').length ) {
        $('.menu-dropdown-items').hide();
    }
});