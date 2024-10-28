document.addEventListener('DOMContentLoaded', () => {
    const newestVersionSpan = document.getElementById('newest-version');
    const currentVersionSpan = document.getElementById('current-version');
    const githubLink = document.getElementById('github-link');
    const bilibiliLink = document.getElementById('bilibili-link');

    const fetchLatestVersion = async () => {
        const failedMessage = await window.api.invoke('translate', 'about.load_failed');
        const { currentVersion, latestVersion } = await window.api.invoke('get-versions');

        if (latestVersion) {
            newestVersionSpan.innerText = latestVersion;
        } else {
            newestVersionSpan.innerText = failedMessage;
            newestVersionSpan.style.color = 'red';
        }
        currentVersionSpan.innerText = currentVersion;

        if (latestVersion && latestVersion > currentVersion) {
            currentVersionSpan.style.color = 'red';
            newestVersionSpan.style.color = 'green';
        }
    };

    fetchLatestVersion();
    updateTranslations(document);

    githubLink.addEventListener('click', () => {
        window.api.invoke('open-url', githubLink.innerText);
    });
    bilibiliLink.addEventListener('click', () => {
        window.api.invoke('open-url', bilibiliLink.innerText);
    });
});
