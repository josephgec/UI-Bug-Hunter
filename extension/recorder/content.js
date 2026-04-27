// Content script — runs in the target page and reports interactions to the
// background worker. We instrument click, input (debounced), and navigation;
// the user can refine selectors / text in the popup before exporting.

const SELECTOR_DEPTH = 4;

function cssPath(el) {
  if (!(el instanceof Element)) return "";
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < SELECTOR_DEPTH) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part = `${part}#${node.id}`;
      parts.unshift(part);
      break;
    }
    if (node.classList && node.classList.length) {
      part += "." + Array.from(node.classList).slice(0, 2).join(".");
    }
    // Use :nth-of-type for stability when there are no ids/classes.
    const siblings = node.parentNode
      ? Array.from(node.parentNode.children).filter((c) => c.tagName === node.tagName)
      : [];
    if (siblings.length > 1) {
      const idx = siblings.indexOf(node) + 1;
      part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    node = node.parentNode;
  }
  return parts.join(" > ");
}

function send(event) {
  try {
    chrome.runtime.sendMessage({ kind: "ubh:event", event });
  } catch {
    /* extension context may be torn down on navigation */
  }
}

document.addEventListener(
  "click",
  (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    send({ type: "click", selector: cssPath(target) });
  },
  true,
);

let inputTimer = null;
document.addEventListener(
  "input",
  (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      send({ type: "input", selector: cssPath(target), value: target.value });
    }, 400);
  },
  true,
);

// Best-effort navigation capture. The History API doesn't fire DOM events
// for pushState, so we wrap it.
const origPush = history.pushState;
const origReplace = history.replaceState;
history.pushState = function (...args) {
  origPush.apply(this, args);
  send({ type: "navigate", url: location.href });
};
history.replaceState = function (...args) {
  origReplace.apply(this, args);
  send({ type: "navigate", url: location.href });
};
window.addEventListener("popstate", () => send({ type: "navigate", url: location.href }));
window.addEventListener("load", () => send({ type: "navigate", url: location.href }));
