// 画面側（ポップアップ・設定画面・コンテンツスクリプト）で共通に使う小さなヘルパー。
// lib/defaults.js の後に読み込むこと。
(() => {
    const WMP = globalThis.WMP;

    /**
     * 要素を作る。
     * el("div", { class: "a", onclick: fn }, "text", child)
     */
    function el(tag, attrs = {}, ...children) {
        const elem = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs ?? {})) {
            if (value === undefined || value === null || value === false) continue;
            if (key.startsWith("on") && typeof value === "function") {
                elem.addEventListener(key.slice(2), value);
            } else if (key === "value" || key === "innerHTML") {
                elem[key] = value;
            } else if (key === "class") {
                elem.className = value;
            } else if (key === "style" && typeof value === "object") {
                for (const [prop, v] of Object.entries(value)) {
                    if (prop.startsWith("--")) elem.style.setProperty(prop, v);
                    else elem.style[prop] = v;
                }
            } else if (key === "dataset") {
                Object.assign(elem.dataset, value);
            } else if (key in elem && typeof value !== "string") {
                elem[key] = value;
            } else {
                elem.setAttribute(key, value === true ? "" : value);
            }
        }
        for (const child of children.flat(Infinity)) {
            if (child === null || child === undefined || child === false) continue;
            elem.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return elem;
    }

    /** バックグラウンドにメッセージを送り、{ok, result, error} を解いて返す */
    async function send(type, payload) {
        const response = await chrome.runtime.sendMessage({ type, payload });
        if (!response) throw new Error("バックグラウンドから応答がありません");
        if (!response.ok) throw new Error(response.error);
        return response.result;
    }

    // ===== 学期・曜日・時限 =====

    const TERMS = {
        spring_quarter: "春クォーター",
        summer_quarter: "夏クォーター",
        fall_quarter: "秋クォーター",
        winter_quarter: "冬クォーター",
        spring_semester: "春学期",
        fall_semester: "秋学期",
        full_year: "通年",
    };
    /** 時間割で選べるのはクォーター単位。学期・通年の科目は含まれるクォーターに表示する */
    const QUARTERS = ["spring_quarter", "summer_quarter", "fall_quarter", "winter_quarter"];
    const QUARTER_SHORT = { spring_quarter: "春Q", summer_quarter: "夏Q", fall_quarter: "秋Q", winter_quarter: "冬Q" };

    function termContains(term, quarter) {
        switch (term) {
            case "spring_semester":
                return quarter === "spring_quarter" || quarter === "summer_quarter";
            case "fall_semester":
                return quarter === "fall_quarter" || quarter === "winter_quarter";
            case "full_year":
                return true;
            default:
                return term === quarter;
        }
    }

    const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const DAY_LABELS = { sunday: "日", monday: "月", tuesday: "火", wednesday: "水", thursday: "木", friday: "金", saturday: "土" };

    /** 2023年度以降の時限（早稲田の100分授業） */
    const PERIODS = {
        1: [[8, 50], [10, 30]],
        2: [[10, 40], [12, 20]],
        3: [[13, 10], [14, 50]],
        4: [[15, 5], [16, 45]],
        5: [[17, 0], [18, 40]],
        6: [[18, 55], [20, 35]],
        7: [[20, 45], [21, 35]],
    };

    const pad2 = (n) => String(n).padStart(2, "0");
    const formatHM = ([h, m]) => `${h}:${pad2(m)}`;

    /** 現在の時限（授業中なら番号、休み時間なら次の時限を {next} で返す） */
    function currentPeriod(now = new Date()) {
        const minutes = now.getHours() * 60 + now.getMinutes();
        for (const [period, [[sh, sm], [eh, em]]] of Object.entries(PERIODS)) {
            if (minutes >= sh * 60 + sm && minutes <= eh * 60 + em) return { current: Number(period) };
            if (minutes < sh * 60 + sm) return { next: Number(period) };
        }
        return {};
    }

    /** 年度（4月始まり） */
    function getSchoolYear(date = new Date()) {
        const d = new Date(date);
        d.setMonth(d.getMonth() - 3);
        return d.getFullYear();
    }

    /** 今日の日付から、だいたいのクォーターを推定する */
    function guessQuarter(date = new Date()) {
        const month = date.getMonth() + 1;
        if (month >= 4 && month <= 5) return "spring_quarter";
        if (month >= 6 && month <= 9) return "summer_quarter";
        if (month >= 10 && month <= 11) return "fall_quarter";
        return "winter_quarter";
    }

    // ===== 色 =====

    const PALETTE = [
        "#4f7cff", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6",
        "#12a594", "#d6409f", "#ad7f58", "#0090ff", "#ffb224",
        "#5b5bd6", "#7d8b99",
    ];

    /** 科目IDから既定の色を決める（設定で上書き可能） */
    function courseColor(settings, courseId) {
        const override = settings.courseColors?.[courseId];
        if (override) return override;
        let hash = 0;
        for (const c of String(courseId)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
        return PALETTE[hash % PALETTE.length];
    }

    function courseName(settings, course) {
        return settings.courseNameOverrides?.[course.id] || course.name || `(科目 ${course.id})`;
    }

    // ===== 日時表示 =====

    const dateFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
    const timeFormat = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });

    function formatRemaining(ms) {
        const abs = Math.abs(ms);
        const minutes = Math.floor(abs / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        let text;
        if (days >= 1) text = `${days}日${hours % 24 ? `${hours % 24}時間` : ""}`;
        else if (hours >= 1) text = `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
        else text = `${Math.max(minutes, 1)}分`;
        return ms >= 0 ? `あと${text}` : `${text}超過`;
    }

    /** 拡張機能自身の画面にテーマを適用する */
    function applyUiTheme(settings, root = document.documentElement) {
        const theme =
            settings.uiTheme === "auto"
                ? matchMedia("(prefers-color-scheme: dark)").matches
                    ? "dark"
                    : "light"
                : settings.uiTheme;
        root.dataset.wmpTheme = theme;
    }

    /** Moodle のページに適用するテーマ（ダークモード設定に合わせる） */
    function moodlePageTheme(settings) {
        if (settings.darkMode === "on") return "dark";
        if (settings.darkMode === "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        return "light";
    }

    /**
     * 「シラバスから取得」で、すでに時間割を設定した科目が上書きされることを確認する。
     * @param {number} [year] - 対象の年度（省略するとすべての年度）
     * @returns {boolean} 続けてよいか
     */
    function confirmSyllabusOverwrite(settings, year) {
        const count = Object.values(settings.timetable).filter((slots) => slots.some((s) => !year || s.year === year)).length;
        if (count === 0) return true;
        return confirm(
            `時間割を設定済みの${count}科目は、曜日・時限・教室・授業の形式がシラバスの内容で上書きされます。` +
                "手で編集した内容も元に戻ります。\n\n続けますか？"
        );
    }

    /** ページ上の sesskey を取り出す */
    function findSessionKey(doc = document) {
        const href = doc
            .querySelector('a[href*="/login/logout.php?sesskey="]')
            ?.getAttribute("href");
        const fromLink = href?.match(/sesskey=([^&]+)/)?.[1];
        if (fromLink) return fromLink;
        return doc.documentElement.innerHTML.match(/"sesskey":"([^"]+)"/)?.[1];
    }

    Object.assign(WMP, {
        el,
        send,
        TERMS,
        QUARTERS,
        QUARTER_SHORT,
        termContains,
        DAYS,
        DAY_LABELS,
        PERIODS,
        formatHM,
        currentPeriod,
        getSchoolYear,
        guessQuarter,
        PALETTE,
        courseColor,
        courseName,
        dateFormat,
        timeFormat,
        formatRemaining,
        applyUiTheme,
        moodlePageTheme,
        confirmSyllabusOverwrite,
        findSessionKey,
    });
})();
