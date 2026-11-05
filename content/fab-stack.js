// 右下に浮いているボタンの列（見た目は styles/components.css）で、「?」をいちばん上に置く。
// 学習ツールのボタンは開くとブックマーク・メモが上に伸びるので、その上端に合わせて「?」の位置（--wmp-fab-top）を動かす。
// 学習ツールが無いページ・隠しているときは、CSS の初期値（学習ツールの場所）に「?」が入る。
(() => {
    if (globalThis.__wmpFabStack) return;
    globalThis.__wmpFabStack = true;

    const root = document.documentElement;
    let watched = null;

    function update() {
        const tools = document.querySelector(".learningtools-action-info .floating-button");
        if (tools !== watched) {
            if (watched) resize.unobserve(watched);
            if (tools) resize.observe(tools);
            watched = tools;
        }
        const rect = tools?.getBoundingClientRect();
        if (!rect || !rect.height) {
            root.style.removeProperty("--wmp-fab-top");
            return;
        }
        const gap = parseFloat(getComputedStyle(root).getPropertyValue("--wmp-fab-gap")) || 12;
        root.style.setProperty("--wmp-fab-top", `${Math.round(root.clientHeight - rect.top + gap)}px`);
    }

    const resize = new ResizeObserver(update);
    addEventListener("resize", update);
    // 学習ツールのボタンは Moodle の JS が後から入れることがあるので、出てくるまで見張る
    const mo = new MutationObserver(() => {
        if (!watched?.isConnected) update();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    update();
})();
