// 新デザイン: 画面の「骨組み」を作り替える（すべての Moodle のページで動く）。
//
// Moodle は上のヘッダーに横並びのタブ（ホーム・ダッシュボード・マイコース…）を置いているが、
// 学生が実際に行き来するのはタブよりも「今学期の科目」と「締切」なので、
// - タブは左の縦の帯（レール）に移し、その下に今学期の科目を時間割の順に並べる
// - 締切はレールのボタンからどのページでも横に引き出せるようにする
// - ヘッダーの真ん中には、科目・締切・ページをまとめて探せる検索（Ctrl+K）を置く
// レールは画面の幅が広いとき（992px 以上。Moodle がドロワーを横に出す幅）だけ出し、狭いときは Moodle の表示に任せる。

globalThis.WMP.initNewShell = function initNewShell(initialSettings) {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;
    let settings = initialSettings;

    const root = document.documentElement;
    // メニューを出せないページでは、new-design-flag.js が先に空けておいた幅を戻す
    const bail = () => root.classList.remove("wmp-has-rail");

    const SKIP_LAYOUTS = ["pagelayout-secure", "pagelayout-embedded", "pagelayout-popup", "pagelayout-login", "pagelayout-redirect", "pagelayout-maintenance"];
    if (SKIP_LAYOUTS.some((c) => document.body.classList.contains(c))) return bail();
    const navbar = document.querySelector("nav.navbar.fixed-top, .navbar.fixed-top");
    if (!navbar) return bail();

    // 固定ヘッダーの高さ（大学のテーマで変わることがあるので測る）
    const measure = () => root.style.setProperty("--wmpn-nav-h", `${navbar.offsetHeight || 60}px`);
    measure();
    // 本文が #page の中でスクロールするか（標準の Moodle）、ページ全体がスクロールするか（早稲田など）。
    // 後者では、追従する部品（カレンダーの右側など）を固定ヘッダーの下で止める必要がある
    const page = document.getElementById("page");
    const innerScroll = () => {
        const oy = page ? getComputedStyle(page).overflowY : "visible";
        root.classList.toggle("wmp-inner-scroll", oy === "auto" || oy === "scroll");
    };
    innerScroll();
    window.addEventListener("resize", innerScroll);
    new ResizeObserver(measure).observe(navbar);

    // ===== Moodle のタブを読み取る =====

    function navIconFor(url) {
        const path = url.pathname;
        if (path === "/" || path === "/index.php") return "home";
        if (path === "/my/" || path === "/my/index.php") return "dashboard";
        if (path.startsWith("/my/courses.php")) return "courses";
        if (path.startsWith("/calendar/")) return "calendar";
        if (path.startsWith("/grade/")) return "grades";
        if (path.startsWith("/user/")) return "user";
        if (path.startsWith("/message/")) return "mail";
        return "page";
    }

    /** ヘッダーのタブ（「さらに」の中に隠れたものも含む） */
    function readPrimaryNav() {
        const seen = new Set();
        const items = [];
        for (const a of document.querySelectorAll(".primary-navigation a[href]")) {
            const href = a.getAttribute("href");
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
            let url;
            try {
                url = new URL(a.href, location.href);
            } catch {
                continue;
            }
            if (url.origin !== location.origin || seen.has(url.href)) continue;
            const label = a.textContent.replace(/\s+/g, " ").trim();
            if (!label) continue;
            seen.add(url.href);
            items.push({
                label,
                href: url.href,
                icon: navIconFor(url),
                moodleActive: a.classList.contains("active") || a.getAttribute("aria-current") === "true",
            });
        }
        // 「選択中」は今のページの URL で決める。Moodle の印は、カレンダーなどタブに無いページで
        // 「ホーム」に付いていることがあるため、URL で決まらないときだけ使う（ホームはトップページでしか選ばない）
        const here = location.pathname.replace(/\/index\.php$/, "/");
        const pathOf = (href) => new URL(href).pathname.replace(/\/index\.php$/, "/");
        const exact = items.filter((i) => pathOf(i.href) === here);
        for (const i of items) {
            i.active = exact.length > 0 ? exact.includes(i) : i.moodleActive && pathOf(i.href) !== "/";
            delete i.moodleActive;
        }
        return items;
    }

    const navItems = readPrimaryNav();
    if (navItems.length === 0) return bail();

    // ===== データ =====

    let courses = null;
    let events = [];

    async function load() {
        const [c, t] = await Promise.allSettled([WMP.send("getCourses"), WMP.send("getTimeline")]);
        courses = c.status === "fulfilled" ? c.value.value : [];
        events = t.status === "fulfilled" ? t.value.value : [];
        renderCourses();
        renderDeadlineCount();
        if (!panel.hidden) renderPanel();
    }

    const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "on_demand"];

    /** 今学期の時間割にある科目を、曜日・時限の順に並べる。時間割が空なら今年度の科目 */
    function termCourses() {
        const year = WMP.getSchoolYear();
        const quarter = WMP.guessQuarter();
        const list = [];
        for (const c of courses ?? []) {
            if (settings.timetableHiddenCourses.includes(c.id)) continue;
            const slots = (settings.timetable[c.id] ?? []).filter((s) => s.year === year && WMP.termContains(s.term, quarter));
            if (slots.length === 0) continue;
            const first = slots
                .map((s) => DAY_ORDER.indexOf(s.day) * 10 + (s.from ?? 9))
                .sort((a, b) => a - b)[0];
            list.push({ course: c, order: first });
        }
        if (list.length > 0) return list.sort((a, b) => a.order - b.order).map((x) => x.course);
        return (courses ?? []).filter((c) => c.year === year && !c.hidden).sort((a, b) => WMP.courseName(settings, a).localeCompare(WMP.courseName(settings, b), "ja"));
    }

    function pendingEvents() {
        const now = Date.now();
        return WMP.visibleEvents(events, settings).filter((e) => e.actionable !== false && e.timesort * 1000 > now - WMP.DAY);
    }

    const currentCourseId = document.body.className.match(/\bcourse-(\d+)\b/)?.[1];

    // ===== レール =====

    function railItem({ label, href, icon: iconName, active, onclick, extra }) {
        const children = [icon(iconName, { size: 20 }), el("span", { class: "wmp-rail-label" }, label), extra ?? null];
        const attrs = { class: `wmp-rail-item${active ? " is-active" : ""}`, title: label, "aria-current": active ? "page" : null };
        return href ? el("a", { ...attrs, href }, children) : el("button", { ...attrs, type: "button", onclick }, children);
    }

    const deadlineCount = el("span", { class: "wmp-rail-count", hidden: true });
    const deadlineButton = railItem({
        label: "締切",
        icon: "deadline",
        onclick: () => togglePanel(),
        extra: deadlineCount,
    });
    deadlineButton.setAttribute("aria-expanded", "false");
    deadlineButton.setAttribute("aria-controls", "wmp-rail-panel");

    const courseList = el("ul", { class: "wmp-rail-courses" });
    const courseHeading = el("div", { class: "wmp-rail-heading" }, "今学期の科目");

    const collapseButton = el("button", {
        type: "button",
        class: "wmp-rail-item wmp-rail-collapse",
        onclick: () => setCollapsed(!root.classList.contains("wmp-rail-collapsed")),
    });

    const rail = el(
        "aside",
        { class: "wmp-scope wmp-rail", id: "wmp-rail", "aria-label": "メニュー" },
        el("nav", { class: "wmp-rail-nav", "aria-label": "ページ" }, navItems.map((item) => railItem(item)), deadlineButton),
        el("div", { class: "wmp-rail-section" }, courseHeading, courseList),
        el(
            "div",
            { class: "wmp-rail-foot" },
            railItem({ label: "拡張機能の設定", icon: "settings", onclick: () => WMP.send("openOptions").catch(() => {}) }),
            collapseButton
        )
    );

    function setCollapsed(collapsed) {
        root.classList.toggle("wmp-rail-collapsed", collapsed);
        localStorage.setItem("wmpRailCollapsed", collapsed ? "1" : "");
        collapseButton.replaceChildren(
            icon(collapsed ? "expand" : "collapse", { size: 20 }),
            el("span", { class: "wmp-rail-label" }, collapsed ? "広げる" : "たたむ")
        );
        collapseButton.title = collapsed ? "メニューを広げる" : "メニューをたたむ";
        collapseButton.setAttribute("aria-expanded", String(!collapsed));
    }

    function renderCourses() {
        if (courses === null) {
            courseList.replaceChildren(el("li", { class: "wmp-rail-loading" }, el("div", { class: "wmp-spinner" })));
            return;
        }
        const list = termCourses();
        const pending = pendingEvents();
        courseHeading.hidden = list.length === 0;
        courseList.replaceChildren(
            ...list.map((c) => {
                const count = pending.filter((e) => String(e.course?.id) === c.id).length;
                const name = WMP.courseName(settings, c);
                const active = c.id === currentCourseId;
                return el(
                    "li",
                    {},
                    el(
                        "a",
                        {
                            class: `wmp-rail-course${active ? " is-active" : ""}`,
                            href: c.url,
                            title: count > 0 ? `${name}（締切前の課題など ${count}件）` : name,
                            "aria-current": active ? "page" : null,
                        },
                        courseMark(c),
                        el("span", { class: "wmp-rail-label" }, name),
                        count > 0 ? el("span", { class: "wmp-rail-count" }, String(count)) : null
                    )
                );
            })
        );
    }

    function courseMark(course) {
        return el(
            "span",
            { class: "wmp-mark", style: { "--wmp-course-color": WMP.courseColor(settings, course.id) }, "aria-hidden": "true" },
            WMP.courseInitial(WMP.courseName(settings, course))
        );
    }

    function renderDeadlineCount() {
        const now = Date.now();
        const soon = pendingEvents().filter((e) => e.timesort * 1000 < now + settings.badgeDeadlineRangeDays * WMP.DAY).length;
        deadlineCount.hidden = soon === 0;
        deadlineCount.textContent = String(soon);
        deadlineCount.title = `${settings.badgeDeadlineRangeDays}日以内の締切 ${soon}件`;
    }

    // ===== 締切の引き出し =====

    const panelBody = el("div", { class: "wmp-rail-panel-body" });
    const panel = el(
        "section",
        { class: "wmp-scope wmp-rail-panel", id: "wmp-rail-panel", hidden: true, "aria-label": "締切" },
        el(
            "header",
            { class: "wmp-rail-panel-header" },
            el("h2", {}, "締切"),
            el(
                "button",
                { type: "button", class: "wmp-icon-btn", title: "最新の情報に更新", "aria-label": "更新", onclick: () => refresh() },
                icon("refresh")
            ),
            el("button", { type: "button", class: "wmp-icon-btn", title: "閉じる", "aria-label": "閉じる", onclick: () => togglePanel(false) }, icon("close"))
        ),
        panelBody
    );

    async function refresh() {
        panelBody.replaceChildren(el("div", { class: "wmp-empty" }, el("div", { class: "wmp-spinner", style: { margin: "0 auto" } })));
        const result = await WMP.send("getTimeline", { force: true }).catch(() => null);
        if (result) events = result.value;
        renderPanel();
        renderDeadlineCount();
        renderCourses();
    }

    function renderPanel() {
        if (courses === null) {
            panelBody.replaceChildren(el("div", { class: "wmp-empty" }, el("div", { class: "wmp-spinner", style: { margin: "0 auto" } })));
            return;
        }
        panelBody.replaceChildren(WMP.renderTimeline(events, settings, { onHide: (e) => WMP.hideEvent(e) }));
    }

    function togglePanel(open = panel.hidden) {
        panel.hidden = !open;
        deadlineButton.classList.toggle("is-open", open);
        deadlineButton.setAttribute("aria-expanded", String(open));
        if (open) renderPanel();
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) togglePanel(false);
    });
    document.addEventListener("pointerdown", (e) => {
        if (panel.hidden || panel.contains(e.target) || deadlineButton.contains(e.target)) return;
        togglePanel(false);
    });

    // ===== まとめて探す（Ctrl+K） =====

    const LINKS = [
        { label: "成績（Moodle）", href: "/grade/report/overview/index.php", icon: "grades" },
        { label: "プロフィール", href: "/user/profile.php", icon: "user" },
        { label: "メッセージ", href: "/message/index.php", icon: "mail" },
        { label: "MyWaseda", launch: "my_waseda", icon: "external" },
        { label: "成績照会", launch: "grade_inquiry", icon: "external" },
        { label: "科目登録", launch: "course_registration", icon: "external" },
        { label: "Waseda メール", launch: "waseda_email", icon: "external" },
        { label: "シラバス検索", href: "https://www.wsl.waseda.jp/syllabus/JAA101.php", icon: "external", newTab: true },
        { label: "拡張機能の設定", action: () => WMP.send("openOptions"), icon: "settings" },
    ];

    const normalize = (s) => String(s ?? "").normalize("NFKC").toLowerCase();

    const paletteInput = el("input", {
        class: "wmp-palette-input",
        type: "search",
        placeholder: "科目・締切・ページを探す",
        "aria-label": "科目・締切・ページを探す",
        autocomplete: "off",
        spellcheck: false,
        role: "combobox",
        "aria-expanded": "true",
        "aria-controls": "wmp-palette-list",
    });
    const paletteList = el("div", { class: "wmp-palette-list", id: "wmp-palette-list", role: "listbox" });
    const palette = el(
        "dialog",
        { class: "wmp-scope wmp-palette", "aria-label": "まとめて探す" },
        el("div", { class: "wmp-palette-field" }, icon("search", { size: 20 }), paletteInput),
        paletteList,
        el("div", { class: "wmp-palette-help" }, "上下キーで選択、Enter で開く。Ctrl を押しながら Enter で新しいタブに開く。Esc で閉じる。")
    );
    let paletteItems = [];
    let selected = 0;

    function buildPaletteItems(query) {
        const q = normalize(query.trim());
        const match = (...texts) => !q || texts.some((t) => normalize(t).includes(q));
        const groups = [];

        const pages = [
            ...navItems.map((n) => ({ label: n.label, href: n.href, icon: n.icon })),
            ...LINKS,
        ].filter((x) => match(x.label));
        if (pages.length) groups.push({ title: "ページ", items: q ? pages : pages.slice(0, navItems.length + 2) });

        const allCourses = courses ?? [];
        const courseItems = (q ? allCourses.filter((c) => match(WMP.courseName(settings, c), c.name)) : termCourses())
            .slice(0, q ? 12 : 8)
            .map((c) => ({
                label: WMP.courseName(settings, c),
                sub: c.year ? `${c.year}年度` : "",
                href: c.url,
                mark: c,
            }));
        if (courseItems.length) groups.push({ title: q ? "科目" : "今学期の科目", items: courseItems });

        const now = Date.now();
        const deadlineItems = [...pendingEvents()]
            .filter((e) => match(e.activityname ?? e.name, e.course?.fullname))
            .sort((a, b) => a.timesort - b.timesort)
            .slice(0, q ? 12 : 5)
            .map((e) => {
                const due = e.timesort * 1000;
                return {
                    label: e.activityname ?? e.name,
                    sub: `${WMP.moduleLabel(e.modulename)}　${settings.courseNameOverrides?.[String(e.course?.id)] || e.course?.fullname || ""}`,
                    hint: `${WMP.dateFormat.format(new Date(due))} ${WMP.timeFormat.format(new Date(due))}（${WMP.formatRemaining(due - now)}）`,
                    href: e.url,
                    icon: "deadline",
                    urgent: due - now < WMP.DAY,
                };
            });
        if (deadlineItems.length) groups.push({ title: "締切", items: deadlineItems });
        return groups;
    }

    function renderPalette() {
        const groups = buildPaletteItems(paletteInput.value);
        paletteItems = groups.flatMap((g) => g.items);
        selected = Math.min(selected, Math.max(paletteItems.length - 1, 0));
        let index = 0;
        paletteList.replaceChildren(
            ...(groups.length === 0
                ? [el("div", { class: "wmp-palette-empty" }, "見つかりませんでした")]
                : groups.map((g) =>
                      el(
                          "div",
                          { class: "wmp-palette-group", role: "group", "aria-label": g.title },
                          el("div", { class: "wmp-palette-group-title" }, g.title),
                          g.items.map((item) => {
                              const i = index++;
                              return el(
                                  "div",
                                  {
                                      class: `wmp-palette-item${i === selected ? " is-selected" : ""}${item.urgent ? " is-urgent" : ""}`,
                                      role: "option",
                                      id: `wmp-palette-option-${i}`,
                                      "aria-selected": String(i === selected),
                                      onpointermove: () => select(i),
                                      onclick: (e) => openItem(item, e.ctrlKey || e.metaKey),
                                  },
                                  item.mark ? courseMark(item.mark) : el("span", { class: "wmp-palette-icon" }, icon(item.icon ?? "page")),
                                  el("span", { class: "wmp-palette-text" }, el("span", { class: "wmp-palette-label" }, item.label), item.sub ? el("span", { class: "wmp-palette-sub" }, item.sub) : null),
                                  item.hint ? el("span", { class: "wmp-palette-hint" }, item.hint) : null
                              );
                          })
                      )
                  ))
        );
        paletteInput.setAttribute("aria-activedescendant", paletteItems.length ? `wmp-palette-option-${selected}` : "");
    }

    function select(i) {
        if (i === selected) return;
        paletteList.querySelector(".is-selected")?.classList.remove("is-selected");
        paletteList.querySelector(`#wmp-palette-option-${selected}`)?.setAttribute("aria-selected", "false");
        selected = i;
        const option = paletteList.querySelector(`#wmp-palette-option-${i}`);
        option?.classList.add("is-selected");
        option?.setAttribute("aria-selected", "true");
        option?.scrollIntoView({ block: "nearest" });
        paletteInput.setAttribute("aria-activedescendant", `wmp-palette-option-${i}`);
    }

    function openItem(item, newTab) {
        palette.close();
        if (item.action) return void item.action();
        if (item.launch) return void WMP.send("openLauncher", { target: item.launch }).catch(() => {});
        if (!item.href) return;
        if (newTab || item.newTab) window.open(item.href, "_blank", "noopener");
        else location.href = item.href;
    }

    paletteInput.addEventListener("input", () => {
        selected = 0;
        renderPalette();
    });
    paletteInput.addEventListener("keydown", (e) => {
        if (e.isComposing) return; // 日本語の変換中の Enter・矢印は変換に使う
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (paletteItems.length === 0) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            select((selected + step + paletteItems.length) % paletteItems.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const item = paletteItems[selected];
            if (item) openItem(item, e.ctrlKey || e.metaKey);
        }
    });
    palette.addEventListener("click", (e) => {
        if (e.target === palette) palette.close(); // 外側（背景）をクリックしたら閉じる
    });

    function openPalette() {
        if (palette.open) return;
        togglePanel(false);
        paletteInput.value = "";
        selected = 0;
        renderPalette();
        palette.showModal();
        paletteInput.focus();
    }

    const trigger = el(
        "button",
        { type: "button", class: "wmp-search-trigger", title: "科目・締切・ページを探す（Ctrl+K）", onclick: openPalette },
        icon("search", { size: 18 }),
        el("span", { class: "wmp-search-trigger-text" }, "科目・締切・ページを探す"),
        el("kbd", { class: "wmp-search-trigger-key" }, "Ctrl K")
    );

    document.addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
        // ページ側（エディタなど）がすでに使ったキーや、入力欄の中での Ctrl+K（エディタのリンク挿入など）は横取りしない
        if (e.defaultPrevented) return;
        const t = e.target;
        if (t instanceof Element && t !== paletteInput && (t.closest("[contenteditable]:not([contenteditable='false'])") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        openPalette();
    });

    // ===== 差し込み =====

    const primary = navbar.querySelector(".primary-navigation");
    const userNav = navbar.querySelector("#usernavigation");
    const triggerWrap = el("div", { class: "wmp-scope wmp-search-trigger-wrap" }, trigger);
    if (primary) primary.insertAdjacentElement("afterend", triggerWrap);
    else if (userNav) userNav.insertAdjacentElement("beforebegin", triggerWrap);
    else navbar.append(triggerWrap);

    document.body.append(rail, panel, palette);
    root.classList.add("wmp-has-rail", "wmp-rail-ready");
    setCollapsed(localStorage.getItem("wmpRailCollapsed") === "1");
    renderCourses();
    load();

    WMP.onSettingsChanged((next) => {
        settings = next;
        renderCourses();
        renderDeadlineCount();
        if (!panel.hidden) renderPanel();
    });
};
