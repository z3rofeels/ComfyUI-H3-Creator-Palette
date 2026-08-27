// Ordered machine-settings writer.
//
// Several Creator surfaces can save machine preferences (Models, Settings,
// PreStage). Browser fetches may finish in a different order than the user
// clicked them, which can otherwise resurrect an older choice. Keep every
// write in user-action order. Workflow state is still committed synchronously;
// this only serializes the small per-machine JSON writes.
import * as H from "./z3_h3_api.js";

let tail = Promise.resolve();

function clone(value) {
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
}

export function saveMachineSettings(patch) {
  const snapshot = clone(patch && typeof patch === "object" ? patch : {});
  const run = () => H.saveSettings(snapshot);
  const request = tail.catch(() => null).then(run);
  tail = request.catch(() => null);
  return request;
}

export async function flushMachineSettings() {
  await tail.catch(() => null);
}
