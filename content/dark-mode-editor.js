// ダークモード: TinyMCE の本文（iframe の中）に暗い色を入れる。
// iframe の中には拡張機能の CSS が届かないので、<head> に <style> を差し込む。
// 本文として保存されるのは <body> の中だけなので、差し込んだ <style> は提出内容には入らない。
(() => {
    if (globalThis.__wmpDarkEditor) return;
    globalThis.__wmpDarkEditor = true;

    const CSS = `
        html.wmp-dark { color-scheme: dark; }
        html.wmp-dark body { background: #1b1d21 !important; color: #e6e8eb !important; }
        html.wmp-dark a { color: #8fb4ff !important; }
        html.wmp-dark .mce-content-body[data-mce-placeholder]:not(.mce-visualblocks)::before { color: #a9aeb6 !important; }
        html.wmp-dark table, html.wmp-dark td, html.wmp-dark th { border-color: #343840 !important; }
    `;
    const frames = new Set();
    const isDark = () => document.documentElement.classList.contains("wmp-dark");

    function setup(iframe) {
        const doc = iframe.contentDocument;
        if (!doc?.head) return;
        if (!doc.getElementById("wmp-dark-editor")) {
            const style = doc.createElement("style");
            style.id = "wmp-dark-editor";
            style.textContent = CSS;
            doc.head.append(style);
        }
        doc.documentElement.classList.toggle("wmp-dark", isDark());
    }

    function watch(iframe) {
        if (frames.has(iframe)) return;
        frames.add(iframe);
        // TinyMCE は iframe の中身を後から書き込むので、読み込み後にも入れる
        iframe.addEventListener("load", () => setup(iframe));
        setup(iframe);
        setTimeout(() => setup(iframe), 500);
    }

    const find = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches("iframe.tox-edit-area__iframe")) watch(node);
        node.querySelectorAll?.("iframe.tox-edit-area__iframe").forEach(watch);
    };
    new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach(find);
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) find(document.body);

    // ヘッダーのボタンなどでダークモードを切り替えたら、本文の色も合わせる
    new MutationObserver(() => {
        for (const f of frames) f.isConnected ? setup(f) : frames.delete(f);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
})();
