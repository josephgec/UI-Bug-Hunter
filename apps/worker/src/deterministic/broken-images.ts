import type { BrowserSession } from "../browser.js";

export interface BrokenImage {
  src: string;
  reason: "404" | "zero_dimensions" | "broken_decode";
  selector?: string;
}

// Pulls every <img> on the page and flags those that are 0×0 (failed to load),
// have an HTTP error in the network log, or were marked broken via
// HTMLImageElement.complete && naturalWidth === 0.
export async function detectBrokenImages(session: BrowserSession): Promise<BrokenImage[]> {
  const page = session.requirePage();
  const candidates = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs.map((img) => ({
      src: img.currentSrc || img.src,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      selector: cssPath(img),
    }));

    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4) {
        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : "";
        const cls = node.classList.length
          ? `.${Array.from(node.classList).slice(0, 2).join(".")}`
          : "";
        parts.unshift(`${tag}${id}${cls}`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
  });

  const networkBySrc = new Map<string, number>();
  for (const e of session.networkErrors) {
    networkBySrc.set(e.url, e.status);
  }

  const out: BrokenImage[] = [];
  for (const c of candidates) {
    if (!c.src) continue;
    const networkStatus = networkBySrc.get(c.src);
    if (networkStatus && networkStatus >= 400) {
      out.push({ src: c.src, reason: "404", selector: c.selector });
      continue;
    }
    if (c.complete && c.naturalWidth === 0 && c.naturalHeight === 0) {
      out.push({ src: c.src, reason: "broken_decode", selector: c.selector });
      continue;
    }
    if (!c.complete) {
      out.push({ src: c.src, reason: "zero_dimensions", selector: c.selector });
    }
  }
  return out;
}
