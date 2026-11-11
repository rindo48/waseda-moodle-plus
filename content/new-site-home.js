// 新デザイン: サイトのホーム（/ のページ）のお知らせを「掲示板」の形にする。
// Moodle はお知らせを本文ごと縦に積むので長く、どんなお知らせがあるのかが一目で分からない。
// そこで、お知らせ1件を「日付・件名」の1行にたたみ、押すと本文を開くようにする。
// Moodle の要素は動かさず、クラスを付けて隠したり出したりするだけにしている。

globalThis.WMP.initNewSiteHome = function initNewSiteHome() {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;

    const main = document.querySelector("#region-main");
    if (!main) return;

    removeNestedFrames(main);

    // Moodle 4 のフォーラムの投稿は article[data-region="post"]。古い形式の .forumpost にも対応する
    let posts = [...main.querySelectorAll('article[data-region="post"], [data-region="post"]')];
    if (posts.length === 0) posts = [...main.querySelectorAll(".forumpost")];
    posts = posts.filter((p) => !posts.some((other) => other !== p && other.contains(p)));
    if (posts.length === 0) return;

    const subjectOf = (post) =>
        post.querySelector('[data-region-content="forum-post-core-subject"], .subject, h3, h4')?.textContent.replace(/\s+/g, " ").trim() || "（件名なし）";

    function dateOf(post) {
        const time = post.querySelector("time[datetime]");
        if (time) {
            const d = new Date(time.getAttribute("datetime"));
            if (!Number.isNaN(d.getTime())) return d;
        }
        return null;
    }
    const format = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });

    const board = el("section", { class: "wmp-scope wmp-board" });
    const toggleAll = el("button", { type: "button", class: "wmp-btn is-small" });
    board.append(
        el("header", { class: "wmp-board-head" }, el("h2", {}, "お知らせ"), el("span", { class: "wmp-board-count" }, `${posts.length}件`), toggleAll)
    );
    posts[0].insertAdjacentElement("beforebegin", board);

    const updateToggleAll = () => {
        const allOpen = posts.every((p) => p.classList.contains("is-open"));
        toggleAll.textContent = allOpen ? "すべて閉じる" : "すべて開く";
        toggleAll.onclick = () => posts.forEach((p) => setOpen(p, !allOpen));
    };

    function setOpen(post, open) {
        post.classList.toggle("is-open", open);
        post.querySelector(":scope > .wmp-notice-summary")?.setAttribute("aria-expanded", String(open));
        updateToggleAll();
    }

    posts.forEach((post, i) => {
        const date = dateOf(post);
        const isNew = date && Date.now() - date.getTime() < 7 * WMP.DAY;
        post.classList.add("wmp-notice");
        const summary = el(
            "button",
            {
                type: "button",
                class: "wmp-scope wmp-notice-summary",
                "aria-expanded": "false",
                onclick: () => setOpen(post, !post.classList.contains("is-open")),
            },
            el("span", { class: "wmp-notice-date" }, date ? format.format(date) : ""),
            el("span", { class: "wmp-notice-subject" }, subjectOf(post)),
            isNew ? el("span", { class: "wmp-notice-new" }, "新着") : null,
            icon("chevronDown", { size: 18 })
        );
        post.prepend(summary);
        // 一番新しいお知らせだけ開いておく
        if (i === 0) setOpen(post, true);
    });
    updateToggleAll();
};

/**
 * ホームの本文の中にある「四辺に線があって角が丸い枠」を外す。
 * 枠はテーマや大学が書いた HTML のどこから付いているか決まっていないので、表示された見た目で探す。
 * 拡張機能の部品（.wmp-scope）と、ボタン・入力欄・画像などの部品は対象外
 */
function removeNestedFrames(main) {
    const SKIP = ".wmp-scope, .btn, button, input, select, textarea, img, .badge, .dropdown-menu, .modal, [data-region='post']";
    const apply = () => {
        for (const el of main.querySelectorAll("div, section, ul, li, article, aside")) {
            if (el.classList.contains("wmp-frame-off") || el.closest(SKIP)) continue;
            const cs = getComputedStyle(el);
            const sides = ["Top", "Right", "Bottom", "Left"];
            const bordered = sides.every((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none");
            const rounded = parseFloat(cs.borderTopLeftRadius) >= 4;
            if (bordered && rounded && el.offsetWidth > 200) el.classList.add("wmp-frame-off");
        }
        // 回の見出しが空（名前の無いトップページの回）なら、見出しの場所ごと隠す
        for (const head of main.querySelectorAll(".course-section-header, .section-title, .sectionname, .section_title")) {
            if (!head.textContent.trim() && !head.querySelector("img, svg, input, button, a[href]")) head.classList.add("wmp-empty-head");
        }
    };
    apply();
    // 本文の一部は後から読み込まれるので、少し待ってもう一度見る
    setTimeout(apply, 1500);
}
