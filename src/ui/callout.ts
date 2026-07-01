import { setIcon } from "obsidian";

/**
 * Vault-Operator-style info callout: a lightly accent-tinted box with a blue
 * left rail and a leading info icon. Reserved for overarching, understanding-
 * critical information; routine field descriptions use plain muted text
 * (.fm-editor-modal-hint) instead.
 */
export function renderCallout(parent: HTMLElement, text: string): HTMLElement {
  const box = parent.createDiv({ cls: "fm-editor-callout" });
  const icon = box.createSpan({ cls: "fm-editor-callout-icon" });
  setIcon(icon, "info");
  box.createSpan({ cls: "fm-editor-callout-text", text });
  return box;
}
