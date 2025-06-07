import { updateTranslations } from './utility.js';

document.addEventListener('DOMContentLoaded', () => {
    const latestVersionSpan = document.getElementById('latest-version');
    const currentVersionSpan = document.getElementById('current-version');
    const githubLink = document.getElementById('github-link');
    const bilibiliLink = document.getElementById('bilibili-link');

    const fetchLatestVersion = async () => {
        const currentVersion = await window.api.invoke('get-current-version');
        currentVersionSpan.innerText = currentVersion;

        const failedMessage = await window.api.invoke('translate', 'about.load_failed');
        const latestVersion = await window.api.invoke('get-latest-version');

        if (latestVersion) {
            latestVersionSpan.innerText = latestVersion;
        } else {
            latestVersionSpan.innerText = failedMessage;
            latestVersionSpan.style.color = 'red';
        }

        if (latestVersion && latestVersion > currentVersion) {
            currentVersionSpan.style.color = 'red';
            latestVersionSpan.style.color = 'green';
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
