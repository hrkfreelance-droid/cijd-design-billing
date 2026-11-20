// DAISHIN デザインルールの数値検査。ブラウザのコンソールか自動化で実行し、外れた項目を返す。
// 使い方：rule（daishin-ui-rule.json の中身）を渡して checkDaishinUi(rule) を呼ぶ。
function checkDaishinUi(rule, root = document.querySelector(".bw-shell") || document.body) {
  const fails = [];
  const px = (v) => parseFloat(v);
  for (const c of rule.checks) {
    const el = document.querySelector(c.sel);
    if (!el) { fails.push(`${c.sel}: 要素がない`); continue; }
    const got = c.prop === "width" ? el.getBoundingClientRect().width : px(getComputedStyle(el).getPropertyValue(c.prop));
    if (Math.abs(got - c.px) > 0.5) fails.push(`${c.sel} ${c.prop}: ${got} ≠ ${c.px}`);
  }
  if (rule.alignTop) {
    const [a, b] = rule.alignTop.map((s) => document.querySelector(s));
    if (a && b && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) > 1) fails.push(`一覧とカードの上の端がずれている: ${a.getBoundingClientRect().top} / ${b.getBoundingClientRect().top}`);
  }
  const dark = getComputedStyle(document.body).backgroundColor === "rgb(15, 16, 18)" || document.documentElement.classList.contains("dark");
  const toRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  const palette = new Set(Object.values(rule.colors[dark ? "dark" : "light"]).map(toRgb));
  const sizes = new Set(rule.fontSizes.map(String));
  const weights = new Set(rule.fontWeights.map(String));
  const badSize = new Map(), badColor = new Map(), badWeight = new Map();
  for (const el of root.querySelectorAll("*")) {
    if (!el.getClientRects().length || el.closest("svg, dialog:not([open])")) continue;
    const st = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      const fs = String(parseFloat(st.fontSize));
      if (!sizes.has(fs)) badSize.set(fs, (badSize.get(fs) || 0) + 1);
      if (!weights.has(st.fontWeight)) badWeight.set(st.fontWeight, (badWeight.get(st.fontWeight) || 0) + 1);
      if (!palette.has(st.color)) badColor.set(`文字 ${st.color}`, (badColor.get(`文字 ${st.color}`) || 0) + 1);
    }
    const bg = st.backgroundColor;
    if (bg !== "rgba(0, 0, 0, 0)" && !palette.has(bg)) badColor.set(`地 ${bg}`, (badColor.get(`地 ${bg}`) || 0) + 1);
  }
  for (const [k, n] of badSize) fails.push(`ルールにない文字の大きさ ${k}px ×${n}`);
  for (const [k, n] of badWeight) fails.push(`ルールにない太さ ${k} ×${n}`);
  for (const [k, n] of badColor) fails.push(`ルールにない色 ${k} ×${n}`);
  return { theme: dark ? "dark" : "light", pass: fails.length === 0, fails };
}
if (typeof module !== "undefined") module.exports = { checkDaishinUi };
