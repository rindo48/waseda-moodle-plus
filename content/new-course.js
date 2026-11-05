// 新デザイン: コースページ（/course/view.php）を作り替える。
//
// Moodle のコースページは全部の回（セクション）を縦に積むので、後ろの回ほどスクロールが長くなる。そこで、
// - 全部の回の目次を常に出し（広い画面は左、狭い画面は上）、選んだ1回分だけを表示する（「1回ずつ」）
//   今までどおり縦に全部並べる表示（「全部」）にも切り替えられ、そのときの目次は飛び先の一覧になる
// - 最初に開く回は、URL の #section-N、Moodle が強調している回、新着がある回、前回見た回、最後の回の順に決める
// - 前回このページを開いたときから増えた資料・課題に「新着」を付ける
// - 上に、この科目の締切と、資料・課題を探す検索欄・種類の絞り込みを置く（絞り込み中は一致した回をすべて出す）
// Moodle の要素は消さずにクラスで隠すだけにしているので、元に戻すと元どおりになる。

globalThis.WMP.initNewCourse = async function initNewCourse(settings) {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;

    // 編集モード（先生側）では並べ替えなどの邪魔になるので何もしない
    if (document.body.classList.contains("editing")) return;

    const content = document.querySelector("#region-main .course-content");
    if (!content) return;
    const courseId = new URLSearchParams(location.search).get("id");

    // ===== 回（セクション） =====

    // Collapsed Topics の「すべて開く」と説明の行は回ではない
    const NOT_SECTIONS = new Set(["toggle-all", "topcoll-display-instructions"]);
    const sectionNodes = [...content.querySelectorAll("li.section")].filter((s) => !NOT_SECTIONS.has(s.id) && !s.parentElement.closest("li.section"));
    if (sectionNodes.length === 0) return;

    const toHalfWidth = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

    function titleOf(section) {
        const heading = section.querySelector(".sectionname, .section-title, [data-for='section_title'], h3");
        if (!heading) return "";
        // 読み上げ用の隠れた文字（「- 切り替え」など）は除く
        const clone = heading.cloneNode(true);
        clone.querySelectorAll(".cttoggle, .sr-only, .accesshide, .visually-hidden").forEach((n) => n.remove());
        return clone.textContent.replace(/\s+/g, " ").trim();
    }

    const sections = sectionNodes.map((node, i) => {
        const number = node.dataset.number ?? node.id.match(/^section-(\d+)$/)?.[1] ?? String(i);
        const title = titleOf(node) || (number === "0" ? "全般" : `セクション ${number}`);
        const nth = title.match(/第\s*([0-9０-９]+)\s*回/);
        // 目次の左に出す短い番号。「第10回 …」なら 10、無ければ Moodle のセクション番号
        // 0番（全般・お知らせなど）は番号を付けず、名前だけ出す
        const label = number === "0" ? "" : nth ? toHalfWidth(nth[1]) : number;
        const rest = nth ? title.replace(nth[0], "").replace(/^[\s:：\-－・|｜]+/, "") : title;
        return { node, number, title, label, rest: rest || title, current: node.classList.contains("current") };
    });

    // ===== 活動の種類 =====

    const GROUPS = [
        { id: "new", label: "新着", test: (a) => a.isNew },
        // 動画は種類名がいろいろ（millvi・外部ツール・URL など）なので、種類名・活動名・アイコン・リンク先で判定し、資料などより先に見る
        { id: "video", label: "動画", test: (a) => isVideo(a) },
        { id: "material", label: "資料", test: (a) => ["resource", "folder", "url", "page", "book", "imscp"].includes(a.type) },
        { id: "assign", label: "課題", test: (a) => ["assign", "workshop"].includes(a.type) },
        { id: "quiz", label: "小テスト", test: (a) => a.type === "quiz" },
        { id: "forum", label: "フォーラム", test: (a) => ["forum", "hsuforum"].includes(a.type) },
        { id: "other", label: "その他", test: (a) => a.type !== "label" },
    ];
    const VIDEO_TYPE = /millvi|video|movie|kaltura|panopto|stream|vimeo|youtube|mediasite|echo360/i;
    const VIDEO_NAME = /動画|ビデオ|映像|オンデマンド|録画|講義収録|video|movie|lecture recording/i;
    const VIDEO_LINK = /millvi|youtube\.com|youtu\.be|vimeo\.com|panopto|kaltura|stream\.microsoft|video/i;
    function isVideo(a) {
        if (a.type === "label" || ["assign", "quiz", "forum", "hsuforum", "workshop"].includes(a.type)) return false;
        if (VIDEO_TYPE.test(a.type)) return true;
        const name = a.node.querySelector(".activityname, .instancename")?.textContent ?? "";
        if (VIDEO_NAME.test(name)) return true;
        const icon = a.node.querySelector("img.activityicon, .activityiconcontainer img")?.getAttribute("src") ?? "";
        if (VIDEO_TYPE.test(icon)) return true;
        const link = a.node.querySelector(".activityname a, a.aalink")?.getAttribute("href") ?? "";
        return VIDEO_LINK.test(link);
    }

    // 「新着」以外の種類は1つの活動に1つだけ（上から順に最初に当てはまったもの）
    const KIND_GROUPS = GROUPS.filter((g) => g.id !== "new");

    const typeOf = (node) => [...node.classList].find((c) => c.startsWith("modtype_"))?.slice("modtype_".length) ?? "";
    const moduleIdOf = (node) => node.id.match(/^module-(\d+)$/)?.[1] ?? node.dataset.id ?? null;

    // ===== 新着（前回このページを開いたときに無かった活動） =====

    const SEEN_KEY = `wmpSeenModules:${courseId}`;
    let seenBefore = null;
    try {
        seenBefore = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "null");
    } catch {
        seenBefore = null;
    }
    const seenSet = new Set(seenBefore ?? []);

    const activities = [...content.querySelectorAll("li.activity")].map((node) => {
        const type = typeOf(node);
        const id = moduleIdOf(node);
        // 初めて開いたコースでは、全部が新着にならないよう何も付けない
        const isNew = Boolean(seenBefore && id && !seenSet.has(id) && type !== "label");
        // 検索に使う文字は最初に一度だけ読む（innerText は読むたびにページの配置を計算し直すので、1文字ごとに全部読むと重い）
        const text = node.textContent.replace(/\s+/g, " ").toLowerCase();
        const a = { node, type, id, isNew, text: () => text };
        a.kind = KIND_GROUPS.find((g) => g.test(a))?.id ?? null;
        return a;
    });
    if (courseId) {
        const ids = activities.map((a) => a.id).filter(Boolean);
        localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...(seenBefore ?? []), ...ids])]));
    }
    for (const a of activities) {
        if (!a.isNew) continue;
        a.node.classList.add("wmp-activity-new");
        const tag = el("span", { class: "wmp-scope wmp-new-tag" }, "新着");
        const name = a.node.querySelector(".activityname, .instancename");
        if (name) name.insertAdjacentElement("afterend", tag);
        else a.node.prepend(tag);
    }
    const newCount = (s) => activities.filter((a) => a.isNew && s.node.contains(a.node)).length;
    const activityCount = (s) => activities.filter((a) => a.type !== "label" && s.node.contains(a.node)).length;

    // ===== 表示のしかた（1回ずつ・全部） =====

    const LAYOUT_KEY = "wmpCourseLayout";
    const LAST_KEY = `wmpCourseSection:${courseId}`;
    let paged = localStorage.getItem(LAYOUT_KEY) !== "all";
    let shown = null; // 表示中の回

    function sectionFromHash(hash) {
        if (!hash || hash.length < 2) return null;
        let target;
        try {
            target = document.getElementById(decodeURIComponent(hash.slice(1)));
        } catch {
            return null;
        }
        return target ? sections.find((s) => s.node.contains(target)) ?? null : null;
    }

    function initialSection() {
        const fromHash = sectionFromHash(location.hash);
        if (fromHash) return fromHash;
        const highlighted = sections.find((s) => s.current);
        if (highlighted) return highlighted;
        const withNew = [...sections].reverse().find((s) => s.number !== "0" && newCount(s) > 0);
        if (withNew) return withNew;
        const last = sections.find((s) => s.number === localStorage.getItem(LAST_KEY));
        if (last) return last;
        return [...sections].reverse().find((s) => s.number !== "0" && activityCount(s) > 0) ?? sections[0];
    }

    function show(section, { scroll = true, focus = false, updateUrl = true } = {}) {
        shown = section;
        localStorage.setItem(LAST_KEY, section.number);
        for (const s of sections) s.node.classList.toggle("wmp-section-shown", s === section);
        applyOpen();
        // URL も合わせておく（再読み込みしても同じ回が開く）。replaceState なので Moodle は反応しない。
        // 最初の表示では変えない（読み込み中に # を付けると、ブラウザがその位置まで勝手にスクロールするため）
        if (updateUrl && location.hash !== `#${section.node.id}`) history.replaceState(history.state, "", `#${section.node.id}`);
        renderIndex();
        renderPager();
        if (!paged) {
            spied = section;
            // 最初の表示や #module-N のリンクで開いたときは、ブラウザが活動の位置まで動かすので、ここでは動かさない
            if (scroll) scrollToTop(section.node);
        } else if (scroll && layout.getBoundingClientRect().top < (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wmpn-nav-h")) || 60)) {
            scrollToTop(layout);
        }
        if (focus) section.node.querySelector(".sectionname, h3, a")?.focus?.({ preventScroll: true });
    }

    function setPaged(next) {
        paged = next;
        localStorage.setItem(LAYOUT_KEY, paged ? "paged" : "all");
        content.classList.toggle("wmp-paged", paged);
        applyOpen();
        layoutToggle.replaceChildren(icon(paged ? "list" : "page", { size: 16 }), paged ? "全部を並べる" : "1回ずつ表示");
        layoutToggle.title = paged ? "全部の回を縦に並べて表示します" : "選んだ回だけを表示します";
        openAllBar.hidden = paged;
        renderPager();
        if (paged && shown) show(shown, { scroll: true });
    }

    // ===== 回ごとの開閉 =====
    // Moodle（Collapsed Topics）の開閉は、1回ずつ表示や絞り込みで「開いて見せる」のとぶつかるので、
    // 見出しを押したときの開閉はこちらで持つ。押していない回は、1回ずつ・絞り込み中は開き、全部並べるときは表示中の回だけ開く
    const userOpen = new Map(); // 回 → 開いているか（見出しを押した回だけ）
    function isOpen(sec) {
        if (userOpen.has(sec)) return userOpen.get(sec);
        if (paged || content.classList.contains("wmp-filtering")) return true;
        return sec === shown || sec.number === "0";
    }
    function applyOpen() {
        for (const sec of sections) {
            const open = isOpen(sec);
            sec.node.classList.toggle("wmp-open", open);
            sec.node.classList.toggle("wmp-closed", !open);
            sec.node.querySelector(".wmp-section-head")?.setAttribute("aria-expanded", String(open));
        }
    }
    const HEAD = ".toggle, .course-section-header, .section-title, .sectionname";
    for (const sec of sections) {
        const head = sec.node.querySelector(HEAD);
        if (!head) continue;
        head.classList.add("wmp-section-head");
        head.setAttribute("role", "button");
        head.setAttribute("tabindex", "0");
    }
    function toggleSection(e) {
        const head = e.target.closest?.(".wmp-section-head");
        if (!head || !content.contains(head)) return;
        // 見出しの中の普通のリンク（回のページへのリンクなど）はそのまま開く
        const link = e.target.closest("a[href]");
        if (link && !/^#|^javascript:/.test(link.getAttribute("href")) && !link.matches("[data-toggle], [data-bs-toggle]")) return;
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        const sec = sections.find((x) => x.node.contains(head));
        if (!sec) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // Moodle 側の開閉は動かさない
        userOpen.set(sec, !isOpen(sec));
        applyOpen();
    }
    content.addEventListener("click", toggleSection, true);
    content.addEventListener("keydown", toggleSection, true);

    // ===== 目次 =====

    const indexList = el("ol", { class: "wmp-course-index-list" });
    /** 並べている回（絞り込み中は一致した回）をまとめて開く・閉じる */
    function setAllOpen(open) {
        for (const sec of sections) if (isVisible(sec)) userOpen.set(sec, open);
        applyOpen();
    }
    // 1回ずつ表示では1回分しか出ないので、全部を並べるときだけ出す
    const openAllBar = el(
        "div",
        { class: "wmp-course-index-bulk", hidden: true },
        el("button", { type: "button", class: "wmp-btn is-small", onclick: () => setAllOpen(true) }, icon("chevronDown", { size: 14 }), "すべて展開する"),
        el("button", { type: "button", class: "wmp-btn is-small", onclick: () => setAllOpen(false) }, icon("chevronRight", { size: 14 }), "すべて折りたたむ")
    );
    const layoutToggle = el("button", { type: "button", class: "wmp-btn is-small", onclick: () => setPaged(!paged) });
    const index = el(
        "nav",
        { class: "wmp-scope wmp-course-index", "aria-label": "この科目の回" },
        el("div", { class: "wmp-course-index-head" }, el("h2", {}, "目次"), layoutToggle),
        openAllBar,
        indexList
    );

    /** 複数の回を縦に並べているか（「全部を並べる」か、絞り込み中） */
    const isListMode = () => !paged;
    const isVisible = (s) => !s.node.classList.contains("wmp-filter-empty");
    const matchCount = (s) =>
        [...s.node.querySelectorAll("li.activity:not(.modtype_label)")].filter((n) => !n.classList.contains("wmp-filtered-out")).length;
    let spied = null; // 並べているときに画面に見えている回

    function jumpTo(s) {
        spied = s;
        lockUntil = Date.now() + 800;
        scrollToTop(s.node);
        updateActive();
    }

    /** 目次の「選択中」の印だけを付け直す（作り直すと目次のスクロール位置が飛ぶため） */
    function updateActive() {
        const target = isListMode() ? spied : shown;
        indexList.querySelectorAll(".wmp-course-index-item").forEach((b, i) => {
            const on = sections[i] === target;
            b.classList.toggle("is-active", on);
            if (on) b.setAttribute("aria-current", "true");
            else b.removeAttribute("aria-current");
        });
        revealActive();
    }

    // 並べているときは、スクロールに合わせて目次の印を動かす。
    // 画面の上から 3 割の線より上に見出しが来ている回のうち、一番下のものを「見ている回」とする。
    // Moodle は #page の中でスクロールするので、どこでスクロールしても拾えるよう capture で聞く
    let lockUntil = 0; // 目次で選んで飛んだ直後は、ページの最後で止まっても選んだ回を指したままにする
    let ticking = false;
    function onScroll() {
        if (ticking || !isListMode() || Date.now() < lockUntil) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const line = innerHeight * 0.3;
            let current = null;
            for (const x of sections) {
                if (!isVisible(x) || x.node.offsetParent === null) continue;
                if (x.node.getBoundingClientRect().top <= line) current = x;
            }
            current ??= sections.find((x) => isVisible(x) && x.node.offsetParent !== null) ?? null;
            if (current && current !== spied) {
                spied = current;
                updateActive();
            }
        });
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    function renderIndex() {
        indexList.replaceChildren(
            ...sections.map((s) => {
                const count = activityCount(s);
                const fresh = newCount(s);
                const filteredOut = s.node.classList.contains("wmp-filter-empty");
                // 1回ずつ表示では表示中の回、並べているとき（全部・絞り込み中）は画面に見えている回を指す
                const active = isListMode() ? s === spied : s === shown;
                const matches = content.classList.contains("wmp-filtering") ? matchCount(s) : 0;
                return el(
                    "li",
                    {},
                    el(
                        "button",
                        {
                            type: "button",
                            class: `wmp-course-index-item${active ? " is-active" : ""}${count === 0 ? " is-empty" : ""}${filteredOut ? " is-filtered-out" : ""}`,
                            "aria-current": active ? "true" : null,
                            title: s.title,
                            onclick: () => (isListMode() ? jumpTo(s) : show(s)),
                        },
                        el("span", { class: "wmp-course-index-no" }, s.label),
                        el("span", { class: "wmp-course-index-title" }, s.number === "0" ? s.title : s.rest),
                        s.current ? el("span", { class: "wmp-course-index-tag is-current" }, "今週") : null,
                        matches > 0
                            ? el("span", { class: "wmp-course-index-tag is-match" }, `${matches}件`)
                            : fresh > 0
                              ? el("span", { class: "wmp-course-index-tag is-new" }, `新着${fresh}`)
                              : null
                    )
                );
            })
        );
        revealActive();
    }

    /**
     * 要素の上端を、固定ヘッダーのすぐ下（少し余白を空けた位置）に合わせてスクロールする。
     * scrollIntoView だと、ページ全体がスクロールする Moodle では見出しが固定ヘッダーの下に隠れるため、位置を測って動かす
     */
    const navHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wmpn-nav-h")) || 60;
    /** スクロールしている入れ物（標準の Moodle は #page、早稲田のようにページ全体のこともある） */
    function scrollerOf(target) {
        let scroller = target.parentElement;
        while (scroller && scroller !== document.body) {
            const oy = getComputedStyle(scroller).overflowY;
            if ((oy === "auto" || oy === "scroll") && scroller.scrollHeight > scroller.clientHeight) return scroller;
            scroller = scroller.parentElement;
        }
        return document.scrollingElement;
    }
    /** 目次が止まる位置。ページ全体がスクロールするときは固定ヘッダーの下にする（でないとヘッダーに隠れる） */
    function updateStickyTop() {
        const scroller = scrollerOf(layout);
        const top = scroller === document.scrollingElement ? navHeight() + 12 : Math.max(scroller.getBoundingClientRect().top - navHeight(), 0) + 12;
        layout.style.setProperty("--wmp-sticky-top", `${Math.round(top)}px`);
    }

    function scrollToTop(target) {
        const navH = navHeight();
        const scroller = scrollerOf(target);
        // スクロールの入れ物の上端が固定ヘッダーより下にあるとき（#page がスクロールするとき）は、その上端に合わせる
        const top = scroller === document.scrollingElement ? navH : Math.max(scroller.getBoundingClientRect().top, navH);
        scroller.scrollTop += target.getBoundingClientRect().top - top - 12;
    }

    /** 選んでいる回が目次の中で見えるようにする（scrollIntoView はページ全体まで動かすので、目次の中だけ動かす） */
    function revealActive() {
        const item = indexList.querySelector(".is-active");
        if (!item) return;
        const list = indexList.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        if (box.top < list.top) indexList.scrollTop -= list.top - box.top;
        else if (box.bottom > list.bottom) indexList.scrollTop += box.bottom - list.bottom;
        if (box.left < list.left) indexList.scrollLeft -= list.left - box.left;
        else if (box.right > list.right) indexList.scrollLeft += box.right - list.right;
    }

    // ===== 前後の回へ =====

    const pager = el("div", { class: "wmp-scope wmp-course-pager" });
    function renderPager() {
        // 絞り込み中は一致した回の中で前後に動く
        const list = sections.filter(isVisible);
        const i = list.indexOf(shown);
        const prev = i > 0 ? list[i - 1] : null;
        const next = i >= 0 ? list[i + 1] : null;
        pager.hidden = !paged || !shown;
        const link = (s, dir) =>
            s
                ? el(
                      "button",
                      { type: "button", class: `wmp-course-pager-btn is-${dir}`, onclick: () => show(s, { focus: true }) },
                      dir === "prev" ? icon("chevronLeft") : null,
                      el(
                          "span",
                          {},
                          el("small", {}, dir === "prev" ? "前の回" : "次の回"),
                          el("span", { class: "wmp-course-pager-title" }, s.title)
                      ),
                      dir === "next" ? icon("chevronRight") : null
                  )
                : el("span");
        pager.replaceChildren(link(prev, "prev"), link(next, "next"));
    }

    // 左右の矢印キーで前後の回へ（入力中や、ほかの画面を開いているときは除く）
    document.addEventListener("keydown", (e) => {
        if (!paged || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        const t = e.target;
        if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector("dialog[open]")) return;
        const list = sections.filter(isVisible);
        const s = list[list.indexOf(shown) + (e.key === "ArrowLeft" ? -1 : 1)];
        if (s) {
            e.preventDefault();
            show(s);
        }
    });

    // Moodle の左の目次や本文のリンクで別の回の活動へ飛んだときは、その回に切り替える
    document.addEventListener(
        "click",
        (e) => {
            const a = e.target.closest?.('a[href*="#"]');
            if (!a) return;
            let url;
            try {
                url = new URL(a.href, location.href);
            } catch {
                return;
            }
            if (url.pathname !== location.pathname || url.searchParams.get("id") !== courseId) return;
            const s = sectionFromHash(url.hash);
            if (s && s !== shown) show(s, { scroll: false });
        },
        true
    );
    window.addEventListener("hashchange", () => {
        const s = sectionFromHash(location.hash);
        if (s && s !== shown) show(s, { scroll: false });
    });

    // ===== 絞り込み =====

    let query = "";
    let group = "";

    function apply() {
        const q = query.trim().toLowerCase();
        const active = Boolean(q || group);
        let matched = 0;
        const groupDef = GROUPS.find((g) => g.id === group);
        for (const a of activities) {
            const inGroup = !groupDef || (groupDef.id === "new" ? a.isNew : a.kind === groupDef.id);
            const ok = inGroup && (!q || a.text().includes(q));
            a.node.classList.toggle("wmp-filtered-out", active && !ok);
            if (ok && a.type !== "label") matched++;
        }
        for (const s of sections) {
            const hasMatch = [...s.node.querySelectorAll("li.activity")].some((n) => !n.classList.contains("wmp-filtered-out"));
            // 一致した活動がある回は閉じていても開いて見せ、無い回は隠す（このときは1回ずつではなく全部並べる）
            s.node.classList.toggle("wmp-filter-open", active && hasMatch);
            s.node.classList.toggle("wmp-filter-empty", active && !hasMatch);
        }
        content.classList.toggle("wmp-filtering", active);
        // 目次の印は一致した回に合わせる。1回ずつ表示で今の回に一致が無ければ、一致した最初の回に移る
        if (active && (!spied || !isVisible(spied))) spied = sections.find(isVisible) ?? null;
        if (active && paged && shown && !isVisible(shown)) {
            const first = sections.find(isVisible);
            if (first) show(first, { scroll: false });
        }
        applyOpen();
        result.textContent = active ? `${matched}件` : "";
        empty.hidden = !active || matched > 0;
        clearButton.hidden = !active;
        renderChips();
        renderIndex();
        renderPager();
    }

    const counts = Object.fromEntries(
        GROUPS.map((g) => [g.id, activities.filter((a) => (g.id === "new" ? a.isNew : a.kind === g.id)).length])
    );

    const chips = el("div", { class: "wmp-segmented wmp-course-chips", role: "tablist", "aria-label": "種類で絞り込み" });
    function renderChips() {
        const chip = (id, label, count) =>
            el(
                "button",
                {
                    type: "button",
                    role: "tab",
                    class: `${group === id ? "is-active" : ""}${id === "new" ? " is-new" : ""}`,
                    "aria-selected": String(group === id),
                    onclick: () => {
                        group = group === id && id ? "" : id;
                        apply();
                    },
                },
                label,
                count !== undefined ? el("span", { class: "wmp-course-chip-count" }, String(count)) : null
            );
        chips.replaceChildren(chip("", "すべて"), ...GROUPS.filter((g) => counts[g.id] > 0).map((g) => chip(g.id, g.label, counts[g.id])));
    }

    const search = el("input", {
        class: "wmp-input wmp-course-search",
        type: "search",
        placeholder: "この科目の資料・課題を検索（/ キー）",
        "aria-label": "この科目の中を検索",
        oninput: (e) => {
            query = e.target.value;
            apply();
        },
        onkeydown: (e) => {
            if (e.key === "Escape") clear();
        },
    });
    const result = el("span", { class: "wmp-muted wmp-course-result", "aria-live": "polite" });
    const clearButton = el("button", { type: "button", class: "wmp-btn is-small", hidden: true, onclick: () => clear() }, "解除");
    const empty = el("div", { class: "wmp-empty wmp-course-empty", hidden: true }, "一致する資料・課題はありません");

    function clear() {
        query = "";
        group = "";
        search.value = "";
        apply();
    }

    // 「/」キーで検索欄へ（入力中は除く）
    document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        search.focus();
    });

    // ===== 並べる =====
    // [締切] [検索・絞り込み]
    // [目次] [本文（Moodle の .course-content）+ 前後の回]

    const deadlines = el("div", { class: "wmp-course-deadlines" });
    const toolbar = el(
        "div",
        { class: "wmp-scope wmp-course-tools" },
        deadlines,
        activities.length > 0 ? el("div", { class: "wmp-card wmp-course-filter" }, search, chips, result, clearButton) : null,
        empty
    );
    const main = el("div", { class: "wmp-course-main" });
    const layout = el("div", { class: "wmp-course-layout" }, index, main);
    content.insertAdjacentElement("beforebegin", toolbar);
    toolbar.insertAdjacentElement("afterend", layout);
    main.append(content, pager);

    content.classList.add("wmp-course-enhanced");
    renderChips();
    setPaged(paged);
    show(initialSection(), { scroll: false, updateUrl: false });
    updateStickyTop();
    window.addEventListener("resize", updateStickyTop);

    // ===== この科目の締切 =====

    if (courseId && settings.timelineEnabled) {
        try {
            const { value } = await WMP.send("getTimeline");
            const mine = value.filter((e) => String(e.course?.id) === courseId && e.actionable !== false);
            if (mine.length > 0) {
                deadlines.replaceChildren(
                    el(
                        "section",
                        { class: "wmp-card" },
                        el("header", { class: "wmp-card-header" }, el("h2", { class: "wmp-card-title" }, `この科目の締切（${mine.length}件）`)),
                        el("div", { class: "wmp-card-body" }, WMP.renderTimeline(mine, settings, { limit: 5 }))
                    )
                );
            }
        } catch {
            // 締切が取れなくても検索は使えるので何もしない
        }
    }
};
