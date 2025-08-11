window.addEventListener('DOMContentLoaded', () => {
    const addressBar = document.getElementById('address-bar');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const contentFrame = document.getElementById('content');

    addressBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            let url = addressBar.value;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            contentFrame.src = url;
        }
    });

    backBtn.addEventListener('click', () => {
        contentFrame.contentWindow.history.back();
    });

    forwardBtn.addEventListener('click', () => {
        contentFrame.contentWindow.history.forward();
    });

    reloadBtn.addEventListener('click', () => {
        contentFrame.contentWindow.location.reload();
    });
});
