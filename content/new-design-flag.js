// 新デザイン: ページが描画される前に目印を付ける（styles/new-design.css はこの目印があるときだけ効く）。
document.documentElement.classList.add("wmp-new");
document.documentElement.dataset.wmpDesign = "new";
// 左のメニューの幅を先に空けておく（後から空けると本文が横にずれて見える）。メニューを出せないページでは new-shell.js が外す
document.documentElement.classList.add("wmp-has-rail");
// 左のメニューを前回たたんでいたら、描画の前にたたんでおく（読み込み中に幅が変わってちらつかないように）
if (localStorage.getItem("wmpRailCollapsed") === "1") document.documentElement.classList.add("wmp-rail-collapsed");
// 読み込みが終わっても左のメニューが出ていなければ（途中で失敗したなど）、空けた幅を戻す。上のタブは new-shell.js が
// メニューを出せたときにしか隠さないので、どちらも無いページにはならない
window.addEventListener("load", () => {
    setTimeout(() => {
        if (!document.getElementById("wmp-rail")) document.documentElement.classList.remove("wmp-has-rail");
    }, 1500);
});
