// ダークモード: 本文の中で暗い画面だと読めなくなる色を直す。
//
// 1. 先生が本文に直接付けた色（style 属性・<font color>）: 明るい背景色は同じ色合いの半透明に、暗い文字色は同じ色合いの明るい色に置き換える
// 2. それ以外で付いた色（ページ内の <style>、MathJax が描いた数式など）: 実際に表示される文字色と背景色を比べ、読みにくいものだけ明るくする
// 3. 背景が透明で黒い線だけの画像（数式の画像など）: 色を反転して明るい線にする
//
// 元の style には手を付けず、クラスと CSS 変数だけを付けるので、ライトモードに戻すと元の色に戻る。
// 入力中の本文（contenteditable）には何もしない。付けたクラスが提出内容に入ってしまうため。
(() => {
    // 設定変更でその場に差し込まれることがあるので、二重に動かさない
    if (globalThis.__wmpInlineColors) return;
    globalThis.__wmpInlineColors = true;

    const ROOT = "#page-content";
    // 拡張機能自身の部品（.wmp-scope）や、Moodle が色で意味を表している部品は対象外。
    // 新デザインが Moodle の本文に付けるクラス（.wmp-notice など）は対象のままにする
    const SKIP = '.wmp-scope, .wmp-toast, .wmp-word-counter, .progress, .badge, .btn, [class*="calendar"], [data-region="event-item"]';
    const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
    const TARGETS = "[style], [bgcolor], font[color]";
    // 文字を直接持たないが、色が中身（SVG の currentColor など）に効く数式の入れ物
    const MATH = "svg, mjx-container, math, .MathJax, .MathJax_SVG, .MathJax_CHTML, .MathJax_Display";
    // 読みにくいとみなすコントラスト比（WCAG で大きな文字に求める 3:1 未満）
    const MIN_CONTRAST = 3;
    const FALLBACK_BG = [18, 19, 22, 1];

    const ctx = document.createElement("canvas").getContext("2d");

    /** CSS の色（#hex / rgb() / 色名）→ [r, g, b, a]。読めなければ null */
    function parseColor(value) {
        if (!value || /^(transparent|inherit|initial|unset|currentcolor|var\()/i.test(value.trim())) return null;
        ctx.fillStyle = "#010203";
        ctx.fillStyle = value;
        const v = ctx.fillStyle;
        if (v === "#010203" && !/^#010203$/i.test(value.trim())) return null;
        if (v.startsWith("#")) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
        const m = v.match(/[\d.]+/g);
        return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null;
    }

    function luminance([r, g, b]) {
        const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    function contrast(a, b) {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    }

    function toHsl([r, g, b]) {
        (r /= 255), (g /= 255), (b /= 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h * 60, s, l];
    }

    const skipped = (el) => Boolean(el.closest(SKIP) || el.closest(EDITABLE));
    const isDark = () => document.documentElement.classList.contains("wmp-dark");

    /** 暗い文字色を、黒・灰色なら通常の文字色に、色付きなら同じ色合いのまま明るくする */
    function lighten(el, fg) {
        const [h, s] = toHsl(fg);
        const light = s < 0.15 ? "var(--wmpd-text, #e6e8eb)" : `hsl(${Math.round(h)}, ${Math.round(Math.min(s, 0.8) * 100)}%, 75%)`;
        el.style.setProperty("--wmp-dark-fg", light);
        el.classList.add("wmp-dark-fg");
    }

    // ===== 1. style 属性・<font color> で付いた色 =====

    function applyInline(el) {
        if (skipped(el)) return;

        const bg = parseColor(el.style.backgroundColor || el.getAttribute("bgcolor"));
        if (bg && bg[3] > 0.5 && luminance(bg) > 0.35) {
            const [, s] = toHsl(bg);
            // 白・薄い灰色の背景はほぼ消し、色の付いたマーカーは色合いを残して半透明にする
            const dark = s < 0.15 ? "rgba(255, 255, 255, 0.05)" : `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.28)`;
            el.style.setProperty("--wmp-dark-bg", dark);
            el.classList.add("wmp-dark-bg");
        }

        const fg = parseColor(el.style.color || (el.tagName === "FONT" ? el.getAttribute("color") : ""));
        if (fg && luminance(fg) < 0.2) lighten(el, fg);
    }

    // ===== 2. 実際に表示される色で読みにくいもの =====

    /** その要素の後ろに見えている背景色（透明なら親をたどる） */
    // 1回の見直しの間だけ、要素ごとの背景色を覚えておく（同じ親を何度もたどらないように）
    let bgMemo = new Map();
    function backgroundOf(el) {
        const path = [];
        let found = FALLBACK_BG;
        for (let e = el; e && e.nodeType === Node.ELEMENT_NODE; e = e.parentElement) {
            if (bgMemo.has(e)) {
                found = bgMemo.get(e);
                break;
            }
            path.push(e);
            const c = parseColor(getComputedStyle(e).backgroundColor);
            if (c && c[3] > 0.5) {
                found = c;
                break;
            }
        }
        for (const e of path) bgMemo.set(e, found);
        return found;
    }

    // ===== 札（.badge）: 背景ごと読めなくなっているものを付け直す =====
    // 完了状態の札などは Moodle の版でクラス名が変わり、CSS だけでは追いきれないので、表示された色で判断する
    function checkBadge(el) {
        if (el.classList.contains("wmp-dark-badge") || el.closest(".wmp-scope")) return;
        const cs = getComputedStyle(el);
        const fg = parseColor(cs.color);
        if (!fg) return;
        const bg = backgroundOf(el);
        if (contrast(fg, bg) >= 4) return;
        // 緑っぽい札（完了・成功）は緑、赤っぽい札は赤、それ以外は一段明るい面にする
        const sample = parseColor(cs.backgroundColor);
        // 背景に色があればその色、黒・灰色なら文字の色で、緑か赤かを見る
        const tint = sample && sample[3] > 0.05 && toHsl(sample)[1] > 0.15 ? sample : fg;
        const [h, s] = toHsl(tint);
        const kind = /success/.test(el.className) || (s > 0.2 && h > 80 && h < 170) ? "ok" : /danger|fail/.test(el.className) || (s > 0.3 && (h < 15 || h > 340)) ? "ng" : "plain";
        return () => el.classList.add("wmp-dark-badge", `is-${kind}`);
    }

    function checkContrast(el) {
        if (el.classList.contains("wmp-dark-fg") || skipped(el)) return;
        const fg = parseColor(getComputedStyle(el).color);
        if (!fg || fg[3] < 0.4) return;
        const bg = backgroundOf(el);
        // 先生が明るい背景の箱を作っていて、その中が暗い文字なら読めるので触らない
        if (luminance(bg) > 0.4) return;
        if (contrast(fg, bg) >= MIN_CONTRAST) return;
        return () => lighten(el, fg);
    }

    /** 文字を直接持つ要素と、数式の入れ物を集める */
    function textElements(scope) {
        const found = new Set();
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (/\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const parent = n.parentElement;
            if (parent && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION)$/.test(parent.tagName)) found.add(parent);
        }
        if (scope.matches?.(MATH)) found.add(scope);
        scope.querySelectorAll(MATH).forEach((m) => found.add(m));
        return found;
    }

    // ===== 3. 背景が透明で黒い線だけの画像 =====

    const checkedImages = new WeakSet();
    const IMAGE_SKIP = ".icon, .activityicon, .userpicture, .courseimage, .emoticon";

    function checkImage(img) {
        if (checkedImages.has(img) || img.matches(IMAGE_SKIP) || skipped(img)) return;
        if (!img.complete || !img.naturalWidth) {
            img.addEventListener("load", () => checkImage(img), { once: true });
            return;
        }
        checkedImages.add(img);
        // 別のサイトの画像は中身を読めない（読もうとすると例外になる）ので対象外
        let url;
        try {
            url = new URL(img.currentSrc || img.src, location.href);
        } catch {
            return;
        }
        if (url.origin !== location.origin && url.protocol !== "data:") return;

        const scale = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext("2d", { willReadFrequently: true });
        let data;
        try {
            c.drawImage(img, 0, 0, w, h);
            data = c.getImageData(0, 0, w, h).data;
        } catch {
            return;
        }
        let transparent = 0, opaque = 0, dark = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 32) {
                transparent++;
                continue;
            }
            opaque++;
            if (luminance([data[i], data[i + 1], data[i + 2]]) < 0.15) dark++;
        }
        const total = transparent + opaque;
        // ほとんどが透明で、描かれている部分のほとんどが黒っぽい = 黒い線画・数式
        if (total > 0 && transparent / total > 0.4 && opaque > 0 && dark / opaque > 0.6) img.classList.add("wmp-dark-invert");
    }

    // ===== 実行 =====

    function scan(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const root = node.closest?.(ROOT) ?? node.querySelector?.(ROOT);
        if (!root) return;
        const scope = node.closest(ROOT) ? node : root;
        if (scope.matches(TARGETS)) applyInline(scope);
        scope.querySelectorAll(TARGETS).forEach(applyInline);
        if (!isDark()) return; // 2・3 は表示された色を見るので、暗い画面のときだけ
        // 先に全部の色を読んでから、まとめて書き換える（読む・書くを交互にすると、そのたびに色の計算がやり直しになる）
        bgMemo = new Map();
        const writes = [];
        for (const el of textElements(scope)) writes.push(checkContrast(el));
        const badges = [...scope.querySelectorAll(".badge")];
        if (scope.matches?.(".badge")) badges.push(scope);
        for (const el of badges) writes.push(checkBadge(el));
        bgMemo = new Map();
        for (const write of writes) write?.();
        if (scope.tagName === "IMG") checkImage(scope);
        scope.querySelectorAll("img").forEach(checkImage);
    }

    // 本文の多くは後から読み込まれる（折りたたみのセクション・MathJax の数式など）ので、追加された要素もまとめて見る
    const pending = new Set();
    let timer = 0;
    function queue(node) {
        pending.add(node);
        if (timer) return;
        timer = setTimeout(() => {
            timer = 0;
            const nodes = new Set(pending);
            pending.clear();
            // 他の追加要素の中にあるものは、外側を見れば足りる（親をたどって確かめる。全部の組み合わせを比べると数が多いとき遅い）
            const covered = (n) => {
                for (let p = n.parentElement; p; p = p.parentElement) if (nodes.has(p)) return true;
                return false;
            };
            for (const n of nodes) if (n.isConnected && !covered(n)) scan(n);
        }, 150);
    }

    new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && queue(n));
    }).observe(document.documentElement, { childList: true, subtree: true });

    // 「システムに合わせる」で途中から暗くなったときや、ヘッダーのボタンで切り替えたときにも見直す
    let wasDark = isDark();
    new MutationObserver(() => {
        const dark = isDark();
        if (dark && !wasDark && document.body) queue(document.body);
        wasDark = dark;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    if (document.readyState !== "loading") scan(document.body);
    else document.addEventListener("DOMContentLoaded", () => scan(document.body), { once: true });
})();
