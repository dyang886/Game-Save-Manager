async function updateTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(async (el) => {
        const key = el.getAttribute("data-i18n");
        const translation = await window.i18n.translate(key);
        if (translation) {
            if (el.classList.contains('text-content')) {
                el.innerText = translation;
            }
            const textContentElement = el.querySelector('.text-content');
            if (textContentElement) {
                textContentElement.innerText = translation;
            }
        }
    });
}

window.api.receive('apply-language', () => {
    updateTranslations();
});

function changeTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

window.api.receive('apply-theme', (theme) => {
    changeTheme(theme);
});

window.api.send('load-theme');
