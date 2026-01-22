const icons = {
    ai_outline: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>',
    ai_active: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>',
    fs_outline: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-icon lucide-cloud"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    fs_active: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-icon lucide-cloud"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    kv_outline: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database-icon lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
    kv_active: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database-icon lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
    hosting_outline: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe-icon lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    hosting_active: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe-icon lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    auth_outline: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-lock-icon lucide-user-lock"><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><path d="M15 15.5V14a2 2 0 0 1 4 0v1.5"/><rect width="8" height="5" x="13" y="16" rx=".899"/></svg>',
    auth_active: '<svg style="margin-right: 5px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-lock-icon lucide-user-lock"><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><path d="M15 15.5V14a2 2 0 0 1 4 0v1.5"/><rect width="8" height="5" x="13" y="16" rx=".899"/></svg>',
};

jQuery(document).ready(function () {
    // add icons to .icon elements
    $('.example-group').each(function () {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    });

    $('.example-group.active').each(function () {
        $(this).find('.icon').html(icons[$(this).data('icon-active')]);
    });

    // "Copy code" buttons
    $(document).on('click', '.copy-code-button', function (e) {
        const $codeWrapper = $(this).closest('.code-wrapper');
        const $codeBlock = $codeWrapper.find('code').first();

        navigator.clipboard.writeText($codeBlock.text());
        // show check mark for 1 second after copying
        $(this).find('.copy').css('background-image', 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23012238\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'20 6 9 17 4 12\'/%3E%3C/svg%3E")');
        setTimeout(() => {
            $(this).find('.copy').css('background-image', '');
        }, 1000);
    });

    // "Download code" buttons
    $(document).on('click', '.download-code-button', function (e) {
        const $codeWrapper = $(this).closest('.code-wrapper');
        const $codeBlock = $codeWrapper.find('code').first();
        const $filename = 'puter-example.html';
        const $code = $codeBlock.text();

        const blob = new Blob([$code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.className = 'skip-insta-load';
        a.href = url;
        a.download = $filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    });
});

$(document).on('pathchange', function (e) {
    // add icons to .icon elements
    $('.example-group').each(function () {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    });

    $('.example-group.active').each(function () {
        $(this).find('.icon').html(icons[$(this).data('icon-active')]);
    });

    // highlight code
    $('code[class^=\'language\']').each(function () {
        var $this = $(this);
        if ( $this.attr('data-highlighted') === 'yes' ) {
            // Remove the attribute or set it to 'no'
            $this.removeAttr('data-highlighted');
        }
        // Now you can re-highlight
        else {
            try {
                hljs.configure({ ignoreUnescapedHTML: true });
                hljs.highlightElement(this);
            } catch (e) {
                console.error('Error: Failed to highlight.', e);
            }
        }
    });
});

$(document).on('click', '.example-group', function (e) {
    e.preventDefault();
    $('.example-group').removeClass('active');
    // change all icons to outline
    $('.example-group').not(this).each(function () {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    });
    $(this).toggleClass('active');
    // change icon
    if ( $(this).hasClass('active') ) {
        $(this).find('.icon').html(icons[$(this).data('icon-active')]);
    } else {
        $(this).find('.icon').html(icons[$(this).data('icon')]);
    }
    // show content
    $('.example-content').hide();
    let section = $(this).data('section');
    if ( $(this).hasClass('active') ) {
        $(`.example-content[data-section="${section}"]`).show();
    }
});
