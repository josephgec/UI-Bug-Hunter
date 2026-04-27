# UI Bug Hunter — Flow Recorder (browser extension)

Phase 3 prototype. Captures click / input / navigation interactions on any
page and exports them in the JSON format that
`packages/shared/src/flows.ts` validates.

## Local install (Chrome / Edge / Brave)

1. Open `chrome://extensions` and toggle **Developer mode**.
2. Click **Load unpacked** and pick this `extension/recorder/` directory.
3. Click the extension icon, hit **Start recording**, walk through the flow,
   then **Stop & copy JSON**. The clipboard now holds the flow definition.
4. Paste into the dashboard's flow editor (or `POST` to `/api/v1/flows`).

## What's captured

| Event | Maps to |
|---|---|
| `click`            | `{ kind: "click", selector }` |
| `input` (debounced)| `{ kind: "type", selector, text }`  |
| `navigate`         | `{ kind: "goto", url }` |

Selectors are CSS paths up to 4 levels deep, preferring ids and class names.
The recorder tags `:nth-of-type(N)` when there's no other anchor.

## Status

- ✅ MV3 manifest, content + background scripts, popup
- ✅ Click / input / navigation capture
- ✅ Clipboard export
- ⏳ Web Store packaging (deferred)
- ⏳ Step editor UI (rename / reorder / delete / replay) — currently raw JSON only
- ⏳ Wait-step heuristics (auto-emit `wait` between human pauses)
