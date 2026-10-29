// ツールバーアイコンのポップアップ: 締切が近い課題などの一覧。

(async () => {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    const body = document.getElementById("body");
    const updated = document.getElementById("updated");
    const search = document.getElementById("search");
    const refreshButton = document.getElementById("refresh");

    let settings = await WMP.getSettings();
    WMP.applyUiTheme(settings);

    let events = null;
    let kind = "";
    let lastError = null;

    document.getElementById("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
    document.querySelectorAll("[data-launch]").forEach((a) =>
        a.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.runtime.getURL(`pages/launcher.html?target=${a.dataset.launch}`) });
        })
    );
    // ポップアップ内のリンクは新しいタブで開く（ポップアップ内で遷移しないように）
    document.addEventListener("click", (e) => {
        const a = e.target.closest("a[href^='http']");
        if (!a) return;
        e.preventDefault();
        chrome.tabs.create({ url: a.href });
        window.close();
    });

    document.querySelectorAll("#kind-filter button").forEach((button) =>
        button.addEventListener("click", () => {
            kind = button.dataset.kind;
            document.querySelectorAll("#kind-filter button").forEach((b) => b.classList.toggle("is-active", b === button));
            render();
        })
    );
    search.addEventListener("input", render);
    refreshButton.addEventListener("click", () => load(true));

    WMP.onSettingsChanged((next) => {
        settings = next;
        load(false);
    });

    function filtered() {
        if (!kind) return events;
        if (kind === "other") return events.filter((e) => e.modulename !== "assign" && e.modulename !== "quiz");
        return events.filter((e) => e.modulename === kind);
    }

    function render() {
        if (!events) return;
        const children = [];
        if (lastError) {
            children.push(el("div", { class: "wmp-error pp-stale" }, `最新の情報を取得できませんでした（${lastError}）。前回取得した内容を表示しています。`));
        }
        children.push(
            WMP.renderTimeline(filtered(), settings, {
                filter: search.value,
                onHide: (e) => WMP.hideEvent(e),
            })
        );
        body.replaceChildren(...children);
    }

    function renderLoginRequired(hasLoginInfo) {
        body.replaceChildren(
            el(
                "div",
                { class: "pp-login" },
                el("strong", {}, "Waseda Moodle にログインしていません"),
                el(
                    "p",
                    {},
                    hasLoginInfo
                        ? "自動ログインに失敗しました。Moodle を開いて手動でログインしてください。"
                        : "Moodle にログインすると課題の一覧が表示されます。自動ログインを設定すると、ログインの手間が省けます。"
                ),
                el(
                    "div",
                    { class: "row" },
                    el("a", { class: "wmp-btn is-primary", href: "https://wsdmoodle.waseda.jp/my/" }, "Moodle を開く"),
                    hasLoginInfo
                        ? null
                        : el("button", { class: "wmp-btn", onclick: () => chrome.runtime.openOptionsPage() }, "自動ログインを設定")
                )
            )
        );
    }

    async function load(force) {
        refreshButton.disabled = true;
        if (force || !events) body.replaceChildren(el("div", { class: "pp-loading" }, el("div", { class: "wmp-spinner" })));
        try {
            const result = await WMP.send("getTimeline", { force });
            events = result.value;
            lastError = result.error ?? null;
            updated.textContent = `${WMP.timeFormat.format(new Date(result.timestamp))} 時点`;
            render();
            WMP.send("updateBadge").catch(() => {});
        } catch (e) {
            if (/ログインしていません|ログイン情報/.test(e.message)) {
                const status = await WMP.send("getLoginStatus").catch(() => ({}));
                renderLoginRequired(status.hasLoginInfo);
            } else {
                body.replaceChildren(el("div", { class: "wmp-error" }, `読み込みに失敗しました: ${e.message}`));
            }
        } finally {
            refreshButton.disabled = false;
        }
    }

    if (!settings.timelineEnabled) {
        body.replaceChildren(
            el(
                "div",
                { class: "pp-login" },
                el("p", {}, "課題一覧は設定でオフになっています。"),
                el("button", { class: "wmp-btn", onclick: () => chrome.runtime.openOptionsPage() }, "設定を開く")
            )
        );
        return;
    }

    search.focus();
    load(false);
})();
