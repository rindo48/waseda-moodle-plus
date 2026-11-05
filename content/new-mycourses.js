// 新デザイン: マイコース（/my/courses.php）を作り替える。
// Moodle は科目を同じ大きさのカードで並べるが、学生が科目を探すときの手がかりは「何曜の何限か」なので、
// - 「今学期」: 曜日ごとに区切り、時限の順に1行ずつ並べる（時刻表のような一覧）
// - 「すべての年度」: 年度ごとにまとめた一覧
// にする。元のカード表示はボタンで戻せる。

globalThis.WMP.initNewMyCourses = async function initNewMyCourses(initialSettings) {
    const WMP = globalThis.WMP;
    const { el } = WMP;
    let settings = initialSettings;

    const original =
        document.querySelector("section.block_myoverview, .block_myoverview")?.closest("section.block, .block") ??
        document.querySelector(".block_myoverview");
    const host = original?.parentElement ?? document.querySelector("#region-main [role='main']") ?? document.querySelector("#region-main");
    if (!host) return;

    const root = el("div", { class: "wmp-scope wmp-courses", id: "wmp-courses" });
    if (original) original.insertAdjacentElement("beforebegin", root);
    else host.prepend(root);

    const MODE_KEY = "wmpCoursesView";
    let view = localStorage.getItem(MODE_KEY) === "all" ? "all" : "term";
    let query = "";
    let courses = null;
    let events = [];
    let error = null;

    // Moodle の元の表示との切り替え
    const ORIGINAL_KEY = "wmpShowOriginalCourses";
    function showOriginal(show) {
        localStorage.setItem(ORIGINAL_KEY, show ? "1" : "");
        root.hidden = show;
        if (original) original.style.display = show ? "" : "none";
        backBar.hidden = !show;
    }
    const backBar = el(
        "div",
        { class: "wmp-scope wmp-back-bar", hidden: true },
        el("span", {}, "Moodle の元の表示です。"),
        el("button", { type: "button", class: "wmp-btn is-small", onclick: () => showOriginal(false) }, "新デザインの一覧に戻す")
    );
    root.insertAdjacentElement("beforebegin", backBar);

    // ===== 部品 =====

    const tabs = el("div", { class: "wmp-tabs", role: "tablist", "aria-label": "表示" });
    const searchInput = el("input", {
        class: "wmp-input wmp-courses-search",
        type: "search",
        placeholder: "科目名で絞り込み",
        "aria-label": "科目名で絞り込み",
        oninput: (e) => {
            query = e.target.value;
            renderBody();
        },
    });
    const body = el("div", { class: "wmp-courses-body" });

    root.append(
        el(
            "header",
            { class: "wmp-courses-head" },
            tabs,
            searchInput,
            el("button", { type: "button", class: "wmp-btn is-small", onclick: () => showOriginal(true) }, "Moodle の表示")
        ),
        body
    );

    function renderTabs() {
        const tab = (id, label) =>
            el(
                "button",
                {
                    type: "button",
                    role: "tab",
                    class: view === id ? "is-active" : "",
                    "aria-selected": String(view === id),
                    onclick: () => {
                        view = id;
                        localStorage.setItem(MODE_KEY, id);
                        renderTabs();
                        renderBody();
                    },
                },
                label
            );
        const year = WMP.getSchoolYear();
        tabs.replaceChildren(tab("term", `今学期（${year}年度 ${WMP.TERMS[WMP.guessQuarter()]}）`), tab("all", "すべての年度"));
    }

    // ===== データ =====

    async function load() {
        const [c, t] = await Promise.allSettled([WMP.send("getCourses"), WMP.send("getTimeline")]);
        if (c.status === "fulfilled") {
            courses = c.value.value;
            error = c.value.error ?? null;
        } else {
            courses = [];
            error = c.reason?.message ?? String(c.reason);
        }
        events = t.status === "fulfilled" ? t.value.value : [];
        renderBody();
    }

    function pendingFor(courseId) {
        const now = Date.now();
        return WMP.visibleEvents(events, settings)
            .filter((e) => String(e.course?.id) === courseId && e.actionable !== false && e.timesort * 1000 > now)
            .sort((a, b) => a.timesort - b.timesort);
    }

    const matches = (c) => {
        const q = query.trim().normalize("NFKC").toLowerCase();
        return !q || `${WMP.courseName(settings, c)} ${c.name}`.normalize("NFKC").toLowerCase().includes(q);
    };

    const DELIVERY = { face_to_face: "対面", realtime_streaming: "リアルタイム配信", on_demand: "オンデマンド" };

    // ===== 行 =====

    function courseRow(c, { slot, withDay = false } = {}) {
        const pending = pendingFor(c.id);
        const next = pending[0];
        const name = WMP.courseName(settings, c);
        const syllabusKey = settings.courseSyllabusKeys[c.id];
        const periodText = slot
            ? slot.day === "on_demand"
                ? "オンデマンド"
                : `${withDay ? WMP.DAY_LABELS[slot.day] : ""}${slot.from === slot.to ? `${slot.from}限` : `${slot.from}〜${slot.to}限`}`
            : "";
        return el(
            "tr",
            { class: `wmp-courses-row${c.hidden ? " is-hidden" : ""}`, style: { "--wmp-course-color": WMP.courseColor(settings, c.id) } },
            el("td", { class: "wmp-courses-period" }, periodText),
            el(
                "td",
                { class: "wmp-courses-name" },
                el(
                    "a",
                    { href: c.url },
                    el("span", { class: "wmp-mark", "aria-hidden": "true" }, WMP.courseInitial(name)),
                    el("span", {}, name)
                ),
                name !== c.name ? el("span", { class: "wmp-courses-original" }, c.name) : null
            ),
            el("td", { class: "wmp-courses-room" }, slot?.classroom || ""),
            el("td", { class: "wmp-courses-delivery" }, DELIVERY[settings.courseDeliveryMethods[c.id]] ?? ""),
            el(
                "td",
                { class: "wmp-courses-due" },
                next
                    ? el(
                          "a",
                          { href: next.url, title: next.activityname ?? next.name, class: next.timesort * 1000 - Date.now() < WMP.DAY ? "is-urgent" : "" },
                          `${WMP.formatRemaining(next.timesort * 1000 - Date.now())}　${next.activityname ?? next.name}`,
                          pending.length > 1 ? el("span", { class: "wmp-courses-due-more" }, `ほか${pending.length - 1}件`) : null
                      )
                    : el("span", { class: "wmp-muted" }, "なし")
            ),
            el(
                "td",
                { class: "wmp-courses-links" },
                syllabusKey
                    ? el(
                          "a",
                          { href: `https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${syllabusKey}`, target: "_blank", rel: "noopener", title: "シラバスを開く" },
                          "シラバス"
                      )
                    : null
            )
        );
    }

    function table(rowsOrGroups) {
        return el(
            "table",
            { class: "wmp-courses-table" },
            el(
                "thead",
                {},
                el(
                    "tr",
                    {},
                    el("th", { scope: "col" }, "時限"),
                    el("th", { scope: "col" }, "科目"),
                    el("th", { scope: "col" }, "教室"),
                    el("th", { scope: "col" }, "形式"),
                    el("th", { scope: "col" }, "次の締切"),
                    el("th", { scope: "col" }, el("span", { class: "wmp-visually-hidden" }, "リンク"))
                )
            ),
            rowsOrGroups
        );
    }

    function groupBody(label, rows, { sub } = {}) {
        if (rows.length === 0) return null;
        return el(
            "tbody",
            {},
            el("tr", { class: "wmp-courses-group" }, el("th", { colspan: "6", scope: "rowgroup" }, label, sub ? el("span", { class: "wmp-courses-group-sub" }, sub) : null)),
            rows
        );
    }

    // ===== 今学期 =====

    function renderTerm() {
        const year = WMP.getSchoolYear();
        const quarter = WMP.guessQuarter();
        const todayKey = WMP.DAYS[new Date().getDay()];
        const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const byDay = Object.fromEntries([...DAYS, "on_demand"].map((d) => [d, []]));
        const unscheduled = [];

        for (const c of courses.filter(matches)) {
            const slots = (settings.timetable[c.id] ?? []).filter((s) => s.year === year && WMP.termContains(s.term, quarter));
            if (slots.length > 0) {
                for (const slot of slots) byDay[slot.day]?.push({ c, slot });
            } else if (c.year === year && !c.hidden && !(settings.timetable[c.id] ?? []).some((s) => s.year === year)) {
                unscheduled.push(c);
            }
        }

        const groups = [
            ...DAYS.map((d) =>
                groupBody(
                    `${WMP.DAY_LABELS[d]}曜日`,
                    byDay[d].sort((a, b) => a.slot.from - b.slot.from).map(({ c, slot }) => courseRow(c, { slot })),
                    { sub: d === todayKey ? "今日" : "" }
                )
            ),
            groupBody(
                "オンデマンド",
                byDay.on_demand.map(({ c, slot }) => courseRow(c, { slot }))
            ),
            groupBody(
                "曜日・時限が未設定",
                unscheduled.map((c) => courseRow(c)),
                { sub: "ダッシュボードの時間割で「シラバスから取得」を押すと設定されます" }
            ),
        ].filter(Boolean);

        if (groups.length === 0) {
            return el("div", { class: "wmp-empty" }, query ? "一致する科目はありません" : "今学期の科目が見つかりません。「すべての年度」で探せます。");
        }
        return table(groups);
    }

    // ===== すべての年度 =====

    function renderAll() {
        const byYear = new Map();
        for (const c of courses.filter(matches)) {
            const key = c.year ?? 0;
            if (!byYear.has(key)) byYear.set(key, []);
            byYear.get(key).push(c);
        }
        const years = [...byYear.keys()].sort((a, b) => b - a);
        if (years.length === 0) return el("div", { class: "wmp-empty" }, "一致する科目はありません");
        return table(
            years.map((y) =>
                groupBody(
                    y ? `${y}年度` : "年度不明",
                    byYear
                        .get(y)
                        .sort((a, b) => WMP.courseName(settings, a).localeCompare(WMP.courseName(settings, b), "ja"))
                        .map((c) => {
                            const slot = (settings.timetable[c.id] ?? []).find((s) => s.year === y);
                            return courseRow(c, { slot, withDay: true });
                        }),
                    { sub: `${byYear.get(y).length}科目` }
                )
            )
        );
    }

    function renderBody() {
        if (courses === null) {
            body.replaceChildren(el("div", { class: "wmp-empty" }, el("div", { class: "wmp-spinner", style: { margin: "0 auto" } })));
            return;
        }
        // replaceChildren は null を「null」という文字にしてしまうので、無いものは除く
        body.replaceChildren(
            ...[
                error ? el("div", { class: "wmp-error" }, `科目一覧を最新にできませんでした（${error}）。前回の内容を表示しています。`) : null,
                view === "all" ? renderAll() : renderTerm(),
            ].filter(Boolean)
        );
    }

    WMP.onSettingsChanged((next) => {
        settings = next;
        renderBody();
    });

    renderTabs();
    renderBody();
    showOriginal(localStorage.getItem(ORIGINAL_KEY) === "1");
    load();
};
