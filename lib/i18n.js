// 表示の言語（日本語・英語・中国語・韓国語）。lib/defaults.js の後、英語の辞書（lib/i18n-en.js）の前に読み込む。
//
// 使い方: WMP.t("締切") → 英語なら "Deadlines"。日本語の文そのものを辞書の見出しにする。
// 訳が無い文は英語の辞書で引き、それも無ければ日本語のまま出す（訳し漏れがあっても壊れない）。
// 差し込み: WMP.t("あと{n}日", { n: 3 }) → "{n} days left" の {n} を置き換える。
//
// 言語の決め方: 設定「言語」が「自動」なら Moodle の言語設定（<html lang>）に合わせる。
// Moodle の言語がこの拡張機能の対応していない言語（ドイツ語など）なら英語にする。
// Moodle の外（ポップアップ・設定画面・バックグラウンド）では、最後に開いた Moodle の言語を使う。
// 言語はどの画面も最初に呼ぶ WMP.getSettings() の中で決めるので、描く前には決まっている。
//
// 辞書: 英語は lib/i18n-en.js（いつも読み込む。他の言語の訳が無いときの代わりにも使う）。
// それ以外は lib/i18n/<言語>.json を、その言語のときだけ読み込む。
(() => {
    const WMP = globalThis.WMP;
    /** 対応している言語と、日付の書式に使うロケール */
    const LOCALES = { ja: "ja-JP", en: "en-US", zh_cn: "zh-CN", zh_tw: "zh-TW", ko: "ko-KR" };
    const SUPPORTED = Object.keys(LOCALES);
    const MOODLE_LANG_KEY = "moodleLang";
    WMP.i18nDicts ??= {};

    let lang = "ja";

    /** "en-US" / "zh_cn" / "zh-TW" / "ja" → 対応している言語。対応していなければ null */
    function normalize(value) {
        const s = String(value ?? "").toLowerCase().replace(/-/g, "_");
        if (!s) return null;
        if (s.startsWith("zh")) return /_(tw|hk|mo|hant)/.test(s) ? "zh_tw" : "zh_cn";
        const base = s.split("_")[0];
        return SUPPORTED.includes(base) ? base : null;
    }

    const onMoodle = typeof location !== "undefined" && location.origin === "https://wsdmoodle.waseda.jp" && typeof document !== "undefined";

    /** lib/i18n/<言語>.json を読み込む（英語・日本語は不要） */
    async function loadDict(code) {
        if (code === "ja" || code === "en" || WMP.i18nDicts[code]) return;
        try {
            const res = await fetch(chrome.runtime.getURL(`lib/i18n/${code}.json`));
            if (res.ok) WMP.i18nDicts[code] = await res.json();
        } catch {
            // 読めなければ英語の辞書で出す
        }
    }

    async function decideLang(settings) {
        let moodleLang = null;
        if (onMoodle) {
            moodleLang = document.documentElement.lang || null;
            // Moodle の外の画面のために覚えておく（変わったときだけ書く）
            const { [MOODLE_LANG_KEY]: saved } = await chrome.storage.local.get(MOODLE_LANG_KEY);
            if (moodleLang && saved !== moodleLang) chrome.storage.local.set({ [MOODLE_LANG_KEY]: moodleLang });
        } else {
            ({ [MOODLE_LANG_KEY]: moodleLang } = await chrome.storage.local.get(MOODLE_LANG_KEY));
        }
        const chosen = settings.language && settings.language !== "auto" ? normalize(settings.language) : null;
        // Moodle の言語が分かっていれば、それに合わせる（対応していない言語なら英語）。分からなければブラウザの言語
        const fromMoodle = moodleLang ? normalize(moodleLang) ?? "en" : null;
        lang = chosen ?? fromMoodle ?? normalize(globalThis.navigator?.language) ?? "ja";
        await loadDict(lang);
        if (typeof document !== "undefined" && !onMoodle) document.documentElement.lang = LOCALES[lang];
    }

    const getSettings = WMP.getSettings;
    WMP.getSettings = async function getSettingsWithLang() {
        const settings = await getSettings();
        await decideLang(settings).catch(() => {});
        return settings;
    };

    /** 文を今の言語にする（訳が無ければ英語、それも無ければ日本語のまま）。vars があれば {名前} を置き換える */
    function t(text, vars) {
        let s = lang === "ja" ? text : WMP.i18nDicts[lang]?.[text] ?? WMP.i18nDicts.en?.[text] ?? text;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
        return s;
    }

    /**
     * HTML に直接書いた文（ポップアップ・設定画面など）を今の言語にする。
     * 文だけの要素の中身と、title・aria-label・placeholder を辞書で引いて置き換える
     */
    function translateDom(root = document) {
        if (lang === "ja") return;
        const dict = { ...WMP.i18nDicts.en, ...WMP.i18nDicts[lang] };
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
        locale: () => LOCALES[lang],
        SUPPORTED_LANGS: SUPPORTED,
    });
})();
