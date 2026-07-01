/**
 * EditableCell -- Obsidian-Bases-style inline editor for a single
 * frontmatter value in the matched-notes table.
 *
 * Display mode: same look as the read-only renderer (pill chips for
 * lists, link styling for wikilinks, "true"/"false" classes for
 * booleans). Click anywhere on the cell -> switches to Edit mode.
 *
 * Edit mode picks an input that matches the existing value type:
 *   - boolean    -> native checkbox (Tab/Enter/blur saves; Esc cancels)
 *   - number     -> number input
 *   - list       -> chip editor: existing chips stay, an empty input
 *                   appended; type + Enter adds; backspace on empty
 *                   removes the last chip; Esc cancels everything;
 *                   Enter on the input commits the whole list.
 *   - string     -> text input; if value matched [[Wikilink]] the
 *                   text input edits the bare link target (re-wraps
 *                   on save).
 *   - missing    -> shown as faded "+ add value"; click opens text
 *                   input that creates the property on save.
 *
 * Save commits via onSave(newValue) -- the host handles the actual
 * vault write (processFrontMatter + metadata-cache wait). Save
 * happens on Enter, Tab, or blur. Esc reverts and exits edit mode
 * without firing onSave.
 */

import { setIcon } from "obsidian";
import type { FmValue } from "../../types";
import { ListCellEditController, type ListCommit } from "./ListCellEditController";
import type { EditKind } from "../../services/propertyEditKind";

const WIKILINK_RE = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;

export interface EditableCellHandlers {
  /** Called when the user commits a new value. Omitted when readOnly
   *  is true (virtual properties don't write back to the vault). */
  onSave?: (next: FmValue | undefined) => Promise<void>;
  /** Called when the user clicks a wikilink in display mode. */
  openLink: (target: string) => void;
  /** When true the cell skips the click-to-edit handler, suppresses
   *  the "+ add" hint, and adds a .fm-editor-cell-virtual class so
   *  the hover cursor stays default. Used for virtual properties
   *  (__folder, __filename, __extension) which resolve dynamically
   *  from the path and shouldn't be writeable in v1. */
  readOnly?: boolean;
  /** Per-property editor preference, independent of this cell's current
   *  value. Ensures a list-typed property (e.g. `type`) always edits as a
   *  chip list even when this particular cell is empty or holds a bare
   *  string, so a newly entered value is saved in the correct format. */
  valueKind?: EditKind;
}

/**
 * Render a frontmatter value into the given table cell with full
 * inline-edit support. Replaces the read-only renderCell helper for
 * the property-value columns. The note-link column keeps its own
 * dedicated renderer because clicking that opens the note rather
 * than editing.
 */
export function renderEditableCell(
  td: HTMLElement,
  value: FmValue | undefined,
  handlers: EditableCellHandlers,
): void {
  td.empty();
  td.addClass("fm-editor-cell-editable");
  td.toggleClass("fm-editor-cell-virtual", !!handlers.readOnly);

  const display = td.createDiv({ cls: "fm-editor-cell-display" });
  // Virtual cells suppress the "+ add" affordance entirely -- their
  // value is resolved from the path, "adding" makes no sense.
  if (handlers.readOnly && value === undefined) {
    display.setText("");
  } else {
    renderDisplayMode(display, value, handlers.openLink);
  }

  if (handlers.readOnly) return;

  // The whole cell is clickable -- catches blank space too so a click
  // on an empty/null cell enters edit mode (otherwise the user has
  // nothing to grab).
  td.addEventListener("click", (ev) => {
    // Wikilink clicks already preventDefault'd themselves; bail so we
    // don't accidentally enter edit mode after the user navigates.
    if ((ev.target as HTMLElement).closest("a")) return;
    enterEditMode(td, value, handlers);
  });
}

function renderDisplayMode(
  parent: HTMLElement,
  value: FmValue | undefined,
  openLink: (t: string) => void,
): void {
  if (value === undefined) {
    parent.addClass("fm-editor-cell-missing");
    parent.createSpan({
      cls: "fm-editor-cell-add-hint",
      text: "+ add",
    });
    return;
  }
  if (value === null) {
    parent.addClass("fm-editor-cell-null");
    parent.setText("null");
    return;
  }
  if (typeof value === "boolean") {
    parent.addClass(value ? "fm-editor-cell-true" : "fm-editor-cell-false");
    parent.setText(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    parent.addClass("fm-editor-cell-num");
    parent.setText(String(value));
    return;
  }
  if (Array.isArray(value)) {
    parent.addClass("fm-editor-cell-list");
    const pills = parent.createDiv({ cls: "fm-editor-pills" });
    for (const item of value) {
      const pill = pills.createSpan({ cls: "fm-editor-pill" });
      const s = typeof item === "string" ? item : String(item);
      const wl = s.match(WIKILINK_RE);
      if (wl) {
        pill.addClass("fm-editor-pill-link");
        const link = pill.createEl("a", { text: wl[1] });
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openLink(wl[1]);
        });
      } else {
        pill.setText(s);
      }
    }
    return;
  }
  if (typeof value === "object") {
    // Plain objects (e.g. moc topics+concepts) are not editable
    // inline -- show JSON preview and let the user click to edit the
    // raw JSON in a textarea.
    parent.addClass("fm-editor-cell-obj");
    parent.setText(JSON.stringify(value));
    return;
  }
  // string
  const s = String(value);
  const wl = s.match(WIKILINK_RE);
  if (wl) {
    const link = parent.createEl("a", {
      text: wl[1],
      cls: "fm-editor-note-link",
    });
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openLink(wl[1]);
    });
    return;
  }
  parent.setText(s);
}

// ----------------------------------------------------------- EDIT MODE

/** Coerce any current value into the chip list's string[] form. */
function toStringArray(current: FmValue | undefined): string[] {
  if (current == null) return [];
  if (Array.isArray(current)) {
    return current
      .filter((v) => v != null)
      .map((v) => (typeof v === "string" ? v : String(v)));
  }
  const s = typeof current === "string" ? current : String(current);
  return s.trim() === "" ? [] : [s];
}

function enterEditMode(
  td: HTMLElement,
  current: FmValue | undefined,
  handlers: EditableCellHandlers,
): void {
  if (td.hasClass("is-editing")) return;
  td.addClass("is-editing");
  td.empty();
  const wrap = td.createDiv({ cls: "fm-editor-cell-edit" });

  const kind = handlers.valueKind;

  // A list-typed property always edits as a chip list, coercing an empty or
  // scalar current value into list form. This is the fix for "new value
  // sometimes saved as text": the editor no longer depends on whether THIS
  // cell already happens to be an array.
  if (kind === "list") {
    bindListEditor(wrap, td, toStringArray(current), handlers);
    return;
  }

  // Otherwise pick an editor from the concrete current value's type.
  if (typeof current === "boolean") {
    bindBooleanEditor(wrap, td, current, handlers);
    return;
  }
  if (typeof current === "number") {
    bindNumberEditor(wrap, td, current, handlers);
    return;
  }
  if (Array.isArray(current)) {
    bindListEditor(wrap, td, toStringArray(current), handlers);
    return;
  }
  if (current && typeof current === "object") {
    bindObjectEditor(wrap, td, current as Record<string, unknown>, handlers);
    return;
  }

  // string / null / undefined. Scalar kinds (number/boolean/text) defer to
  // value-based selection here: the string editor lets the user type the
  // value, which a later Set action can coerce. Only the list kind needs the
  // override above, because list-vs-scalar is not recoverable from a typed
  // string the way "5" -> number is.
  bindStringEditor(wrap, td, current == null ? "" : String(current), handlers);
}

function exitEditMode(
  td: HTMLElement,
  value: FmValue | undefined,
  handlers: EditableCellHandlers,
): void {
  td.removeClass("is-editing");
  // Re-render in display mode without firing another write.
  renderEditableCell(td, value, handlers);
}

async function commit(
  td: HTMLElement,
  next: FmValue | undefined,
  handlers: EditableCellHandlers,
): Promise<void> {
  td.addClass("is-saving");
  try {
    if (handlers.onSave) await handlers.onSave(next);
  } finally {
    td.removeClass("is-saving");
  }
  // Host re-renders the row from the fresh metadata cache; we don't
  // touch td anymore here (it may have been replaced).
}

// ------------------------------------------------- type-specific editors

function bindStringEditor(
  wrap: HTMLElement,
  td: HTMLElement,
  initial: string,
  handlers: EditableCellHandlers,
): void {
  const wasWikilink = WIKILINK_RE.test(initial);
  const inner = wasWikilink ? initial.match(WIKILINK_RE)![1] : initial;

  const input = wrap.createEl("input", {
    type: "text",
    cls: "fm-editor-cell-input",
  });
  input.value = inner;
  input.focus();
  input.select();

  let committed = false;
  const commitInput = () => {
    if (committed) return;
    committed = true;
    const v = input.value.trim();
    if (v === "" && initial === "") {
      // No-op edit on a previously-missing cell -- bail without writing.
      exitEditMode(td, undefined, handlers);
      return;
    }
    const next: FmValue | undefined = v === "" ? undefined : wasWikilink ? `[[${v}]]` : v;
    void commit(td, next, handlers);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    exitEditMode(td, initial === "" ? undefined : (initial as FmValue), handlers);
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitInput();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commitInput);
}

function bindNumberEditor(
  wrap: HTMLElement,
  td: HTMLElement,
  initial: number,
  handlers: EditableCellHandlers,
): void {
  const input = wrap.createEl("input", {
    type: "number",
    cls: "fm-editor-cell-input",
  });
  input.value = String(initial);
  input.focus();
  input.select();

  let committed = false;
  const commitInput = () => {
    if (committed) return;
    committed = true;
    const v = input.value.trim();
    if (v === "") {
      void commit(td, undefined, handlers);
      return;
    }
    const n = Number(v);
    if (Number.isNaN(n)) {
      // Reject non-numbers, keep editing.
      committed = false;
      input.focus();
      return;
    }
    void commit(td, n, handlers);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    exitEditMode(td, initial, handlers);
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitInput();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commitInput);
}

function bindBooleanEditor(
  wrap: HTMLElement,
  td: HTMLElement,
  initial: boolean,
  handlers: EditableCellHandlers,
): void {
  // For booleans we don't really need an "edit mode" -- one click is
  // the whole interaction. Render a checkbox that toggles+saves
  // immediately, with a small label so the user sees the new state.
  const label = wrap.createEl("label", {
    cls: "fm-editor-cell-bool-edit",
  });
  const cb = label.createEl("input", { type: "checkbox" });
  cb.checked = initial;
  label.appendText(initial ? " true" : " false");
  cb.focus();
  cb.addEventListener("change", () => {
    void commit(td, cb.checked, handlers);
  });
  // Esc bails without firing change.
  cb.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      exitEditMode(td, initial, handlers);
    }
  });
  // If the user clicks anywhere else, treat as commit-to-current
  // (no change). Use a microtask so the checkbox click isn't shadowed
  // by this same listener.
  wrap.addEventListener("blur", () => {
    if (cb.checked === initial) exitEditMode(td, initial, handlers);
  });
}

function bindListEditor(
  wrap: HTMLElement,
  td: HTMLElement,
  initial: string[],
  handlers: EditableCellHandlers,
): void {
  // The controller owns both the chips and the in-progress buffer. The input
  // below is created ONCE and never recreated on a chip add -- that is the
  // fix for the "added entry written twice" bug: the old code rebuilt the
  // input inside renderChips, and removing the focused input fired a stale
  // blur that re-pushed the staged value and committed prematurely.
  const controller = new ListCellEditController(initial);
  const container = wrap.createDiv({ cls: "fm-editor-cell-list-edit" });
  const input = container.createEl("input", {
    type: "text",
    cls: "fm-editor-cell-input fm-editor-cell-input-chips",
  });

  const apply = (res: ListCommit | null): void => {
    if (!res) return;
    void commit(td, res.value, handlers);
  };

  // Re-render only the chips, inserted before the persistent input so the
  // input keeps focus and no spurious blur fires.
  const renderPills = (): void => {
    container
      .querySelectorAll(".fm-editor-pill-edit")
      .forEach((el) => el.remove());
    controller.itemsView.forEach((item, idx) => {
      const pill = container.createSpan({
        cls: "fm-editor-pill fm-editor-pill-edit",
      });
      container.insertBefore(pill, input);
      pill.createSpan({ text: item });
      const x = pill.createEl("button", { cls: "fm-editor-chip-remove" });
      setIcon(x, "x");
      x.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        controller.removeAt(idx);
        renderPills();
        input.focus();
      });
    });
    input.placeholder =
      controller.itemsView.length === 0 ? "add value..." : "+ add...";
  };

  input.addEventListener("input", () => controller.setBuffer(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (input.value.trim()) {
        // Add a chip and stay in edit mode for the next value.
        controller.addBuffered();
        input.value = "";
        renderPills();
        input.focus();
      } else {
        // Empty Enter commits the whole list.
        apply(controller.commit());
      }
    } else if (ev.key === "Backspace" && input.value === "") {
      if (controller.removeLast()) {
        ev.preventDefault();
        renderPills();
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      controller.cancel();
      exitEditMode(td, initial, handlers);
    } else if (ev.key === "Tab") {
      // Commit with the staged chips plus any half-typed value.
      controller.addBuffered();
      input.value = "";
      apply(controller.commit());
    }
  });
  input.addEventListener("blur", () => {
    // Defer so a click on a chip's remove button isn't lost. The controller's
    // finished latch makes this a no-op once an Enter/Tab commit already ran.
    window.setTimeout(() => {
      if (controller.isFinished) return;
      if (!td.hasClass("is-editing")) return;
      const res = controller.commitIfChanged();
      if (res === "unchanged") {
        exitEditMode(td, initial, handlers);
      } else {
        apply(res);
      }
    }, 50);
  });

  renderPills();
  input.focus();
}

function bindObjectEditor(
  wrap: HTMLElement,
  td: HTMLElement,
  initial: Record<string, unknown>,
  handlers: EditableCellHandlers,
): void {
  // Objects edited as raw JSON in a textarea. Power-user escape hatch
  // for cases like moc.{topics, concepts} -- v1 doesn't try to
  // structure-edit those.
  const ta = wrap.createEl("textarea", {
    cls: "fm-editor-cell-input fm-editor-cell-input-json",
  });
  ta.value = JSON.stringify(initial, null, 2);
  ta.rows = 4;
  ta.focus();
  ta.select();
  let committed = false;
  const commitInput = () => {
    if (committed) return;
    committed = true;
    const v = ta.value.trim();
    if (v === "") {
      void commit(td, undefined, handlers);
      return;
    }
    let parsed: FmValue;
    try {
      parsed = JSON.parse(v) as FmValue;
    } catch {
      // Invalid JSON keeps the editor open.
      committed = false;
      ta.focus();
      return;
    }
    void commit(td, parsed, handlers);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    exitEditMode(td, initial as FmValue, handlers);
  };
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      commitInput();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
  ta.addEventListener("blur", commitInput);
}
