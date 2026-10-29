// ダッシュボード（/my/）に時間割と課題一覧を表示する。

globalThis.WMP.initDashboard = async function initDashboard(initialSettings) {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    let settings = initialSettings;
    if (!settings.courseOverviewEnabled && !settings.timelineShowInDashboard) return;

    const anchor =
        document.querySelector(".block-starredcourses")?.closest(".block") ??
        document.querySelector("#block-region-content") ??
        document.querySelector("#region-main [role='main']") ??
        document.querySelector("#region-main");
    if (!anchor) return;

    const root = el("div", { class: "wmp-scope wmp-dash", id: "wmp-dashboard" });
    if (anchor.matches(".block")) anchor.insertAdjacentElement("beforebegin", root);
    else anchor.prepend(root);

    // 元のお気に入りコース欄は時間割と重複するので隠す
    if (settings.courseOverviewEnabled) {
        const starred = document.querySelector(".block-starredcourses")?.closest(".block");
        if (starred) starred.style.display = "none";
    }

    let courses = null;
    let coursesError = null;
    let events = [];
    let showHidden = false;
    let collecting = false;
    let collectMessage = "";

    const timetableCard = el("section", { class: "wmp-card wmp-tt-card" });
    const timelineCard = el("section", { class: "wmp-card wmp-dash-timeline" });
    if (settings.courseOverviewEnabled) root.append(timetableCard);
    if (settings.timelineShowInDashboard && settings.timelineEnabled) root.append(timelineCard);

    WMP.onSettingsChanged((next) => {
        settings = next;
        renderTimetable();
        renderTimeline();
    });

    // ===== データ取得 =====

    async function loadCourses(force = false) {
        try {
            const result = await WMP.send("getCourses", { force });
            courses = result.value;
            coursesError = result.error ?? null;
        } catch (e) {
            coursesError = e.message;
            courses = courses ?? [];
        }
        renderTimetable();
    }

    async function loadTimeline(force = false) {
        try {
            const result = await WMP.send("getTimeline", { force });
            events = result.value;
        } catch {
            events = [];
        }
        renderTimeline();
        renderTimetable();
    }

    // ===== 年度・学期 =====

    function availableYears() {
        const years = new Set([WMP.getSchoolYear()]);
        for (const c of courses ?? []) if (c.year) years.add(c.year);
        for (const slots of Object.values(settings.timetable)) for (const s of slots) years.add(s.year);
        return [...years].sort((a, b) => b - a);
    }

    function selected() {
        return settings.selectedYearTerm ?? { year: WMP.getSchoolYear(), term: WMP.guessQuarter() };
    }

    function select(patch) {
        WMP.setSettings({ selectedYearTerm: { ...selected(), ...patch } });
    }

    // ===== 時間割 =====

    function slotsFor(courseId, year, quarter) {
        return (settings.timetable[courseId] ?? []).filter((s) => s.year === year && WMP.termContains(s.term, quarter));
    }

    function pendingCount(courseId) {
        const now = Date.now();
        return events.filter((e) => String(e.course?.id) === courseId && e.actionable !== false && e.timesort * 1000 > now - WMP.DAY)
            .length;
    }

    function renderTimetable() {
        if (!settings.courseOverviewEnabled) return;
        const { year, term: quarter } = selected();

        const header = el(
            "header",
            { class: "wmp-card-header" },
            el("h2", { class: "wmp-card-title" }, "時間割"),
            el(
                "select",
                {
                    class: "wmp-select",
                    "aria-label": "年度",
                    onchange: (e) => select({ year: Number(e.target.value) }),
                },
                availableYears().map((y) => el("option", { value: y, selected: y === year }, `${y}年度`))
            ),
            el(
                "div",
                { class: "wmp-segmented", role: "tablist" },
                WMP.QUARTERS.map((q) =>
                    el(
                        "button",
                        { class: q === quarter ? "is-active" : "", onclick: () => select({ term: q }), title: WMP.TERMS[q] },
                        WMP.QUARTER_SHORT[q]
                    )
                )
            ),
            el(
                "button",
                {
                    class: "wmp-btn is-small",
                    disabled: collecting,
                    title: "受講中の科目のシラバスを検索して、曜日・時限・教室を自動で設定します",
                    onclick: () => collectSyllabus(year),
                },
                collecting ? "取得中…" : "シラバスから取得"
            ),
            el(
                "button",
                {
                    class: "wmp-icon-btn",
                    title: showHidden ? "非表示の科目を隠す" : "非表示にした科目も表示",
                    "aria-pressed": String(showHidden),
                    onclick: () => {
                        showHidden = !showHidden;
                        renderTimetable();
                    },
                },
                showHidden ? "◉" : "◎"
            ),
            el(
                "button",
                { class: "wmp-icon-btn", title: "科目一覧を再取得", onclick: () => loadCourses(true) },
                "↻"
            )
        );

        const bodyChildren = [];
        if (collectMessage) bodyChildren.push(el("div", { class: "wmp-muted wmp-tt-message" }, collectMessage));
        if (coursesError) bodyChildren.push(el("div", { class: "wmp-error" }, `科目一覧を取得できませんでした: ${coursesError}`));

        if (courses === null) {
            bodyChildren.push(el("div", { class: "wmp-empty" }, el("div", { class: "wmp-spinner", style: { margin: "0 auto" } })));
        } else {
            const visible = courses.filter((c) => showHidden || !settings.timetableHiddenCourses.includes(c.id));
            bodyChildren.push(renderGrid(visible, year, quarter));
            bodyChildren.push(renderUnscheduled(visible, year, quarter));
        }

        timetableCard.replaceChildren(header, el("div", { class: "wmp-card-body" }, bodyChildren));
    }

    function renderGrid(visibleCourses, year, quarter) {
        // 曜日 → 時限 → その時限から始まる科目
        const byDay = {};
        let maxPeriod = 5;
        const usedDays = new Set();
        for (const course of visibleCourses) {
            for (const slot of slotsFor(course.id, year, quarter)) {
                byDay[slot.day] ??= {};
                (byDay[slot.day][slot.from] ??= []).push({ course, slot });
                maxPeriod = Math.max(maxPeriod, slot.to);
                usedDays.add(slot.day);
            }
        }

        const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
        if (settings.showSaturday || usedDays.has("saturday")) days.push("saturday");
        if (settings.showSunday || usedDays.has("sunday")) days.push("sunday");

        const now = new Date();
        const today = WMP.DAYS[now.getDay()];
        const isCurrentTerm = year === WMP.getSchoolYear() && quarter === WMP.guessQuarter();
        const { current, next } = WMP.currentPeriod(now);

        const grid = el("div", {
            class: "wmp-tt-grid",
            style: { gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))`, "--wmp-days": String(days.length) },
        });

        grid.append(el("div", { class: "wmp-tt-corner" }));
        days.forEach((day, i) =>
            grid.append(
                el(
                    "div",
                    {
                        class: `wmp-tt-day${isCurrentTerm && day === today ? " is-today" : ""}`,
                        style: { gridColumn: String(i + 2), gridRow: "1" },
                    },
                    WMP.DAY_LABELS[day]
                )
            )
        );

        for (let p = 1; p <= maxPeriod; p++) {
            const times = WMP.PERIODS[p];
            grid.append(
                el(
                    "div",
                    {
                        class: `wmp-tt-period${isCurrentTerm && (current === p || (!current && next === p)) ? " is-now" : ""}`,
                        style: { gridColumn: "1", gridRow: String(p + 1) },
                    },
                    el("strong", {}, String(p)),
                    settings.showPeriodTimes && times
                        ? el("small", {}, WMP.formatHM(times[0]), el("br"), WMP.formatHM(times[1]))
                        : null
                )
            );
        }

        days.forEach((day, col) => {
            let p = 1;
            while (p <= maxPeriod) {
                const starting = byDay[day]?.[p] ?? [];
                const span = starting.length > 0 ? Math.max(...starting.map(({ slot }) => slot.to - slot.from + 1)) : 1;
                const isNow = isCurrentTerm && day === today && current !== undefined && current >= p && current < p + span;
                grid.append(
                    el(
                        "div",
                        {
                            class: `wmp-tt-cell${isNow ? " is-now" : ""}${isCurrentTerm && day === today ? " is-today" : ""}`,
                            style: { gridColumn: String(col + 2), gridRow: `${p + 1} / span ${span}` },
                        },
                        starting.map(({ course, slot }) => renderCourseBlock(course, slot))
                    )
                );
                p += span;
            }
        });

        return grid;
    }

    function renderCourseBlock(course, slot) {
        const color = WMP.courseColor(settings, course.id);
        const count = settings.showAssignmentCountOnTimetable ? pendingCount(course.id) : 0;
        const hidden = settings.timetableHiddenCourses.includes(course.id);
        const note = settings.courseNotes[course.id];
        const method = settings.courseDeliveryMethods[course.id];
        return el(
            "div",
            {
                class: `wmp-tt-course${hidden ? " is-hidden" : ""}`,
                style: { "--wmp-course-color": color },
            },
            el(
                "a",
                { class: "wmp-tt-course-link", href: course.url, title: `${WMP.courseName(settings, course)}${note ? `\n\nメモ: ${note}` : ""}` },
                el("span", { class: "wmp-tt-course-name" }, WMP.courseName(settings, course)),
                settings.showClassroom && slot.classroom ? el("span", { class: "wmp-tt-room" }, slot.classroom) : null,
                method === "on_demand" ? el("span", { class: "wmp-tt-tag" }, "オンデマンド") : null,
                method === "realtime_streaming" ? el("span", { class: "wmp-tt-tag" }, "リアルタイム配信") : null
            ),
            count > 0 ? el("span", { class: "wmp-tt-badge", title: `未提出の課題など ${count}件` }, String(count)) : null,
            note ? el("span", { class: "wmp-tt-note", title: note }, "✎") : null,
            el(
                "button",
                {
                    class: "wmp-icon-btn wmp-tt-edit",
                    title: "科目の設定",
                    "aria-label": "科目の設定",
                    onclick: (e) => {
                        e.preventDefault();
                        openCourseDialog(course);
                    },
                },
                "⋯"
            )
        );
    }

    function renderUnscheduled(visibleCourses, year, quarter) {
        const list = visibleCourses.filter((c) => {
            const yearSlots = (settings.timetable[c.id] ?? []).filter((s) => s.year === year);
            if (yearSlots.length > 0) return false; // 別のクォーターに入っている
            return c.year === year;
        });
        if (list.length === 0) return el("div");
        return el(
            "div",
            { class: "wmp-tt-unscheduled" },
            el("h3", {}, `曜日・時限が未設定の科目（${list.length}）`),
            el(
                "p",
                { class: "wmp-muted" },
                "オンデマンド科目などです。「シラバスから取得」を押すか、⋯ から曜日・時限を設定すると時間割に表示されます。"
            ),
            el(
                "div",
                { class: "wmp-tt-chips" },
                list.map((c) =>
                    el(
                        "div",
                        { class: "wmp-tt-chip", style: { "--wmp-course-color": WMP.courseColor(settings, c.id) } },
                        el("a", { href: c.url }, WMP.courseName(settings, c)),
                        pendingCount(c.id) > 0 ? el("span", { class: "wmp-tt-badge" }, String(pendingCount(c.id))) : null,
                        el("button", { class: "wmp-icon-btn", title: "科目の設定", onclick: () => openCourseDialog(c) }, "⋯")
                    )
                )
            )
        );
    }

    async function collectSyllabus(year) {
        collecting = true;
        collectMessage = "シラバスを検索しています…";
        renderTimetable();
        try {
            await WMP.send("collectSyllabus", { year });
            for (;;) {
                await new Promise((r) => setTimeout(r, 1000));
                const progress = await WMP.send("getCollectProgress");
                collectMessage = progress.message;
                renderTimetable();
                if (!progress.running) break;
            }
        } catch (e) {
            collectMessage = `エラー: ${e.message}`;
        } finally {
            collecting = false;
            renderTimetable();
        }
    }

    // ===== 科目の設定ダイアログ =====

    function openCourseDialog(course) {
        const draft = {
            name: settings.courseNameOverrides[course.id] ?? "",
            color: settings.courseColors[course.id] ?? "",
            slots: structuredClone(settings.timetable[course.id] ?? []),
            note: settings.courseNotes[course.id] ?? "",
            hidden: settings.timetableHiddenCourses.includes(course.id),
            delivery: settings.courseDeliveryMethods[course.id] ?? "",
            filename: settings.assignmentFilenameTemplateCourse[course.id] ?? "",
        };
        const { year, term } = selected();

        const slotList = el("div", { class: "wmp-slot-list" });
        const renderSlots = () => {
            slotList.replaceChildren(
                ...draft.slots.map((slot, i) =>
                    el(
                        "div",
                        { class: "wmp-slot-row" },
                        el("input", {
                            class: "wmp-input",
                            type: "number",
                            value: slot.year,
                            style: { width: "76px" },
                            "aria-label": "年度",
                            oninput: (e) => (slot.year = Number(e.target.value)),
                        }),
                        selectEl(Object.entries(WMP.TERMS), slot.term, (v) => (slot.term = v), "学期"),
                        selectEl(
                            ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, WMP.DAY_LABELS[d]]),
                            slot.day,
                            (v) => (slot.day = v),
                            "曜日"
                        ),
                        selectEl([1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n}限`]), slot.from, (v) => (slot.from = Number(v)), "開始時限"),
                        el("span", { class: "wmp-muted" }, "〜"),
                        selectEl([1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n}限`]), slot.to, (v) => (slot.to = Number(v)), "終了時限"),
                        el("input", {
                            class: "wmp-input",
                            placeholder: "教室",
                            value: slot.classroom ?? "",
                            style: { width: "96px" },
                            oninput: (e) => (slot.classroom = e.target.value),
                        }),
                        el(
                            "button",
                            {
                                class: "wmp-icon-btn",
                                title: "削除",
                                onclick: () => {
                                    draft.slots.splice(i, 1);
                                    renderSlots();
                                },
                            },
                            "×"
                        )
                    )
                ),
                el(
                    "button",
                    {
                        class: "wmp-btn is-small",
                        onclick: () => {
                            draft.slots.push({ year, term, day: "monday", from: 1, to: 1, classroom: "" });
                            renderSlots();
                        },
                    },
                    "＋ 曜日・時限を追加"
                )
            );
        };
        renderSlots();

        const swatches = el("div", { class: "wmp-swatches" });
        const renderSwatches = () =>
            swatches.replaceChildren(
                ...WMP.PALETTE.map((c) =>
                    el("button", {
                        class: `wmp-swatch${draft.color === c ? " is-active" : ""}`,
                        style: { background: c },
                        title: c,
                        onclick: () => {
                            draft.color = c;
                            renderSwatches();
                        },
                    })
                ),
                el("input", {
                    type: "color",
                    value: draft.color || WMP.courseColor(settings, course.id),
                    title: "好きな色を選ぶ",
                    oninput: (e) => {
                        draft.color = e.target.value;
                    },
                }),
                el(
                    "button",
                    {
                        class: "wmp-btn is-small",
                        onclick: () => {
                            draft.color = "";
                            renderSwatches();
                        },
                    },
                    "自動"
                )
            );
        renderSwatches();

        const syllabusKey = settings.courseSyllabusKeys[course.id];

        const dialog = el(
            "dialog",
            { class: "wmp-dialog wmp-scope" },
            el(
                "div",
                { class: "wmp-dialog-header" },
                el("h2", {}, course.name),
                el("button", { class: "wmp-icon-btn", "aria-label": "閉じる", onclick: () => dialog.close() }, "×")
            ),
            el(
                "div",
                { class: "wmp-dialog-body" },
                el(
                    "label",
                    { class: "wmp-field" },
                    el("span", {}, "表示名"),
                    el("input", { class: "wmp-input", placeholder: course.name, value: draft.name, oninput: (e) => (draft.name = e.target.value) })
                ),
                el("div", { class: "wmp-field" }, el("span", {}, "色"), swatches),
                el("div", { class: "wmp-field" }, el("span", {}, "曜日・時限・教室"), slotList),
                el(
                    "label",
                    { class: "wmp-field" },
                    el("span", {}, "授業の形式"),
                    selectEl(
                        [
                            ["", "未設定"],
                            ["face_to_face", "対面"],
                            ["realtime_streaming", "リアルタイム配信"],
                            ["on_demand", "オンデマンド"],
                        ],
                        draft.delivery,
                        (v) => (draft.delivery = v),
                        "授業の形式"
                    )
                ),
                el(
                    "label",
                    { class: "wmp-field" },
                    el("span", {}, "メモ"),
                    el("textarea", { class: "wmp-textarea", value: draft.note, oninput: (e) => (draft.note = e.target.value) })
                ),
                settings.assignmentFilenameEnabled
                    ? el(
                          "label",
                          { class: "wmp-field" },
                          el("span", {}, "課題ファイル名の形式（この科目だけ）"),
                          el("input", {
                              class: "wmp-input",
                              placeholder: settings.assignmentFilenameTemplate,
                              value: draft.filename,
                              oninput: (e) => (draft.filename = e.target.value),
                          })
                      )
                    : null,
                el(
                    "label",
                    { class: "wmp-check" },
                    el("input", { type: "checkbox", checked: draft.hidden, onchange: (e) => (draft.hidden = e.target.checked) }),
                    " 時間割に表示しない"
                ),
                el(
                    "div",
                    { class: "wmp-muted" },
                    course.url ? el("a", { href: course.url }, "Moodle のコースページ") : null,
                    syllabusKey ? " · " : null,
                    syllabusKey
                        ? el("a", { href: `https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${syllabusKey}`, target: "_blank" }, "シラバス")
                        : null
                )
            ),
            el(
                "div",
                { class: "wmp-dialog-footer" },
                el("button", { class: "wmp-btn", onclick: () => dialog.close() }, "キャンセル"),
                el(
                    "button",
                    {
                        class: "wmp-btn is-primary",
                        onclick: async () => {
                            await saveCourse(course.id, draft);
                            dialog.close();
                        },
                    },
                    "保存"
                )
            )
        );
        dialog.addEventListener("close", () => dialog.remove());
        root.append(dialog);
        dialog.showModal();
    }

    function selectEl(options, value, onChange, label) {
        return el(
            "select",
            { class: "wmp-select", "aria-label": label, onchange: (e) => onChange(e.target.value) },
            options.map(([v, text]) => el("option", { value: v, selected: String(v) === String(value) }, text))
        );
    }

    async function saveCourse(id, draft) {
        const s = await WMP.getSettings();
        const setOrDelete = (obj, value) => {
            const copy = { ...obj };
            if (value) copy[id] = value;
            else delete copy[id];
            return copy;
        };
        const slots = draft.slots
            .filter((x) => x.year && x.term && x.day && x.from)
            .map((x) => ({ ...x, to: Math.max(x.to, x.from) }));
        await WMP.setSettings({
            courseNameOverrides: setOrDelete(s.courseNameOverrides, draft.name.trim()),
            courseColors: setOrDelete(s.courseColors, draft.color),
            courseNotes: setOrDelete(s.courseNotes, draft.note.trim()),
            courseDeliveryMethods: setOrDelete(s.courseDeliveryMethods, draft.delivery),
            assignmentFilenameTemplateCourse: setOrDelete(s.assignmentFilenameTemplateCourse, draft.filename.trim()),
            timetable: setOrDelete(s.timetable, slots.length > 0 ? slots : null),
            timetableHiddenCourses: draft.hidden
                ? [...new Set([...s.timetableHiddenCourses, id])]
                : s.timetableHiddenCourses.filter((x) => x !== id),
        });
    }

    // ===== 課題一覧 =====

    let showAllEvents = false;
    function renderTimeline() {
        if (!settings.timelineShowInDashboard || !settings.timelineEnabled) return;
        const LIMIT = 8;
        timelineCard.replaceChildren(
            el(
                "header",
                { class: "wmp-card-header" },
                el("h2", { class: "wmp-card-title" }, "締切が近い課題"),
                el("button", { class: "wmp-icon-btn", title: "更新", onclick: () => loadTimeline(true) }, "↻")
            ),
            el(
                "div",
                { class: "wmp-card-body" },
                WMP.renderTimeline(events, settings, { onHide: (e) => WMP.hideEvent(e), limit: showAllEvents ? undefined : LIMIT }),
                events.length > LIMIT
                    ? el(
                          "button",
                          {
                              class: "wmp-btn is-small wmp-dash-more",
                              onclick: () => {
                                  showAllEvents = !showAllEvents;
                                  renderTimeline();
                              },
                          },
                          showAllEvents ? "少なく表示" : `すべて表示（${events.length}件）`
                      )
                    : null
            )
        );
    }

    renderTimetable();
    renderTimeline();
    loadCourses();
    loadTimeline();

    // 「今」の表示を1分ごとに更新
    setInterval(renderTimetable, 60 * 1000);
};
