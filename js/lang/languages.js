/* The languages StremioK offers besides English (Settings › Appearance › Language): those at
   least 90% translated. Written by translations/build.js from translations/*.json: change
   those, not this. Each answers for the TV languages it matches (the closest wins) and says
   how numbers change its words (and whether it runs right to left). Global: I18N_LANGS (read by js/i18n.js) */
var I18N_LANGS = [
    { code: "ar", name: "العربية", matches: ["ar"], plural: "arabic", direction: "rtl" },
    { code: "ca", name: "Català", matches: ["ca"], plural: "one" },
    { code: "de", name: "Deutsch", matches: ["de"], plural: "one" },
    { code: "es", name: "Español", matches: ["es"], plural: "one" },
    { code: "fi", name: "Suomi", matches: ["fi"], plural: "one" },
    { code: "fr", name: "Français", matches: ["fr"], plural: "zero-one" },
    { code: "he", name: "עברית", matches: ["he","iw"], plural: "hebrew", direction: "rtl" },
    { code: "hi", name: "हिन्दी", matches: ["hi"], plural: "zero-one" },
    { code: "it", name: "Italiano", matches: ["it"], plural: "one" },
    { code: "ja", name: "日本語", matches: ["ja"], plural: "none" },
    { code: "ko", name: "한국어", matches: ["ko"], plural: "none" },
    { code: "pl", name: "Polski", matches: ["pl"], plural: "polish" },
    { code: "pt-BR", name: "Português (Brasil)", matches: ["pt"], plural: "zero-one" },
    { code: "ru", name: "Русский", matches: ["ru"], plural: "slavic" },
    { code: "tr", name: "Türkçe", matches: ["tr"], plural: "none" },
    { code: "zh-CN", name: "简体中文", matches: ["zh"], plural: "none" }
];
