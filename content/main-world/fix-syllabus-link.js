// シラバス検索結果: 右クリック禁止を解除し、科目名を普通のリンクにする（新しいタブで開ける）。
(() => {
    document.oncontextmenu = null;
    document.body && (document.body.oncontextmenu = null);
    document.querySelectorAll(".ctable-main td:nth-child(3) > a, .ct-vh td:nth-child(3) > a").forEach((a) => {
        const key = a.getAttribute("onclick")?.match(/post_submit\('[^']+', '([^']+)'\)/)?.[1];
        if (!key) return;
        a.href = `https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${key}`;
        a.removeAttribute("onclick");
    });
})();
