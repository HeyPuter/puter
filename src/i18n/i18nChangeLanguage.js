function ChangeLanguage(lang) {
    window.locale = lang;
    window.mutate_user_preferences({
        language : lang,
    });
}

export default ChangeLanguage;