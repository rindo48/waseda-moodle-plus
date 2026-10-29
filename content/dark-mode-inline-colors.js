// ダークモード: 先生が本文に直接付けた色（マーカーの背景色・文字色）を暗い画面でも読めるようにする。
// 明るい背景色は同じ色合いの半透明に、暗い文字色は同じ色合いの明るい色に置き換える。
// 元の style には手を付けず、クラスと CSS 変数だけを付けるので、ライトモードに戻すと元の色に戻る。
(() => {
    // 設定変更でその場に差し込まれることがあるので、二重に動かさない
    if (globalThis.__wmpInlineColors) return;
    globalThis.__wmpInlineColors = true;

    const ROOT = "#page-content";
    // 拡張機能自身の部品や、Moodle が色で意味を表している部品は対象外
    const SKIP = '[class*="wmp-"]:not(html, body, .wmp-dark-bg, .wmp-dark-fg), .progress, .badge, .btn, [class*="calendar"], [data-region="event-item"]';
    const TARGETS = "[style], [bgcolor], font[color]";

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

    function apply(el) {
        if (el.closest(SKIP)) return;

        const bg = parseColor(el.style.backgroundColor || el.getAttribute("bgcolor"));
        if (bg && bg[3] > 0.5 && luminance(bg) > 0.35) {
            const [, s] = toHsl(bg);
            // 白・薄い灰色の背景はほぼ消し、色の付いたマーカーは色合いを残して半透明にする
            const dark = s < 0.15 ? "rgba(255, 255, 255, 0.05)" : `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.28)`;
            el.style.setProperty("--wmp-dark-bg", dark);
            el.classList.add("wmp-dark-bg");
        }

        const fg = parseColor(el.style.color || (el.tagName === "FONT" ? el.getAttribute("color") : ""));
        if (fg && luminance(fg) < 0.2) {
            const [h, s] = toHsl(fg);
            // 黒・灰色の文字は通常の文字色に、色付きの文字は同じ色合いのまま明るくする
            const light = s < 0.15 ? "var(--wmpd-text)" : `hsl(${Math.round(h)}, ${Math.round(Math.min(s, 0.8) * 100)}%, 75%)`;
            el.style.setProperty("--wmp-dark-fg", light);
            el.classList.add("wmp-dark-fg");
        }
    }

    function scan(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const root = node.closest?.(ROOT) ?? node.querySelector?.(ROOT);
        if (!root) return;
        const scope = node.closest(ROOT) ? node : root;
        if (scope.matches(TARGETS)) apply(scope);
        scope.querySelectorAll(TARGETS).forEach(apply);
    }

    // 本文の多くは後から読み込まれる（折りたたみのセクションなど）ので、追加された要素も見る
    new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach(scan);
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState !== "loading") scan(document.body);
})();
