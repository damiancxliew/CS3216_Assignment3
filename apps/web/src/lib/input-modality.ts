// Runs in the head before the page paints, so the first click never paints a
// focus ring. Radix and our own components restore focus programmatically after
// a click, which browsers treat as keyboard focus.
export const inputModalityScript = `(() => {
  const set = (mode) => { document.documentElement.dataset.inputModality = mode; };
  set("pointer");
  addEventListener("pointerdown", () => set("pointer"), true);
  addEventListener("keydown", (event) => { if (!event.metaKey && !event.ctrlKey && !event.altKey) set("keyboard"); }, true);
})();`;
