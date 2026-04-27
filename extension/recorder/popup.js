// Talks to the background service worker over chrome.runtime.sendMessage.
// State (recording on/off, captured steps) lives in the background so it
// survives popup close.
const $ = (id) => document.getElementById(id);

async function refresh() {
  const { recording, steps } = await chrome.runtime.sendMessage({ kind: "ubh:status" });
  $("status").textContent = recording ? `recording (${steps.length} steps)` : "idle";
  $("output").textContent = JSON.stringify({ steps }, null, 2);
}

$("start").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "ubh:start" });
  await refresh();
});

$("stop").addEventListener("click", async () => {
  const { steps } = await chrome.runtime.sendMessage({ kind: "ubh:stop" });
  await navigator.clipboard.writeText(JSON.stringify({ steps }, null, 2)).catch(() => {});
  await refresh();
});

$("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "ubh:clear" });
  await refresh();
});

refresh();
