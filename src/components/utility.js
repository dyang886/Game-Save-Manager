async function updateTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(async (el) => {
        const key = el.getAttribute("data-i18n");
        const translation = await window.i18n.translate(key);
        if (translation) {
            el.innerText = translation;
        }
    });
};

window.api.receive('apply-language', () => {
    updateTranslations();
});

window.api.receive('apply-theme', (theme) => {
    if (theme === 'dark') {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }
});