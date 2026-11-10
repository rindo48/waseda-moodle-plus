// 授業動画のファイル・配信ストリーム（mp4 / m3u8 / mpd など）の URL を一覧にして、コピーできるようにする。
// learningx（コースビルダー）などの動画プレーヤーは、ページ（または iframe）が読み込んだ通信に動画の URL が出てくるので、
// Resource Timing（performance のリソース記録）と <video> / <source> の src から拾う。追加の権限は要らない。
// 見つかったフレームの、動画プレーヤーのタイトルの右に「動画のURL」ボタンを出し、押すと一覧が開く。
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
    // ボタンは動画プレーヤーのタイトルのすぐ右に入れる（タイトルが見つからないときだけフレームの左下に浮かせる）。
    // 一覧はタイトル側の overflow や transform に影響されないよう、body 直下の別の要素に出す。
    let btnHost = null;
    let toggleBtn = null;
    let panelHost = null;
    let panelShadow = null;
    let panel = null;
    let listEl = null;

    const FONT = `font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;`;

    const BTN_CSS = `
        :host { all: initial; display: inline-block; vertical-align: middle; margin-left: 12px; color: inherit; line-height: 1; }
        :host([data-flex]) { flex: none; margin-right: auto; }
        :host([data-float]) { position: fixed; left: 12px; bottom: 12px; margin: 0; z-index: 2147483000; color: #fff; }
        button {
            ${FONT} font-size: 12px; line-height: 1.3; color: inherit; cursor: pointer; white-space: nowrap;
            background: transparent; border: 1px solid currentColor; border-radius: 2px;
            padding: 3px 8px; opacity: .75; transition: opacity .15s;
        }
        :host([data-float]) button { background: #1a1a1a; border-color: #1a1a1a; opacity: .55; }
        button:hover, button:focus-visible, button[aria-expanded="true"] { opacity: 1; }
        .n { margin-left: 6px; padding-left: 6px; border-left: 1px solid currentColor; font-variant-numeric: tabular-nums; }
    `;

    const PANEL_CSS = `
        :host { all: initial; }
        .panel {
            position: fixed; z-index: 2147483001;
            ${FONT} font-size: 13px; line-height: 1.45; color: #1a1a1a;
            background: #fff; border: 1px solid #1a1a1a; border-radius: 2px;
            box-shadow: 0 2px 10px rgba(0,0,0,.18);
            width: min(560px, calc(100vw - 24px)); overflow-y: auto; overflow-x: hidden;
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
            ${FONT} cursor: pointer; background: #fff; border: 1px solid #888; border-radius: 2px; padding: 2px 8px;
            font-size: 12px; color: #1a1a1a; text-decoration: none;
        }
        .actions button:hover, .actions a:hover { border-color: #1a1a1a; }
        .actions button.done { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
        .note { padding: 8px 10px; color: #666; font-size: 12px; overflow-wrap: anywhere; border-top: 1px solid #d0d0d0; }
        @media (prefers-color-scheme: dark) {
            .panel { color: #eee; background: #1e1e1e; border-color: #666; }
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

    /** ボタン・一覧へのクリックやキー操作が、プレーヤー側（再生・一時停止のショートカットなど）に伝わらないようにする */
    function isolate(el) {
        for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress"]) {
            el.addEventListener(type, (e) => e.stopPropagation());
        }
    }

    function build() {
        btnHost = document.createElement("wmp-video-url");
        const bs = btnHost.attachShadow({ mode: "closed" });
        const bStyle = document.createElement("style");
        bStyle.textContent = BTN_CSS;
        toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.setAttribute("aria-haspopup", "dialog");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.addEventListener("click", () => setOpen(panel.hidden));
        bs.append(bStyle, toggleBtn);

        panelHost = document.createElement("wmp-video-url-panel");
        panelShadow = panelHost.attachShadow({ mode: "closed" });
        const pStyle = document.createElement("style");
        pStyle.textContent = PANEL_CSS;
        panel = document.createElement("div");
        panel.className = "panel";
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
        panelShadow.append(pStyle, panel);

        const onKey = (e) => {
            if (e.key === "Escape" && !panel.hidden) {
                setOpen(false);
                toggleBtn.focus();
            }
        };
        btnHost.addEventListener("keydown", onKey);
        panelHost.addEventListener("keydown", onKey);
        isolate(btnHost);
        isolate(panelHost);
        // 外側のクリックで閉じる（ボタン・一覧の中のクリックは isolate で止まるのでここには来ない）
        document.addEventListener("pointerdown", () => !panel.hidden && setOpen(false));
        addEventListener("resize", () => !panel.hidden && positionPanel());
        addEventListener("scroll", () => !panel.hidden && positionPanel(), true);
    }

    function setOpen(open) {
        panel.hidden = !open;
        toggleBtn.setAttribute("aria-expanded", String(open));
        if (open) positionPanel();
    }

    /** 一覧をボタンのすぐ下（下に入らなければ上）に出す */
    function positionPanel() {
        const r = toggleBtn.getBoundingClientRect();
        const margin = 12;
        const width = Math.min(560, innerWidth - margin * 2);
        const left = Math.max(margin, Math.min(r.left, innerWidth - width - margin));
        const below = innerHeight - r.bottom - 6 - margin;
        const above = r.top - 6 - margin;
        panel.style.left = `${left}px`;
        if (below >= 200 || below >= above) {
            panel.style.top = `${r.bottom + 6}px`;
            panel.style.bottom = "";
            panel.style.maxHeight = `${Math.min(420, below)}px`;
        } else {
            panel.style.top = "";
            panel.style.bottom = `${innerHeight - r.top + 6}px`;
            panel.style.maxHeight = `${Math.min(420, above)}px`;
        }
    }

    /** いちばん大きく表示されている <video> */
    function mainVideo() {
        let best = null;
        let bestArea = 0;
        for (const v of document.querySelectorAll("video")) {
            const r = v.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) {
                best = v;
                bestArea = area;
            }
        }
        return best;
    }

    /**
     * 動画プレーヤーのタイトルの要素を探す。
     * 動画の上端の近く（プレーヤー上部のタイトルバー、またはそのすぐ上）にあって左寄せの、文字を直接持つ要素のうち、
     * 動画の上端にいちばん近いもの。
     */
    function findTitle() {
        const video = mainVideo();
        if (!video) return null;
        const vr = video.getBoundingClientRect();
        if (vr.width < 160) return null;
        let best = null;
        let bestDist = Infinity;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.nodeValue.trim().length >= 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const el = t.parentElement;
            if (!el || el.closest("button, a, script, style, select, option, label, input, textarea")) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.height > 80) continue;
            if (r.bottom > vr.top + 80 || r.top < vr.top - 120) continue;
            if (r.left < vr.left - 40 || r.left > vr.left + vr.width / 2) continue;
            if (/^[\d:\s/.]+$/.test(t.nodeValue.trim())) continue; // 再生時間などの数字だけの表示
            const dist = Math.abs(r.top - vr.top);
            if (dist < bestDist) {
                best = el;
                bestDist = dist;
            }
        }
        return best;
    }

    let placedIn = null;
    function place() {
        if (!panelHost.isConnected) document.body.append(panelHost);
        if (placedIn?.isConnected && btnHost.isConnected) return; // 一度入れたら、タイトルが消えるまで動かさない
        const title = findTitle();
        if (title) {
            btnHost.removeAttribute("data-float");
            // ふつうはタイトルの文末に入れる。タイトルが長い名前を「…」で切る箱（overflow: hidden）だとボタンも切れるので、
            // そのときはタイトルの隣に入れ、margin-right: auto で右側のアイコン類から離してタイトルに寄せる
            const clips = getComputedStyle(title).overflow !== "visible";
            const parentDisplay = title.parentElement ? getComputedStyle(title.parentElement).display : "";
            if (clips && /flex/.test(parentDisplay)) {
                btnHost.setAttribute("data-flex", "");
                title.after(btnHost);
            } else {
                btnHost.removeAttribute("data-flex");
                title.append(btnHost);
            }
            placedIn = title;
        } else if (!btnHost.isConnected || btnHost.parentNode !== document.body) {
            btnHost.setAttribute("data-float", "");
            document.body.append(btnHost);
            placedIn = null;
        }
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
            panelShadow.append(ta);
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
            btnHost?.remove();
            panelHost?.remove();
            placedIn = null;
            return;
        }
        if (!btnHost) build();
        place();

        const n = document.createElement("span");
        n.className = "n";
        n.textContent = String(found.size);
        toggleBtn.replaceChildren("動画のURL", n);

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
    // プレーヤーのタイトルバーは動画より後に描かれることがあるので、DOM が変わったらボタンの置き場所も見直す
    let scanQueued = false;
    new MutationObserver(() => {
        if (scanQueued) return;
        scanQueued = true;
        setTimeout(() => {
            scanQueued = false;
            scanVideos();
            if (btnHost && found.size && settings.videoUrlCopy) place();
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
