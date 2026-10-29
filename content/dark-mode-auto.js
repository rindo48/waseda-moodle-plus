// ダークモード（システムに合わせる）
(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("wmp-dark", media.matches);
    apply();
    media.addEventListener("change", apply);
})();
