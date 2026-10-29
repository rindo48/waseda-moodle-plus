// シラバスの詳細ページに「時間割に追加」ボタンを付ける。

(async () => {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    const settings = await WMP.getSettings();
    if (!settings.courseOverviewEnabled) return;

    const table = document.getElementsByClassName("ct-common")[0];
    const container = document.getElementById("cHonbun") ?? table?.parentElement;
    if (!table || !container) return;

    const info = {};
    for (const th of table.getElementsByTagName("th")) {
        const td = th.nextElementSibling;
        if (td?.nodeName === "TD") info[th.textContent.trim()] = td.textContent.trim();
    }
    const parsed = WMP.syllabusInfoToTimetable(info);
    const key = new URLSearchParams(location.search).get("pKey");

    const box = el("div", { class: "wmp-scope wmp-syllabus-box" });
    container.prepend(box);

    if (parsed.slots.length === 0) {
        box.append(el("span", { class: "wmp-muted" }, "Waseda Moodle Plus: この科目には曜日・時限がないため、時間割には「未設定の科目」として表示されます。"));
        return;
    }

    let courses;
    try {
        courses = (await WMP.send("getCourses")).value;
    } catch {
        box.append(el("span", { class: "wmp-muted" }, "Waseda Moodle Plus: Moodle にログインすると、この科目を時間割に追加できます。"));
        return;
    }

    const normalize = (s) => (s ?? "").replace(/\s+/g, "");
    const matched = courses.filter((c) => normalize(c.name) === normalize(parsed.title));
    const candidates = matched.length > 0 ? matched : courses.filter((c) => !parsed.year || c.year === parsed.year);

    const select = el(
        "select",
        { class: "wmp-select", "aria-label": "追加先の Moodle の科目" },
        candidates.map((c) => el("option", { value: c.id }, c.name))
    );
    const status = el("span", { class: "wmp-muted" });
    const slotText = parsed.slots
        .map((s) => `${WMP.DAY_LABELS[s.day]}${s.from}${s.to !== s.from ? `-${s.to}` : ""}限${s.classroom ? `（${s.classroom}）` : ""}`)
        .join("、");

    box.append(
        el("span", {}, `${WMP.TERMS[parsed.term] ?? ""} ${slotText}`),
        candidates.length > 1 || matched.length === 0 ? select : null,
        el(
            "button",
            {
                class: "wmp-btn is-primary is-small",
                disabled: candidates.length === 0,
                onclick: async () => {
                    const courseId = matched.length === 1 ? matched[0].id : select.value;
                    if (!courseId) return;
                    const latest = await WMP.getSettings();
                    await WMP.setSettings({
                        timetable: { ...latest.timetable, [courseId]: parsed.slots },
                        courseSyllabusKeys: key ? { ...latest.courseSyllabusKeys, [courseId]: key } : latest.courseSyllabusKeys,
                        courseDeliveryMethods: parsed.deliveryMethod
                            ? { ...latest.courseDeliveryMethods, [courseId]: parsed.deliveryMethod }
                            : latest.courseDeliveryMethods,
                    });
                    status.textContent = "時間割に追加しました";
                },
            },
            "時間割に追加"
        ),
        status
    );
})();
