import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Synthetic bug injector. Takes a clean HTML file, applies one of the named
// transforms, and writes the result alongside under fixtures/synth/. Used to
// grow the eval set with controlled positives.

type Transform =
  | "remove-alt"
  | "break-contrast"
  | "clip-text"
  | "inject-console-error"
  | "break-image"
  | "leak-templating";

const TRANSFORMS: Record<Transform, (html: string) => string> = {
  "remove-alt": (html) => html.replace(/<img([^>]*?)\salt="[^"]*"/g, "<img$1"),
  "break-contrast": (html) =>
    html.replace(
      /<body([^>]*)>/,
      `<body$1><style>* { color: #cccccc !important; background: #ffffff !important; }</style>`,
    ),
  "clip-text": (html) =>
    html.replace(
      /<body([^>]*)>/,
      `<body$1 style="overflow:hidden;"><style>h1,h2,h3,p { width: 80px !important; overflow: hidden !important; white-space: nowrap !important; text-overflow: clip !important; }</style>`,
    ),
  "inject-console-error": (html) =>
    html.replace(
      "</body>",
      `<script>setTimeout(() => { throw new Error("Synthetic injected error"); }, 50);</script></body>`,
    ),
  "break-image": (html) =>
    html.replace(
      "</body>",
      `<img src="/this-asset-does-not-exist-${Math.random().toString(36).slice(2)}.png" /></body>`,
    ),
  "leak-templating": (html) =>
    html.replace(
      "</body>",
      `<p>Welcome back, {{user_name}}! You have {{unread_count}} unread messages.</p></body>`,
    ),
};

async function main(): Promise<void> {
  const [, , transform, inputPath, outputPath] = process.argv;
  if (!transform || !inputPath || !outputPath) {
    console.error("usage: tsx synth/inject.ts <transform> <input.html> <output.html>");
    console.error("transforms: " + Object.keys(TRANSFORMS).join(", "));
    process.exit(2);
  }
  const fn = TRANSFORMS[transform as Transform];
  if (!fn) {
    console.error(`unknown transform: ${transform}`);
    process.exit(2);
  }
  const html = await readFile(resolve(inputPath), "utf8");
  const out = fn(html);
  await writeFile(resolve(outputPath), out, "utf8");
  console.log(`wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
