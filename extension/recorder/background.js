// Background service worker. Holds recording state and accumulates steps
// from the content script. Steps follow the Flow JSON format from
// packages/shared/src/flows.ts.

let state = { recording: false, steps: [] };

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  switch (message.kind) {
    case "ubh:start":
      state = { recording: true, steps: [] };
      respond({ ok: true });
      break;
    case "ubh:stop":
      state.recording = false;
      respond({ steps: state.steps });
      break;
    case "ubh:clear":
      state = { recording: false, steps: [] };
      respond({ ok: true });
      break;
    case "ubh:status":
      respond({ recording: state.recording, steps: state.steps });
      break;
    case "ubh:event":
      if (state.recording) {
        const step = translateEvent(message.event);
        if (step) state.steps.push(step);
      }
      respond({ ok: true });
      break;
    default:
      respond({ ok: false, error: "unknown_message" });
  }
  return true;
});

function translateEvent(event) {
  switch (event.type) {
    case "click":
      return { kind: "click", selector: event.selector };
    case "input":
      return { kind: "type", selector: event.selector, text: event.value };
    case "navigate":
      return { kind: "goto", url: event.url };
    case "wait":
      return { kind: "wait", durationMs: event.durationMs };
    default:
      return null;
  }
}
