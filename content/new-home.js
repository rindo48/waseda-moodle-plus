// 新デザイン: ダッシュボード（/my/）の一番上に「今日」をまとめる。
// - 今日の授業は、1限から最後の時限までを横一列に並べた帯で見せる（今の時限に印、終わった時限は薄く）
// - 締切は「超過・今日・明日…」の7日間を列にして、件数を科目の色の棒で見せる。列を押すとその日の一覧を出す
// 科目へのショートカットはレール（content/new-shell.js）に、検索は Ctrl+K にまとめたのでここには置かない。

globalThis.WMP.initNewHome = async function initNewHome(initialSettings) {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;

    let settings = initialSettings;

    // initDashboard が置いた時間割・課題一覧の前に入れる（無ければ同じ場所を探す）
    const dashboard = document.getElementById("wmp-dashboard");
    const anchor =
        dashboard ??
        document.querySelector(".block-starredcourses")?.closest(".block") ??
        document.querySelector("#block-region-content") ??
        document.querySelector("#region-main [role='main']") ??
        document.querySelector("#region-main");
    if (!anchor) return;

    const root = el("div", { class: "wmp-scope wmp-home", id: "wmp-home" });
    if (anchor === dashboard || anchor.matches(".block")) anchor.insertAdjacentElement("beforebegin", root);
    else anchor.prepend(root);

    setupOriginalBlocks();

    let courses = null;
    let events = [];
    let openColumn = null; // 締切の列で開いているもの（"overdue" か日付のキー）

    const dayTrack = el("section", { class: "wmp-home-day", "aria-label": "今日の授業" });
    const week = el("section", { class: "wmp-home-week", "aria-label": "これから7日間の締切" });
    root.append(dayTrack, week);

    WMP.onSettingsChanged((next) => {
        settings = next;
        render();
    });

    async function load() {
        const [c, t] = await Promise.allSettled([WMP.send("getCourses"), WMP.send("getTimeline")]);
        courses = c.status === "fulfilled" ? c.value.value : [];
        events = t.status === "fulfilled" ? t.value.value : [];
        render();
    }

    // ===== 今日の授業 =====

    function todayClasses(now) {
        const day = WMP.DAYS[now.getDay()];
        const year = WMP.getSchoolYear(now);
        const quarter = WMP.guessQuarter(now);
        const list = [];
        for (const course of courses ?? []) {
            if (settings.timetableHiddenCourses.includes(course.id)) continue;
            for (const slot of settings.timetable[course.id] ?? []) {
                if (slot.year === year && WMP.termContains(slot.term, quarter) && slot.day === day) list.push({ course, slot });
            }
        }
        return list.sort((a, b) => a.slot.from - b.slot.from);
    }

    function statusText(now, classes) {
        if (classes.length === 0) return "今日は時間割に登録した授業がありません";
        const { current, next } = WMP.currentPeriod(now);
        const name = (x) => WMP.courseName(settings, x.course);
        const ongoing = current && classes.find(({ slot }) => slot.from <= current && current <= slot.to);
        if (ongoing) return `いまは${current}限、${name(ongoing)}（${ongoing.slot.classroom || "教室未設定"}）`;
        const from = current ? current + 1 : next;
        const upcoming = from && classes.find(({ slot }) => slot.from >= from);
        if (upcoming) {
            const p = upcoming.slot.from;
            return `次は${p}限 ${WMP.formatHM(WMP.PERIODS[p][0])}から、${name(upcoming)}（${upcoming.slot.classroom || "教室未設定"}）`;
        }
        return "今日の授業はすべて終わりました";
    }

    function renderDay() {
        const now = new Date();
        const classes = todayClasses(now);
        const { current, next } = WMP.currentPeriod(now);
        // これより前に終わった時限は「終わった」扱い（休み時間は次の時限の手前、放課後はすべて）
        const reference = current ?? (next !== undefined ? next - 0.5 : Infinity);
        const lastPeriod = Math.max(Number(settings.timetableMaxPeriod) || 6, ...classes.map((c) => c.slot.to));

        const head = el(
            "header",
            { class: "wmp-home-day-head" },
            el(
                "h2",
                { class: "wmp-home-day-date" },
                new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(now),
                el("span", { class: "wmp-home-day-weekday" }, new Intl.DateTimeFormat("ja-JP", { weekday: "long" }).format(now))
            ),
            el("p", { class: "wmp-home-day-status" }, courses === null ? "読み込んでいます" : statusText(now, classes))
        );

        // 時限ごとの列。複数の時限にまたがる授業は列をつなげる
        const track = el("ol", { class: "wmp-home-track", style: { "--wmp-periods": String(lastPeriod) } });
        for (let p = 1; p <= lastPeriod; p++) {
            const times = WMP.PERIODS[p];
            const state = current === p ? " is-now" : p < reference ? " is-past" : "";
            // 1段目は時限の見出し、2段目は授業を置く枠（授業が無い時限は空の枠になる）
            track.append(
                el(
                    "li",
                    { class: `wmp-home-period${state}`, style: { gridColumn: String(p) }, "aria-hidden": "true" },
                    el("span", { class: "wmp-home-period-no" }, `${p}限`),
                    times ? el("span", { class: "wmp-home-period-time" }, `${WMP.formatHM(times[0])}〜${WMP.formatHM(times[1])}`) : null
                ),
                el("li", { class: `wmp-home-slot${state}`, style: { gridColumn: String(p) }, "aria-hidden": "true" })
            );
        }
        for (const { course, slot } of classes) {
            const isNow = current !== undefined && slot.from <= current && current <= slot.to;
            const isPast = !isNow && slot.to < reference;
            track.append(
                el(
                    "li",
                    {
                        class: `wmp-home-class${isNow ? " is-now" : ""}${isPast ? " is-past" : ""}`,
                        style: { gridColumn: `${slot.from} / ${slot.to + 1}`, "--wmp-course-color": WMP.courseColor(settings, course.id) },
                    },
                    el(
                        "a",
                        { href: course.url, title: WMP.courseName(settings, course) },
                        // 画面が狭いと時限の列を出さないので、そのときだけ見せる時限
                        el(
                            "span",
                            { class: "wmp-home-class-period" },
                            `${slot.from === slot.to ? `${slot.from}限` : `${slot.from}〜${slot.to}限`} ${WMP.formatHM(WMP.PERIODS[slot.from][0])}〜${WMP.formatHM(WMP.PERIODS[slot.to][1])}`
                        ),
                        el("span", { class: "wmp-home-class-name" }, WMP.courseName(settings, course)),
                        el("span", { class: "wmp-home-class-room" }, slot.classroom || "")
                    )
                )
            );
        }

        dayTrack.replaceChildren(head, track);
    }

    // ===== 締切の7日間 =====

    function columns(now) {
        const list = WMP.visibleEvents(events, settings).filter((e) => e.actionable !== false);
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const cols = [];
        const overdue = list.filter((e) => e.timesort * 1000 < now.getTime() && e.timesort * 1000 > now.getTime() - 7 * WMP.DAY);
        if (overdue.length > 0) cols.push({ key: "overdue", label: "超過", sub: "", items: overdue, overdue: true });
        for (let i = 0; i < 7; i++) {
            const from = start + i * WMP.DAY;
            const to = from + WMP.DAY;
            const date = new Date(from);
            cols.push({
                key: String(from),
                label: i === 0 ? "今日" : i === 1 ? "明日" : `${date.getMonth() + 1}/${date.getDate()}`,
                sub: new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date),
                items: list.filter((e) => {
                    const t = e.timesort * 1000;
                    return t >= Math.max(from, now.getTime()) && t < to;
                }),
                weekend: date.getDay() === 0 || date.getDay() === 6,
                today: i === 0,
            });
        }
        return cols;
    }

    function renderWeek() {
        const now = new Date();
        const cols = columns(now);
        const total = cols.filter((c) => !c.overdue).reduce((n, c) => n + c.items.length, 0);
        if (openColumn && !cols.some((c) => c.key === openColumn && c.items.length > 0)) openColumn = null;
        const MAX_ITEMS = 4;

        const strip = el(
            "div",
            { class: "wmp-home-week-strip", role: "list" },
            cols.map((col) =>
                el(
                    "button",
                    {
                        type: "button",
                        role: "listitem",
                        class: `wmp-home-week-col${col.overdue ? " is-overdue" : ""}${col.today ? " is-today" : ""}${col.weekend ? " is-weekend" : ""}${openColumn === col.key ? " is-open" : ""}`,
                        disabled: col.items.length === 0,
                        "aria-expanded": col.items.length ? String(openColumn === col.key) : null,
                        title: col.items.length ? `${col.label}の締切 ${col.items.length}件を表示` : `${col.label}の締切はありません`,
                        onclick: () => {
                            openColumn = openColumn === col.key ? null : col.key;
                            renderWeek();
                        },
                    },
                    el("span", { class: "wmp-home-week-label" }, col.label, col.sub ? el("small", {}, col.sub) : null),
                    el(
                        "span",
                        { class: "wmp-home-week-items" },
                        [...col.items]
                            .sort((a, b) => a.timesort - b.timesort)
                            .slice(0, MAX_ITEMS)
                            .map((e) =>
                                el(
                                    "span",
                                    { class: "wmp-home-week-item", style: { "--wmp-course-color": e.course ? WMP.courseColor(settings, String(e.course.id)) : "#7d8b99" } },
                                    el("span", { class: "wmp-home-week-time" }, WMP.timeFormat.format(new Date(e.timesort * 1000))),
                                    el("span", { class: "wmp-home-week-name" }, e.activityname ?? e.name)
                                )
                            ),
                        col.items.length > MAX_ITEMS ? el("span", { class: "wmp-home-week-more" }, `ほか${col.items.length - MAX_ITEMS}件`) : null
                    ),
                    el("span", { class: "wmp-home-week-count" }, col.items.length ? `${col.items.length}件` : "なし")
                )
            )
        );

        const open = cols.find((c) => c.key === openColumn);
        week.replaceChildren(
            el(
                "header",
                { class: "wmp-home-week-head" },
                el("h2", {}, "締切"),
                el("span", { class: "wmp-home-week-total" }, courses === null ? "" : total ? `これから7日間で${total}件` : "これから7日間はありません"),
                el(
                    "button",
                    {
                        type: "button",
                        class: "wmp-btn is-small",
                        onclick: () => document.querySelector(".wmp-dash-timeline")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    },
                    "すべての締切"
                )
            ),
            strip,
            // replaceChildren は null を「null」という文字にしてしまうので、無いときは何も渡さない
            ...(open ? [el("div", { class: "wmp-home-week-detail" }, WMP.renderTimeline(open.items, settings, { onHide: (e) => WMP.hideEvent(e) }))] : [])
        );
    }

    function render() {
        renderDay();
        renderWeek();
    }

    // ===== Moodle の元のブロック =====

    /** 元のブロック（タイムライン・カレンダーなど）は畳んで、ボタンで出せるようにする */
    function setupOriginalBlocks() {
        const region = document.getElementById("block-region-content");
        if (!region) return;
        const KEY = "wmpShowOriginalBlocks";
        const button = el("button", {
            type: "button",
            class: "wmp-btn wmp-home-original-toggle",
            onclick: () => {
                const show = document.body.classList.contains("wmp-hide-original");
                localStorage.setItem(KEY, show ? "1" : "");
                apply(show);
            },
        });
        const apply = (show) => {
            document.body.classList.toggle("wmp-hide-original", !show);
            button.replaceChildren(icon(show ? "eyeOff" : "eye", { size: 16 }), show ? "Moodle の元のブロックを隠す" : "Moodle の元のブロックを表示");
            button.setAttribute("aria-expanded", String(show));
        };
        region.append(el("div", { class: "wmp-scope wmp-home-original" }, button));
        apply(localStorage.getItem(KEY) === "1");
    }

    render();
    load();

    // 時限が変わったら表示を更新する
    const nowKey = () => {
        const now = new Date();
        const { current, next } = WMP.currentPeriod(now);
        return `${now.toDateString()} ${current} ${next}`;
    };
    let lastNowKey = nowKey();
    setInterval(() => {
        const key = nowKey();
        if (key === lastNowKey) return;
        lastNowKey = key;
        render();
    }, 60 * 1000);
};
