// 表示の言語（日本語・英語…）。lib/defaults.js の後、辞書（lib/i18n-*.js）の前に読み込む。
//
// 使い方: WMP.t("締切") → 英語なら "Deadlines"。日本語の文そのものを辞書の見出しにするので、
// 辞書に無い文は日本語のまま出る（訳し漏れがあっても壊れない）。
// 差し込み: WMP.t("あと{n}日", { n: 3 }) → "{n} days left" の {n} を置き換える。
//
// 言語の決め方: 設定「言語」が「自動」なら Moodle の言語設定（<html lang>）に合わせる。
// Moodle の外（ポップアップ・設定画面・バックグラウンド）では、最後に開いた Moodle の言語を使う。
// 言語はどの画面も最初に呼ぶ WMP.getSettings() の中で決めるので、描く前には決まっている。
(() => {
    const WMP = globalThis.WMP;
    const SUPPORTED = ["ja", "en"];
    const MOODLE_LANG_KEY = "moodleLang";
    WMP.i18nDicts ??= {};

    let lang = "ja";

    /** "en-US" / "en_us" / "ja" → 対応している言語。対応していなければ null */
    function normalize(value) {
        const base = String(value ?? "").toLowerCase().split(/[-_]/)[0];
        return SUPPORTED.includes(base) ? base : null;
    }

    const onMoodle = typeof location !== "undefined" && location.origin === "https://wsdmoodle.waseda.jp" && typeof document !== "undefined";

    async function decideLang(settings) {
        let moodleLang = null;
        if (onMoodle) {
            moodleLang = normalize(document.documentElement.lang);
            // Moodle の外の画面のために覚えておく（変わったときだけ書く）
            const { [MOODLE_LANG_KEY]: saved } = await chrome.storage.local.get(MOODLE_LANG_KEY);
            if (moodleLang && saved !== moodleLang) chrome.storage.local.set({ [MOODLE_LANG_KEY]: moodleLang });
        } else {
            ({ [MOODLE_LANG_KEY]: moodleLang } = await chrome.storage.local.get(MOODLE_LANG_KEY));
        }
        const chosen = settings.language && settings.language !== "auto" ? normalize(settings.language) : null;
        lang = chosen ?? normalize(moodleLang) ?? normalize(globalThis.navigator?.language) ?? "ja";
        if (typeof document !== "undefined" && !onMoodle) document.documentElement.lang = lang;
    }

    const getSettings = WMP.getSettings;
    WMP.getSettings = async function getSettingsWithLang() {
        const settings = await getSettings();
        await decideLang(settings).catch(() => {});
        return settings;
    };

    /** 文を今の言語にする。vars があれば {名前} を置き換える */
    function t(text, vars) {
        let s = lang === "ja" ? text : WMP.i18nDicts[lang]?.[text] ?? text;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
        return s;
    }

    /**
     * HTML に直接書いた文（ポップアップ・設定画面など）を今の言語にする。
     * 文だけの要素の中身と、title・aria-label・placeholder を辞書で引いて置き換える
     */
    function translateDom(root = document) {
        if (lang === "ja") return;
        const dict = WMP.i18nDicts[lang] ?? {};
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const key = n.data.trim();
            if (key && dict[key]) n.data = n.data.replace(key, dict[key]);
        }
        for (const e of root.querySelectorAll?.("[title], [aria-label], [placeholder]") ?? []) {
            for (const attr of ["title", "aria-label", "placeholder"]) {
                const v = e.getAttribute(attr);
                if (v && dict[v]) e.setAttribute(attr, dict[v]);
            }
        }
        if (root === document && dict[document.title]) document.title = dict[document.title];
    }

    Object.assign(WMP, {
        t,
        translateDom,
        getLang: () => lang,
        /** 日付・数の書式に使うロケール */
        locale: () => (lang === "ja" ? "ja-JP" : "en-US"),
        SUPPORTED_LANGS: SUPPORTED,
    });
})();
