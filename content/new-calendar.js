// 新デザイン: カレンダー（/calendar/view.php の月表示）を作り替える。
// Moodle の月表示は小さな表に予定を詰め込むだけなので、
// - 左に月の表（予定は科目の色の印・時刻・名前の1行ずつ）、右にその日の「授業」と「予定」を並べる
// - 日付を押すと右側がその日に変わる。授業は時間割の設定から出す
// データは Moodle のカレンダー画面が月の移動に使っている API（core_calendar_get_calendar_monthly_view）から取る。
// 取れなかったときは Moodle の元の表示に戻す。

globalThis.WMP.initNewCalendar = async function initNewCalendar(initialSettings) {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;
    let settings = initialSettings;

    const params = new URLSearchParams(location.search);
    // Moodle は view を省略すると「今後の予定」になる。月表示と明示されたときだけ作り替え、
    // 日・今後の予定の表示や、科目ごとのカレンダー（course=科目ID）は Moodle のまま（見た目だけ新デザイン）にする
    if (params.get("view") !== "month") return;
    const courseParam = params.get("course");
    if (courseParam && courseParam !== "1") return;

    const original = document.querySelector("#region-main .maincalendar") ?? document.querySelector("[data-region='calendar']");
    if (!original) return;

    const root = el("div", { class: "wmp-scope wmp-cal", id: "wmp-calendar" });
    original.insertAdjacentElement("beforebegin", root);

    const ORIGINAL_KEY = "wmpShowOriginalCalendar";
    const backBar = el(
        "div",
        { class: "wmp-scope wmp-back-bar", hidden: true },
        el("span", {}, WMP.t("Moodle の元の表示です。")),
        el("button", { type: "button", class: "wmp-btn is-small", onclick: () => showOriginal(false) }, WMP.t("新デザインのカレンダーに戻す"))
    );
    root.insertAdjacentElement("beforebegin", backBar);
    function showOriginal(show, { remember = true } = {}) {
        if (remember) localStorage.setItem(ORIGINAL_KEY, show ? "1" : "");
        root.hidden = show;
        original.style.display = show ? "" : "none";
        backBar.hidden = !show;
    }

    // ===== 状態 =====

    const initialTime = Number(params.get("time")) * 1000 || Date.now();
    const initialDate = new Date(initialTime);
    let year = initialDate.getFullYear();
    let month = initialDate.getMonth() + 1;
    let selectedKey = dateKey(new Date());
    if (new Date().getFullYear() !== year || new Date().getMonth() + 1 !== month) selectedKey = dateKey(new Date(year, month - 1, 1));

    const cache = new Map();
    let data = null;
    let loading = false;
    let error = null;
    let courses = [];

    function dateKey(d) {
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    // ===== 部品 =====

    const title = el("h2", { class: "wmp-cal-title" });
    const grid = el("div", { class: "wmp-cal-grid", role: "grid", "aria-labelledby": "wmp-cal-title" });
    title.id = "wmp-cal-title";
    const agenda = el("aside", { class: "wmp-cal-agenda", "aria-live": "polite" });

    root.append(
        el(
            "header",
            { class: "wmp-cal-head" },
            el("button", { type: "button", class: "wmp-icon-btn", title: WMP.t("前の月"), "aria-label": WMP.t("前の月"), onclick: () => move(-1) }, icon("chevronLeft")),
            title,
            el("button", { type: "button", class: "wmp-icon-btn", title: WMP.t("次の月"), "aria-label": WMP.t("次の月"), onclick: () => move(1) }, icon("chevronRight")),
            el("button", { type: "button", class: "wmp-btn is-small", onclick: () => goToday() }, WMP.t("今日")),
            el("span", { class: "wmp-cal-spacer" }),
            el("button", { type: "button", class: "wmp-btn is-small", onclick: () => showOriginal(true) }, WMP.t("Moodle の表示"))
        ),
        el("div", { class: "wmp-cal-layout" }, grid, agenda)
    );

    // ===== データ =====

    let requestId = 0; // 月を素早く切り替えたとき、古い月の応答で上書きしないための番号
    async function load() {
        const key = `${year}-${month}`;
        const id = ++requestId;
        title.textContent = WMP.dateTimeFormat({ year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
        error = null;
        if (cache.has(key)) {
            data = cache.get(key);
            loading = false;
            render();
            return;
        }
        loading = true;
        render();
        let result = null;
        let failure = null;
        try {
            result = await WMP.send("getCalendarMonth", { year, month: Number(key.split("-")[1]) });
            cache.set(key, result);
        } catch (e) {
            failure = e.message;
        }
        if (id !== requestId) return; // その間に別の月へ移っていた
        data = result;
        error = failure;
        loading = false;
        render();
    }

    function move(delta) {
        month += delta;
        if (month < 1) {
            month = 12;
            year--;
        } else if (month > 12) {
            month = 1;
            year++;
        }
        selectedKey = dateKey(new Date(year, month - 1, 1));
        const today = new Date();
        if (today.getFullYear() === year && today.getMonth() + 1 === month) selectedKey = dateKey(today);
        updateUrl();
        load();
    }

    function goToday() {
        const today = new Date();
        year = today.getFullYear();
        month = today.getMonth() + 1;
        selectedKey = dateKey(today);
        updateUrl();
        load();
    }

    function updateUrl() {
        const url = new URL(location.href);
        url.searchParams.set("view", "month");
        url.searchParams.set("time", String(Math.floor(new Date(year, month - 1, 1).getTime() / 1000)));
        history.replaceState(history.state, "", url);
    }

    // ===== 色・表示 =====

    function eventColor(e) {
        if (e.course && e.course.id !== "1") return WMP.courseColor(settings, e.course.id);
        if (e.eventtype === "site") return "var(--wmpn-enji, #8c1d2b)";
        if (e.eventtype === "category") return "#2f7d6d";
        return "#6b7280"; // ユーザー（自分で作った予定）など
    }

    const timeText = (e) => WMP.timeFormat.format(new Date(e.timestart * 1000));
    const eventUrl = (e) => e.url || `/calendar/view.php?view=day&time=${e.timestart}`;
    const courseLabel = (e) =>
        e.course && e.course.id !== "1" ? settings.courseNameOverrides?.[e.course.id] || e.course.fullname : e.eventtypetext;

    function classesOn(date) {
        const year = WMP.getSchoolYear(date);
        const quarter = WMP.guessQuarter(date);
        const day = WMP.DAYS[date.getDay()];
        const list = [];
        for (const c of courses) {
            if (settings.timetableHiddenCourses.includes(c.id)) continue;
            for (const slot of settings.timetable[c.id] ?? []) {
                if (slot.year === year && slot.day === day && WMP.termContains(slot.term, quarter)) list.push({ c, slot });
            }
        }
        return list.sort((a, b) => a.slot.from - b.slot.from);
    }

    // ===== 月の表 =====

    function render() {
        renderGrid();
        renderAgenda();
    }

    function renderGrid() {
        if (loading && !data) {
            grid.replaceChildren(el("div", { class: "wmp-empty" }, el("div", { class: "wmp-spinner", style: { margin: "0 auto" } })));
            return;
        }
        if (error) {
            grid.replaceChildren(
                el(
                    "div",
                    { class: "wmp-error" },
                    WMP.t("カレンダーを読み込めませんでした（{error}）。", { error }),
                    el("button", { type: "button", class: "wmp-btn is-small", onclick: () => showOriginal(true, { remember: false }) }, WMP.t("Moodle の表示で見る"))
                )
            );
            return;
        }
        const MAX = 3;
        const header = el(
            "div",
            { class: "wmp-cal-row wmp-cal-daynames", role: "row" },
            data.daynames.map((d) =>
                el("div", { class: `wmp-cal-dayname${d.dayno === 0 ? " is-sun" : d.dayno === 6 ? " is-sat" : ""}`, role: "columnheader" }, d.shortname)
            )
        );
        const rows = data.weeks.map((w) =>
            el(
                "div",
                { class: "wmp-cal-row", role: "row" },
                Array.from({ length: w.prepadding }, () => el("div", { class: "wmp-cal-cell is-pad", role: "gridcell" })),
                w.days.map((d) => {
                    const date = new Date(d.timestamp * 1000);
                    const key = dateKey(date);
                    const isSelected = key === selectedKey;
                    const hasClasses = classesOn(date).length > 0;
                    return el(
                        "div",
                        {
                            class: `wmp-cal-cell${d.istoday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${d.wday === 0 ? " is-sun" : d.wday === 6 ? " is-sat" : ""}`,
                            role: "gridcell",
                            "aria-selected": String(isSelected),
                            onclick: (e) => {
                                if (e.target.closest("a")) return;
                                selectedKey = key;
                                render();
                            },
                        },
                        el(
                            "button",
                            {
                                type: "button",
                                class: "wmp-cal-date",
                                "aria-label": WMP.dateTimeFormat({ month: "long", day: "numeric" }).format(new Date(year, month - 1, d.mday)) + (d.events.length ? WMP.t("、予定{count}件", { count: d.events.length }) : ""),
                                onclick: () => {
                                    selectedKey = key;
                                    render();
                                },
                            },
                            String(d.mday),
                            hasClasses ? el("span", { class: "wmp-cal-class-mark", title: WMP.t("授業がある日") }) : null
                        ),
                        el(
                            "ul",
                            { class: "wmp-cal-events" },
                            d.events.slice(0, MAX).map((e) =>
                                el(
                                    "li",
                                    { style: { "--wmp-course-color": eventColor(e) } },
                                    el(
                                        "a",
                                        { href: eventUrl(e), title: `${timeText(e)} ${e.name}${courseLabel(e) ? `（${courseLabel(e)}）` : ""}` },
                                        el("span", { class: "wmp-cal-event-time" }, timeText(e)),
                                        el("span", { class: "wmp-cal-event-name" }, e.name)
                                    )
                                )
                            ),
                            d.events.length > MAX ? el("li", { class: "wmp-cal-more" }, WMP.t("ほか{count}件", { count: d.events.length - MAX })) : null
                        )
                    );
                }),
                Array.from({ length: w.postpadding }, () => el("div", { class: "wmp-cal-cell is-pad", role: "gridcell" }))
            )
        );
        grid.replaceChildren(header, ...rows);
        grid.classList.toggle("is-loading", loading);
    }

    // ===== その日の予定 =====

    function renderAgenda() {
        const [y, m, d] = selectedKey.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const day = data?.weeks.flatMap((w) => w.days).find((x) => dateKey(new Date(x.timestamp * 1000)) === selectedKey);
        const events = day?.events ?? [];
        const classes = classesOn(date);

        agenda.replaceChildren(
            el(
                "h3",
                { class: "wmp-cal-agenda-date" },
                WMP.dateTimeFormat({ month: "long", day: "numeric" }).format(date),
                el("span", {}, WMP.dateTimeFormat({ weekday: "long" }).format(date))
            ),
            el("h4", { class: "wmp-cal-agenda-heading" }, WMP.t("授業")),
            classes.length
                ? el(
                      "ul",
                      { class: "wmp-cal-agenda-list" },
                      classes.map(({ c, slot }) =>
                          el(
                              "li",
                              { style: { "--wmp-course-color": WMP.courseColor(settings, c.id) } },
                              el("span", { class: "wmp-cal-agenda-time" }, slot.from === slot.to ? WMP.t("{p}限", { p: slot.from }) : WMP.t("{from}〜{to}限", { from: slot.from, to: slot.to })),
                              el(
                                  "a",
                                  { href: c.url, class: "wmp-cal-agenda-name" },
                                  el("span", { class: "wmp-mark", "aria-hidden": "true" }, WMP.courseInitial(WMP.courseName(settings, c))),
                                  WMP.courseName(settings, c)
                              ),
                              slot.classroom ? el("span", { class: "wmp-cal-agenda-sub" }, slot.classroom) : null
                          )
                      )
                  )
                : el("p", { class: "wmp-muted wmp-cal-agenda-none" }, WMP.t("時間割に登録した授業はありません")),
            el("h4", { class: "wmp-cal-agenda-heading" }, WMP.t("予定")),
            events.length
                ? el(
                      "ul",
                      { class: "wmp-cal-agenda-list" },
                      events.map((e) =>
                          el(
                              "li",
                              { style: { "--wmp-course-color": eventColor(e) }, class: e.overdue ? "is-overdue" : "" },
                              el("span", { class: "wmp-cal-agenda-time" }, timeText(e)),
                              el("a", { href: eventUrl(e), class: "wmp-cal-agenda-name" }, el("span", { class: "wmp-cal-dot", "aria-hidden": "true" }), e.name),
                              courseLabel(e) ? el("span", { class: "wmp-cal-agenda-sub" }, courseLabel(e)) : null
                          )
                      )
                  )
                : el("p", { class: "wmp-muted wmp-cal-agenda-none" }, loading ? WMP.t("読み込んでいます") : WMP.t("予定はありません")),
            el(
                "a",
                { class: "wmp-btn is-small wmp-cal-day-link", href: `/calendar/view.php?view=day&time=${Math.floor(date.getTime() / 1000)}` },
                WMP.t("Moodle でこの日を開く")
            )
        );
    }

    // ===== 開始 =====

    WMP.onSettingsChanged((next) => {
        settings = next;
        render();
    });

    if (localStorage.getItem(ORIGINAL_KEY) === "1") showOriginal(true);
    else showOriginal(false, { remember: false });
    load();
    WMP.send("getCourses")
        .then((r) => {
            courses = r.value;
            render();
        })
        .catch(() => {});
};
