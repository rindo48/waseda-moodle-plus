// 授業動画のファイル・配信ストリーム（mp4 / m3u8 / mpd など）の URL を一覧にして、コピーできるようにする。
// learningx（コースビルダー）などの動画プレーヤーは、ページ（または iframe）が読み込んだ通信に動画の URL が出てくるので、
// Resource Timing（performance のリソース記録）と <video> / <source> の src から拾う。追加の権限は要らない。
// 見つかったフレームの左下に「動画のURL」ボタンを出し、押すと一覧が開く。
(async () => {
    if (globalThis.__wmpVideoUrl) return;
    globalThis.__wmpVideoUrl = true;

    const WMP = globalThis.WMP;
    let settings = await WMP.getSettings();

    /** 動画本体・ストリームのマニフェストとみなす拡張子（.ts / .m4s などの断片は数が多いので拾わない） */
    const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)$/i;
    /** 大学のイントロ・読み込み中の動画・この拡張機能の差し替え用動画は本編ではないので除く */
    const IGNORE = /\/settings\/viewer\/uniplayer\/|(^|\/)(intro|preloader|dummy-video)\.mp4$/i;

    /** url -> { url, name, kind } 見つけた順 */
    const found = new Map();

    function kindOf(path) {
        if (/\.m3u8$/i.test(path)) return "HLS";
        if (/\.mpd$/i.test(path)) return "DASH";
        const ext = path.match(/\.([a-z0-9]+)$/i)?.[1];
        return ext ? ext.toUpperCase() : "動画";
    }

    function add(raw, fromVideoElement = false) {
        if (!raw) return;
        let u;
        try {
            u = new URL(raw, location.href);
        } catch {
            return;
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") return; // blob: や拡張機能の URL は貼っても使えない
        if (!fromVideoElement && !MEDIA_EXT.test(u.pathname)) return;
        if (IGNORE.test(u.pathname)) return;
        u.hash = "";
        const url = u.href;
        if (found.has(url)) return;
        const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
        found.set(url, { url, name, kind: kindOf(u.pathname) });
        render();
    }

    function scanVideos() {
        for (const v of document.querySelectorAll("video, audio")) {
            add(v.currentSrc, true);
            add(v.getAttribute("src"), true);
            for (const s of v.querySelectorAll("source[src]")) add(s.getAttribute("src"), true);
        }
    }

    // ===== 画面 =====
    let host = null;
    let shadow = null;
    let listEl = null;
    let toggleBtn = null;
    let panel = null;

    const CSS = `
        :host { all: initial; }
        .wrap {
            position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;
            font: 13px/1.45 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
            color: #1a1a1a;
            display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
        }
        button { font: inherit; color: inherit; cursor: pointer; }
        .toggle {
            background: #1a1a1a; color: #fff; border: 1px solid #1a1a1a; border-radius: 2px;
            padding: 5px 10px; opacity: .55; transition: opacity .15s;
        }
        .toggle:hover, .toggle:focus-visible, .toggle[aria-expanded="true"] { opacity: 1; }
        .toggle .n { margin-left: 6px; padding-left: 6px; border-left: 1px solid rgba(255,255,255,.4); font-variant-numeric: tabular-nums; }
        .panel {
            background: #fff; border: 1px solid #1a1a1a; border-radius: 2px;
            box-shadow: 0 2px 10px rgba(0,0,0,.18);
            width: min(560px, calc(100vw - 24px)); max-height: min(60vh, 420px); overflow-y: auto; overflow-x: hidden;
        }
        .panel[hidden] { display: none; }
        .head {
            display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
            padding: 8px 10px; border-bottom: 1px solid #d0d0d0; font-weight: 600;
        }
        .head small { font-weight: 400; color: #666; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding: 8px 10px; border-bottom: 1px solid #ececec; }
        li:last-child { border-bottom: 0; }
        .name { font-weight: 600; overflow-wrap: anywhere; }
        .kind { font-weight: 400; color: #666; margin-left: 6px; font-size: 12px; }
        .url {
            grid-column: 1 / -1; font: 11px/1.4 ui-monospace, Consolas, monospace; color: #444;
            overflow-wrap: anywhere; user-select: all; max-height: 4.2em; overflow: hidden;
        }
        .actions { display: flex; gap: 6px; align-self: start; }
        .actions button, .actions a {
            background: #fff; border: 1px solid #888; border-radius: 2px; padding: 2px 8px;
            font-size: 12px; color: #1a1a1a; text-decoration: none;
        }
        .actions button:hover, .actions a:hover { border-color: #1a1a1a; }
        .actions button.done { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
        .note { padding: 8px 10px; color: #666; font-size: 12px; overflow-wrap: anywhere; border-top: 1px solid #d0d0d0; }
        @media (prefers-color-scheme: dark) {
            .wrap { color: #eee; }
            .toggle { background: #eee; color: #111; border-color: #eee; }
            .toggle .n { border-left-color: rgba(0,0,0,.3); }
            .panel { background: #1e1e1e; border-color: #666; }
            .head { border-bottom-color: #444; }
            .head small, .kind, .note { color: #aaa; }
            li { border-bottom-color: #333; }
            .url { color: #bbb; }
            .actions button, .actions a { background: #1e1e1e; color: #eee; border-color: #777; }
            .actions button:hover, .actions a:hover { border-color: #eee; }
            .actions button.done { background: #eee; color: #111; border-color: #eee; }
            .note { border-top-color: #444; }
        }
    `;

    function build() {
        host = document.createElement("wmp-video-url");
        shadow = host.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent = CSS;
        const wrap = document.createElement("div");
        wrap.className = "wrap";

        panel = document.createElement("div");
        panel.className = "panel";
        panel.id = "panel";
        panel.hidden = true;
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "動画のURL");
        const head = document.createElement("div");
        head.className = "head";
        head.innerHTML = "<span>動画のURL</span><small>Waseda Moodle Plus</small>";
        listEl = document.createElement("ul");
        const note = document.createElement("div");
        note.className = "note";
        note.textContent =
            "URL には期限付きの認証情報が含まれることがあり、時間がたつと開けなくなる場合があります。HLS（.m3u8）は VLC や ffmpeg などで開けます。";
        panel.append(head, listEl, note);

        toggleBtn = document.createElement("button");
        toggleBtn.className = "toggle";
        toggleBtn.type = "button";
        toggleBtn.setAttribute("aria-controls", "panel");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.addEventListener("click", () => setOpen(panel.hidden));

        wrap.append(panel, toggleBtn);
        shadow.append(style, wrap);

        shadow.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !panel.hidden) {
                setOpen(false);
                toggleBtn.focus();
            }
        });
        document.addEventListener("pointerdown", (e) => {
            if (!panel.hidden && !e.composedPath().includes(host)) setOpen(false);
        });
    }

    function setOpen(open) {
        panel.hidden = !open;
        toggleBtn.setAttribute("aria-expanded", String(open));
    }

    async function copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // iframe の中などで Clipboard API が許可されていないとき
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
            shadow.append(ta);
            ta.select();
            let ok = false;
            try {
                ok = document.execCommand("copy");
            } catch {}
            ta.remove();
            return ok;
        }
    }

    function render() {
        if (!settings.videoUrlCopy || found.size === 0 || !document.body) {
            host?.remove();
            return;
        }
        if (!host) build();
        if (!host.isConnected) document.body.append(host);

        toggleBtn.innerHTML = "";
        toggleBtn.append("動画のURL");
        const n = document.createElement("span");
        n.className = "n";
        n.textContent = String(found.size);
        toggleBtn.append(n);

        listEl.replaceChildren(
            ...[...found.values()].map((item) => {
                const li = document.createElement("li");
                const name = document.createElement("div");
                name.className = "name";
                name.textContent = item.name;
                const kind = document.createElement("span");
                kind.className = "kind";
                kind.textContent = item.kind;
                name.append(kind);

                const actions = document.createElement("div");
                actions.className = "actions";
                const copyBtn = document.createElement("button");
                copyBtn.type = "button";
                copyBtn.textContent = "コピー";
                copyBtn.addEventListener("click", async () => {
                    const ok = await copy(item.url);
                    copyBtn.textContent = ok ? "コピーしました" : "コピーできませんでした";
                    copyBtn.classList.toggle("done", ok);
                    setTimeout(() => {
                        copyBtn.textContent = "コピー";
                        copyBtn.classList.remove("done");
                    }, 1600);
                });
                const open = document.createElement("a");
                open.href = item.url;
                open.target = "_blank";
                open.rel = "noopener noreferrer";
                open.textContent = "開く";
                actions.append(copyBtn, open);

                const url = document.createElement("div");
                url.className = "url";
                url.textContent = item.url;
                url.title = item.url;

                li.append(name, actions, url);
                return li;
            })
        );
    }

    // ===== 見張り =====
    try {
        const po = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) add(e.name);
        });
        po.observe({ type: "resource", buffered: true });
    } catch {
        for (const e of performance.getEntriesByType("resource")) add(e.name);
    }

    scanVideos();
    // <video> の src は再生前後に差し替わることがあるので、読み込みの開始を拾う
    document.addEventListener("loadstart", (e) => e.target instanceof HTMLMediaElement && scanVideos(), true);
    document.addEventListener("loadedmetadata", (e) => e.target instanceof HTMLMediaElement && scanVideos(), true);
    let scanQueued = false;
    new MutationObserver(() => {
        if (scanQueued) return;
        scanQueued = true;
        setTimeout(() => {
            scanQueued = false;
            scanVideos();
        }, 300);
    }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
    });

    WMP.onSettingsChanged((next, keys) => {
        settings = next;
        if (keys.includes("videoUrlCopy")) render();
    });
})();
