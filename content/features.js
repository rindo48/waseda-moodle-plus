// Moodle の各ページで動く小さな便利機能。

(() => {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    function toast(message, ms = 6000) {
        const t = el("div", { class: "wmp-toast", role: "status" }, message);
        document.body.append(t);
        setTimeout(() => t.remove(), ms);
    }

    /**
     * セッションを延長する。
     * @returns {Promise<boolean | null>} true: 有効, false: 切れている, null: 通信エラーや時間切れで確認できなかった
     */
    async function touch(sessionKey, timeoutMs = 5000) {
        try {
            const res = await fetch(`/lib/ajax/service.php?sesskey=${encodeURIComponent(sessionKey)}&info=core_session_touch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ index: 0, methodname: "core_session_touch", args: {} }]),
                signal: AbortSignal.timeout(timeoutMs),
            });
            const json = await res.json();
            return Array.isArray(json) && !json[0]?.error;
        } catch {
            return null;
        }
    }

    // ===== セッションの自動延長 =====
    function autoSessionExtension(sessionKey) {
        const INTERVAL = 30 * 60 * 1000;
        const timer = setInterval(async () => {
            if ((await touch(sessionKey, 30 * 1000)) === false) clearInterval(timer);
        }, INTERVAL);
    }

    // ===== 提出前のセッション確認 =====
    function checkSessionBeforeSubmit(sessionKey) {
        let allow = false;
        const isSubmit = (elem) =>
            elem.classList?.contains("mod_quiz-next-nav") ||
            elem.id === "id_submitbutton" ||
            elem.getAttribute?.("data-action") === "forum-inpage-submit" ||
            (elem.matches?.("input[type=submit], button[type=submit]") && elem.form?.querySelector("input[name=sesskey]"));

        document.addEventListener(
            "click",
            async (event) => {
                if (allow) return;
                const button = event.target.closest?.("button, input[type=submit], a");
                if (!button || !isSubmit(button)) return;
                event.preventDefault();
                event.stopImmediatePropagation();

                button.setAttribute("aria-busy", "true");
                const status = await touch(sessionKey);
                button.removeAttribute("aria-busy");
                const submit = () => {
                    allow = true;
                    button.click();
                    allow = false;
                };
                if (status === true) submit();
                else showSessionExpiredDialog(status === null, submit);
            },
            true
        );
    }

    /** @param {boolean} unknown - 通信エラーなどで確認できなかった, @param {() => void} submit - そのまま送信する */
    function showSessionExpiredDialog(unknown, submit) {
        const dialog = el(
            "dialog",
            { class: "wmp-dialog wmp-scope" },
            el("div", { class: "wmp-dialog-header" }, el("h2", {}, unknown ? "セッションを確認できませんでした" : "セッションが切れています")),
            el(
                "div",
                { class: "wmp-dialog-body" },
                el(
                    "p",
                    { style: { margin: "0", lineHeight: "1.7" } },
                    unknown
                        ? "Moodle との通信に時間がかかっているか、通信エラーが起きています。ログインが切れている場合、送信すると入力内容が失われる可能性があります。"
                        : "このまま送信すると、入力内容が失われる可能性があります。",
                    el("br"),
                    "心配な場合は、入力した文章をコピーして控えておき、別のタブで Moodle にログインし直してから、このページを再読み込みしてください。"
                )
            ),
            el(
                "div",
                { class: "wmp-dialog-footer" },
                el("button", { class: "wmp-btn", onclick: () => dialog.close() }, "閉じる"),
                el(
                    "button",
                    {
                        class: "wmp-btn",
                        onclick: () => {
                            dialog.close();
                            submit();
                        },
                    },
                    "このまま送信する"
                ),
                el(
                    "a",
                    { class: "wmp-btn is-primary", href: "/login/index.php", target: "_blank", onclick: () => dialog.close() },
                    "別のタブでログイン"
                )
            )
        );
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
    }

    // ===== 提出時の注意事項に自動でチェック =====
    function checkNotesOnSubmitting() {
        const checkbox = document.getElementById("id_submissionstatement");
        if (checkbox instanceof HTMLInputElement) checkbox.checked = true;
    }

    // ===== 文字数カウンター =====
    function wordCounter() {
        const countWords = (t) => {
            const s = t.replace(/\s+/g, " ").trim();
            return s ? s.split(" ").length : 0;
        };
        const countChars = (t) => t.replace(/\s/g, "").length;
        let forcedType = null;
        const typeOf = (t) => {
            if (forcedType) return forcedType;
            const chars = t.replace(/\s/g, "");
            const ascii = [...chars].filter((c) => c.charCodeAt(0) < 128).length;
            return chars.length > 0 && ascii / chars.length > 0.8 ? "word" : "char";
        };
        const format = (t) => (typeOf(t) === "word" ? `${countWords(t)} 語` : `${countChars(t)} 文字`);

        /** @param {HTMLElement} host - カウンターを付ける場所, @param {() => string} getText, @param {() => string} getSelection */
        function attach(host, getText, observeTarget, getSelectedText) {
            if (host.dataset.wmpCounter) return;
            host.dataset.wmpCounter = "1";
            const label = el("span", { title: "クリックで文字数と単語数を切り替え" });
            const wrap = el("div", { class: "wmp-word-counter" }, label);
            host.insertAdjacentElement("afterend", wrap);
            const update = () => {
                const sel = getSelectedText?.() ?? "";
                const text = getText();
                const next = sel ? `選択中: ${format(sel)}（全体: ${format(text)}）` : format(text);
                if (label.textContent !== next) label.textContent = next;
            };
            label.addEventListener("click", () => {
                forcedType = typeOf(getText()) === "word" ? "char" : "word";
                update();
            });
            observeTarget(update);
            update();
        }

        function scan() {
            // Atto エディタ
            for (const wrap of document.querySelectorAll(".editor_atto_wrap")) {
                const content = wrap.querySelector(".editor_atto_content");
                if (!content) continue;
                attach(
                    wrap,
                    () => content.innerText,
                    (cb) => {
                        new MutationObserver(cb).observe(content, { childList: true, subtree: true, characterData: true });
                        document.addEventListener("selectionchange", cb);
                    },
                    () => {
                        const s = getSelection();
                        return s && content.contains(s.anchorNode) ? s.toString() : "";
                    }
                );
            }
            // TinyMCE エディタ（iframe の中）
            for (const tox of document.querySelectorAll(".tox-tinymce")) {
                const iframe = tox.querySelector("iframe");
                const doc = iframe?.contentDocument;
                if (!doc?.body) continue;
                attach(
                    tox,
                    () => doc.body.innerText,
                    (cb) => {
                        new MutationObserver(cb).observe(doc.body, { childList: true, subtree: true, characterData: true });
                        doc.addEventListener("selectionchange", cb);
                    },
                    () => doc.getSelection()?.toString() ?? ""
                );
            }
            // 普通のテキストエリア（オンラインテキストの提出など）
            for (const ta of document.querySelectorAll("textarea[name*='onlinetext'], textarea.qtype_essay_response")) {
                if (ta.closest(".editor_atto_wrap, .tox-tinymce") || ta.style.display === "none" || ta.hidden) continue;
                attach(
                    ta,
                    () => ta.value,
                    (cb) => ta.addEventListener("input", cb),
                    () => ta.value.substring(ta.selectionStart, ta.selectionEnd)
                );
            }
        }
        scan();
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            setTimeout(() => {
                pending = false;
                scan();
            }, 500);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ===== 小テスト: 未解答の問題があるときに確認 =====
    function isAnswered(q) {
        const type = [
            "calculated", "calculatedmulti", "calculatedsimple", "ddimageortext", "ddmarker", "ddwtos", "description",
            "essay", "gapselect", "match", "multianswer", "multichoice", "numerical", "randomsamatch", "shortanswer",
            "truefalse", "multichoiceset",
        ].find((t) => q.classList.contains(t));
        const inputs = (sel) => [...q.querySelectorAll(sel)];
        switch (type) {
            case "calculated":
            case "calculatedsimple":
            case "numerical":
            case "shortanswer":
                return inputs("input[type=text]").every((e) => e.value !== "");
            case "calculatedmulti":
            case "multichoice":
            case "multichoiceset":
            case "truefalse":
                return inputs("input[type=radio]").some((e) => e.checked && e.value !== "-1") || inputs("input[type=checkbox]").some((e) => e.checked);
            case "ddmarker":
                return inputs(".ddform > input").some((e) => e.value !== "");
            case "ddimageortext":
            case "ddwtos":
                return inputs("input[type=hidden].placeinput").every((e) => e.value !== "0" && e.value !== "");
            case "gapselect":
                return inputs("select").every((e) => e.value !== "");
            case "match":
            case "randomsamatch":
                return inputs("select").every((e) => e.value !== "0");
            case "essay": {
                const atto = q.querySelector(".editor_atto_content");
                if (atto && (atto.innerText.trim() || atto.querySelector("img,audio,video"))) return true;
                const tiny = q.querySelector(".tox-tinymce iframe")?.contentDocument?.body;
                if (tiny && (tiny.innerText.trim() || tiny.querySelector("img,audio,video"))) return true;
                const ta = q.querySelector("textarea.qtype_essay_response");
                if (ta && ta.value.trim()) return true;
                const fm = q.querySelector(".filemanager");
                return Boolean(fm && !fm.classList.contains("fm-noitems"));
            }
            default:
                return true; // 判定できない種類は確認しない
        }
    }

    function remindUnanswered(onlySequential) {
        // 前に戻れない小テストでは、ナビゲーションの問題番号がリンクになっていない
        const sequential = !document.querySelector(".qn_buttons a.qnbutton") && !document.querySelector(".mod_quiz-prev-nav");
        if (onlySequential && !sequential) return;

        document.addEventListener(
            "click",
            (event) => {
                const button = event.target.closest?.(".mod_quiz-next-nav, input[name=next]");
                if (!button) return;
                const unanswered = [...document.querySelectorAll('div[id^="question-"]')].filter((q) => !isAnswered(q));
                if (unanswered.length === 0) return;
                const names = unanswered.map((q) => q.querySelector("h3")?.innerText?.replace(/\s+/g, " ").trim() ?? "問題").join("\n・");
                const message = sequential
                    ? `まだ解答していない問題があります。この小テストは前のページに戻れません。\n\n・${names}\n\nこのまま次へ進みますか？`
                    : `まだ解答していない問題があります。\n\n・${names}\n\nこのまま次へ進みますか？`;
                if (!confirm(message)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    unanswered[0].scrollIntoView({ behavior: "smooth", block: "center" });
                }
            },
            true
        );
    }

    // ===== 課題ファイル名の変更（ページ側スクリプトにテンプレートを渡す） =====
    function sendAssignmentFilenameTemplate(settings) {
        const courseLink = document.querySelector('.breadcrumb a[href*="/course/view.php?id="], nav a[href*="/course/view.php?id="]');
        const courseId = courseLink ? new URL(courseLink.href).searchParams.get("id") : null;
        const template = (courseId && settings.assignmentFilenameTemplateCourse[courseId]) || settings.assignmentFilenameTemplate;
        const course = (courseId && settings.courseNameOverrides[courseId]) || courseLink?.title || courseLink?.textContent?.trim() || "";
        const assignment = document.querySelector("h1, h2")?.textContent?.trim() ?? "";
        window.postMessage({ wmpAssignmentFilename: { template, args: { course, assignment } } }, location.origin);
    }

    // ===== ヘッダーのダークモード切り替えボタン =====
    const MOON =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const SUN =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';

    function darkModeToggle(settings) {
        const nav = document.getElementById("usernavigation");
        if (!nav || document.getElementById("wmp-dark-toggle")) return;

        const button = el("button", { id: "wmp-dark-toggle", type: "button", class: "nav-link wmp-dark-toggle" });
        const isDark = () => document.documentElement.classList.contains("wmp-dark");
        const update = () => {
            const dark = isDark();
            // 今がダークなら太陽（押すとライト）、ライトなら月（押すとダーク）を出す
            button.innerHTML = dark ? SUN : MOON;
            const label = dark ? "ライトモードに切り替える" : "ダークモードに切り替える";
            button.title = settings.darkMode === "auto" ? `${label}（今はシステムの設定に合わせています）` : label;
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", String(dark));
        };
        button.addEventListener("click", () => {
            // 反映はバックグラウンドが開いているすべてのタブに行う
            WMP.setSettings({ darkMode: isDark() ? "off" : "on" });
        });

        nav.prepend(el("div", { class: "wmp-dark-toggle-wrap" }, button));
        new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        WMP.onSettingsChanged((next) => {
            settings = next;
            if (!next.darkModeToggleInHeader) button.parentElement?.remove();
            update();
        });
        update();
    }

    WMP.initFeatures = function initFeatures(settings) {
        if (settings.darkModeToggleInHeader) darkModeToggle(settings);

        const sessionKey = WMP.findSessionKey();
        if (sessionKey) WMP.send("setSessionKey", { sessionKey }).catch(() => {});

        const path = location.pathname;
        if (sessionKey && settings.autoSessionExtension) autoSessionExtension(sessionKey);
        if (
            sessionKey &&
            settings.checkSessionBeforeSubmit &&
            (path.startsWith("/mod/quiz/attempt.php") || path.startsWith("/mod/assign/") || path.startsWith("/mod/forum/"))
        ) {
            checkSessionBeforeSubmit(sessionKey);
        }
        if (path.startsWith("/mod/assign/") && settings.checkNotesOnSubmitting) checkNotesOnSubmitting();
        if (settings.wordCounterEnabled) wordCounter();
        if (path.startsWith("/mod/quiz/attempt.php") && settings.remindUnansweredEnabled) {
            remindUnanswered(settings.remindUnansweredOnlySequential);
        }
        if (path.startsWith("/mod/assign/view.php") && settings.assignmentFilenameEnabled) {
            sendAssignmentFilenameTemplate(settings);
        }
    };

    WMP.toast = toast;
})();
