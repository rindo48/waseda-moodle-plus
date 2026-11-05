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

    /** 拡張機能自身の画面にテーマとデザイン（旧・新）を適用する */
    function applyUiTheme(settings, root = document.documentElement) {
        const theme =
            settings.uiTheme === "auto"
                ? matchMedia("(prefers-color-scheme: dark)").matches
                    ? "dark"
                    : "light"
                : settings.uiTheme;
        root.dataset.wmpTheme = theme;
        root.dataset.wmpDesign = settings.design === "new" ? "new" : "classic";
    }

    // ===== アイコン =====
    // 絵文字や記号（✓ ↻ ⋯ など）は環境で見た目が変わるので、線の太さと端の形をそろえた SVG を使う。
    // 端は四角（square / miter）にして、角の立った見た目に統一している。

    const ICONS = {
        home: "M3 11 12 4l9 7M5.5 9.5V20h5v-6h3v6h5V9.5",
        dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
        courses: "M4 4h5v16H4zM9 4h5v16H9zM14.5 5.2l4.3-1.1 3.2 15.3-4.3 1.1z",
        calendar: "M4 5.5h16V20H4zM4 10h16M8 3v4M16 3v4",
        deadline: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17zM12 7.5V12l3 2",
        search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM15.5 15.5 20 20",
        settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
        collapse: "M14 7l-5 5 5 5M5 5v14",
        expand: "M10 7l5 5-5 5M19 5v14",
        refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15",
        more: "M5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2z",
        close: "M6 6l12 12M18 6 6 18",
        eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
        eyeOff: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM4 4l16 16",
        edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
        check: "M5 12.5l4.5 4.5L19 7.5",
        plus: "M12 5v14M5 12h14",
        page: "M6 3h8.5L19 7.5V21H6zM14 3v5h5",
        external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
        grades: "M5 20v-8M12 20V5M19 20v-11M3 20h18",
        user: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM4.5 20c1.3-3.8 4.2-5.8 7.5-5.8s6.2 2 7.5 5.8",
        mail: "M3 6h18v12H3zM3 6l9 7 9-7",
        chevronLeft: "M15 6l-6 6 6 6",
        chevronRight: "M9 6l6 6-6 6",
        chevronDown: "M6 9l6 6 6-6",
        list: "M9 6h11M9 12h11M9 18h11M4 5h2v2H4zM4 11h2v2H4zM4 17h2v2H4z",
        board: "M3 5h18v12H3zM8 21l4-4 4 4M7 9h6M7 12h10",
    };
    const FILLED = new Set(["more"]);

    /** アイコンの <svg> を返す（el の子として使える） */
    function icon(name, { size = 18, label } = {}) {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("class", `wmp-icon wmp-icon-${name}`);
        const filled = FILLED.has(name);
        svg.setAttribute("fill", filled ? "currentColor" : "none");
        svg.setAttribute("stroke", filled ? "none" : "currentColor");
        svg.setAttribute("stroke-width", "1.8");
        svg.setAttribute("stroke-linecap", "square");
        svg.setAttribute("stroke-linejoin", "miter");
        if (label) {
            svg.setAttribute("role", "img");
            svg.setAttribute("aria-label", label);
        } else {
            svg.setAttribute("aria-hidden", "true");
        }
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", ICONS[name] ?? ICONS.page);
        svg.append(path);
        return svg;
    }

    /** 科目の頭文字（色の四角に入れる）。先頭の【…】や記号・数字は飛ばす */
    function courseInitial(name) {
        const text = String(name ?? "")
            .replace(/^[\s　]*[【［\[(（][^】］\])）]*[】］\])）]/u, "")
            .replace(/^[^\p{L}]+/u, "");
        const ch = [...text][0] ?? "?";
        return ch.toUpperCase();
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
        icon,
        courseInitial,
        moodlePageTheme,
        confirmSyllabusOverwrite,
        findSessionKey,
    });
})();
