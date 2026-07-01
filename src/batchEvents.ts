import type { App, EventRef } from "obsidian";

/**
 * Custom workspace events that bracket long-running batch operations (bulk
 * edits, snapshot restore, AI generate). The live view listens for these to
 * suspend its per-change refresh while a batch runs, then refresh once when it
 * finishes. Using the workspace event bus keeps the services decoupled from
 * the view -- a service just announces its batch boundaries; whoever cares
 * (the open view, if any) reacts.
 */
export const FM_BATCH_START = "frontmatter-operator:batch-start";
export const FM_BATCH_END = "frontmatter-operator:batch-end";

interface EventsLike {
  trigger(name: string, ...data: unknown[]): void;
  on(name: string, cb: (...data: unknown[]) => unknown): EventRef;
}

/** Announce a batch boundary on the workspace event bus. */
export function triggerBatchEvent(app: App, name: string): void {
  (app.workspace as unknown as EventsLike).trigger(name);
}

/** Subscribe to a batch boundary. Returns an EventRef for registerEvent(). */
export function onBatchEvent(app: App, name: string, cb: () => void): EventRef {
  return (app.workspace as unknown as EventsLike).on(name, cb);
}
