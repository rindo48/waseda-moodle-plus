// Moodle のアクセシビリティ（右下の人のボタン = local_accessibility プラグイン）の設定を、
// 拡張機能が足した部品やダークモードにも効かせる。
//
// プラグインの効かせ方は2通りある:
// - <body> にクラスを付け（accessibility-fontsize-125 など）、`body.クラス *` の CSS で効かせる
//   → 拡張機能の CSS のほうが強い（詳細度が高い・!important）ところでは負けて効かない
// - 背景色・文字色は、その時ページにある全要素の style に直接書き込む（保存済みならクラス + !important の CSS）
//   → 後から描き直した部品には付かず、ダークモードの !important にも負ける
//
// そこで、今の設定を <body> のクラスと見本の要素から読み取り、どの CSS よりも強い規則として書き直す。
// 文字の大きさだけは、全部の文字を同じ大きさにするプラグインのやり方だと新デザインの見出しと本文の差が消え、
// 決まった高さの部品からはみ出すので、新デザインでは本文の領域ごと拡大する（見出しと本文の比率を保つ）。
(() => {
    if (globalThis.__wmpA11yBridge) return;
    globalThis.__wmpA11yBridge = true;

    const root = document.documentElement;
    const body = document.body;
    if (!body) return;

    // ID 3つ分の詳細度を足して、拡張機能・Moodle のどの規則よりも強くする（ID は実在しなくてよい）
    const STRONG = ":root:not(#wmp-a11y-1#wmp-a11y-2#wmp-a11y-3)";
    // プラグイン自身が背景色を付けない要素（動画・数式・小テストの番号ボタン・画像）
    const BG_EXCLUDE = ".mediaplugin, .mediaplugin *, .qnbutton *, .filter_mathjaxloader_equation *, img, #wmp-a11y-probe";
    const FONTS = { serif: "none", sansserif: "sans-serif", dyslexic: "opendyslexic" };
    const FONTSIZE = /^accessibility-fontsize-(\d+)$/;

    const style = document.createElement("style");
    style.id = "wmp-a11y-bridge";
    (document.head || root).append(style);

    // 背景色・文字色を読み取るための見本。プラグインは body の全要素に色を書き込むので、これにも同じ色が付く
    const probe = document.createElement("div");
    probe.id = "wmp-a11y-probe";
    probe.hidden = true;
    body.append(probe);

    // 新デザインで外したプラグインの文字の大きさのクラス（旧デザインに戻したら付け直す）
    let strippedFontsize = null;

    const isNew = () => root.classList.contains("wmp-new");
    const valueOf = (prefix) => {
        for (const c of body.classList) if (c.startsWith(prefix)) return c.slice(prefix.length);
        return null;
    };
    /** 色の設定が有効か: 保存済みならクラス、その場で変えたなら data-default-* が body に付く */
    const colourOn = (cls, attr) => body.classList.contains(cls) || body.hasAttribute(attr);

    function sync() {
        // 文字の大きさ: 新デザインではクラスを外し、代わりに本文の領域を拡大する
        let fontsize = null;
        for (const c of [...body.classList]) {
            const m = c.match(FONTSIZE);
            if (!m) continue;
            fontsize = +m[1];
            if (isNew()) {
                strippedFontsize = c;
                body.classList.remove(c);
            }
        }
        if (fontsize === null && strippedFontsize) {
            if (isNew()) fontsize = +strippedFontsize.match(FONTSIZE)[1];
            else {
                body.classList.add(strippedFontsize);
                strippedFontsize = null;
            }
        }

        const rules = [];
        const cs = getComputedStyle(probe);

        if (isNew() && fontsize && fontsize !== 100) {
            rules.push(`html.wmp-new #topofscroll, html.wmp-new .wmp-rail-panel { zoom: ${fontsize / 100}; }`);
        }

        if (colourOn("accessibility-backgroundcolour", "data-default-background-color")) {
            const bg = cs.backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)") {
                rules.push(`${STRONG} body, ${STRONG} body *:not(${BG_EXCLUDE}) { background-color: ${bg} !important; }`);
            }
        }
        if (colourOn("accessibility-textcolour", "data-default-color")) {
            // 見本にはこの規則を当てない（当てると、その場で色を変えても見本が古い色のままになる）
            rules.push(`${STRONG} body, ${STRONG} body *:not(#wmp-a11y-probe) { color: ${cs.color} !important; }`);
        }

        const font = FONTS[valueOf("accessibility-fontface-")];
        if (font) rules.push(`${STRONG} body *:not(i, .fa, .icon) { font-family: ${font} !important; }`);

        const lineheight = +valueOf("accessibility-lineheight-");
        if (lineheight) rules.push(`${STRONG} body * { line-height: ${lineheight / 100} !important; }`);

        const spacing = valueOf("accessibility-letterspacing-");
        if (spacing) rules.push(`${STRONG} body * { letter-spacing: ${+spacing / 100}rem !important; }`);

        if (body.classList.contains("accessibility-fontkerning-none")) rules.push(`${STRONG} body * { font-kerning: none !important; }`);

        if (body.classList.contains("accessibility-linkhighlight-enabled")) {
            rules.push(`${STRONG} body a { border: 2px solid #0f6cbf !important; }`);
        }
        if (body.classList.contains("accessibility-imagevisibility-enabled")) {
            rules.push(`${STRONG} body img:not(.colourdialogue) { visibility: hidden !important; }`);
            rules.push(`${STRONG} body * { background-image: unset !important; }`);
        }

        const text = rules.join("\n");
        if (style.textContent !== text) style.textContent = text;
    }

    // プラグインがクラスを付け外ししたとき・色をその場で書き込んだときに読み直す。
    // 色はつまみを動かす間に何度も書き込まれるので、1フレームに1回にまとめる
    let frame = 0;
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(() => ((frame = 0), sync()));
    };
    new MutationObserver(schedule).observe(body, { attributes: true, attributeFilter: ["class", "style", "data-default-background-color", "data-default-color"] });
    // 新デザイン ⇄ 旧デザインの切り替え
    new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
})();
