// DAISHIN デザインルールの数値検査。ルールの1行ごとに、ここで1つ以上の項目を測る。
// 使い方：checkDaishinUi(rule)（rule は daishin-ui-rule.json の中身）。外れた項目を fails に返す。
function checkDaishinUi(rule, root = document.querySelector(".bw-shell") || document.body) {
  const fails = [];
  const box = (el) => el.getBoundingClientRect();
  const fits = (c) => (!c.minWidth || innerWidth >= c.minWidth) && (!c.maxWidth || innerWidth <= c.maxWidth);
  for (const c of (rule.checks || []).filter(fits)) {
    const el = document.querySelector(c.sel);
    if (!el) { fails.push(`${c.sel}: 要素がない`); continue; }
    const got = c.prop === "width" ? box(el).width : parseFloat(getComputedStyle(el).getPropertyValue(c.prop));
    if (Math.abs(got - c.px) > 0.5) fails.push(`${c.sel} ${c.prop}: ${got} ≠ ${c.px}`);
  }
  for (const a of (rule.align || []).filter(fits)) {
    const tol = a.tol ?? 0.5;
    if (a.type === "centerY") {
      for (const el of document.querySelectorAll(a.each)) {
        const host = el.closest(a.within); if (!host) continue;
        const d = (box(el).top + box(el).height / 2) - (box(host).top + box(host).height / 2);
        if (Math.abs(d) > tol) { fails.push(`${a.why}: ${a.each} が ${d.toFixed(1)}px ずれ`); break; }
      }
    } else {
      const edge = a.type === "sameLeft" ? "left" : a.type === "sameRight" ? "right" : "top";
      const els = a.sels.flatMap((s) => Array.from(document.querySelectorAll(s))).filter((e) => e.getClientRects().length);
      if (els.length < 2) { fails.push(`${a.why}: 比べる要素が足りない`); continue; }
      const vals = els.map((e) => box(e)[edge]);
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread > tol) fails.push(`${a.why}: ${edge} が ${spread.toFixed(1)}px ばらつく`);
    }
  }
  if (rule.noOverflowX && document.documentElement.scrollWidth > innerWidth + 1) fails.push(`横にはみ出し: ${document.documentElement.scrollWidth} > ${innerWidth}`);
  const dark = document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark";
  const toRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  const palette = new Set(Object.values(rule.colors[dark ? "dark" : "light"]).map(toRgb));
  const sizes = new Set(rule.fontSizes.map(String)), weights = new Set(rule.fontWeights.map(String));
  const bad = new Map();
  const add = (k) => bad.set(k, (bad.get(k) || 0) + 1);
  for (const el of root.querySelectorAll("*")) {
    if (!el.getClientRects().length || el.closest("svg")) continue;
    const st = getComputedStyle(el);
    if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const fs = String(parseFloat(st.fontSize));
      if (!sizes.has(fs)) add(`ルールにない文字の大きさ ${fs}px`);
      if (!weights.has(st.fontWeight)) add(`ルールにない太さ ${st.fontWeight}`);
      if (!palette.has(st.color)) add(`ルールにない文字の色 ${st.color}`);
    }
    if (st.backgroundColor !== "rgba(0, 0, 0, 0)" && !palette.has(st.backgroundColor)) add(`ルールにない地の色 ${st.backgroundColor}`);
  }
  for (const [k, n] of bad) fails.push(`${k} ×${n}`);
  return { theme: dark ? "dark" : "light", width: innerWidth, pass: fails.length === 0, fails };
}
if (typeof module !== "undefined") module.exports = { checkDaishinUi };
