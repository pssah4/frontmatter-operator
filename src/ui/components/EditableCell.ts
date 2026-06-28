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

const WIKILINK_RE = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;

export interface EditableCellHandlers {
  /** Called when the user commits a new value. Returns a promise so
   *  the cell can show a brief saving state on slow writes. */
  onSave: (next: FmValue | undefined) => Promise<void>;
  /** Called when the user clicks a wikilink in display mode. */
  openLink: (target: string) => void;
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

  const display = td.createDiv({ cls: "fm-editor-cell-display" });
  renderDisplayMode(display, value, handlers.openLink);

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

function enterEditMode(
  td: HTMLElement,
  current: FmValue | undefined,
  handlers: EditableCellHandlers,
): void {
  if (td.hasClass("is-editing")) return;
  td.addClass("is-editing");
  td.empty();
  const wrap = td.createDiv({ cls: "fm-editor-cell-edit" });

  // Pick an editor based on the current value's type. Missing/null
  // default to a string input -- it's the most common new-value type
  // and the user can type "true"/"false" or "1"/"2" to coerce later
  // via a separate Set action.
  if (typeof current === "boolean") {
    bindBooleanEditor(wrap, td, current, handlers);
    return;
  }
  if (typeof current === "number") {
    bindNumberEditor(wrap, td, current, handlers);
    return;
  }
  if (Array.isArray(current)) {
    bindListEditor(
      wrap,
      td,
      current.map((v) => (typeof v === "string" ? v : String(v))),
      handlers,
    );
    return;
  }
  if (current && typeof current === "object") {
    bindObjectEditor(wrap, td, current as Record<string, unknown>, handlers);
    return;
  }
  // string / null / undefined
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
    await handlers.onSave(next);
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
  let items = [...initial];
  const chips = wrap.createDiv({ cls: "fm-editor-cell-list-edit" });

  const renderChips = () => {
    chips.empty();
    items.forEach((item, idx) => {
      const pill = chips.createSpan({
        cls: "fm-editor-pill fm-editor-pill-edit",
      });
      pill.createSpan({ text: item });
      const x = pill.createEl("button", { cls: "fm-editor-chip-remove" });
      setIcon(x, "x");
      x.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        items.splice(idx, 1);
        renderChips();
      });
    });
    const input = chips.createEl("input", {
      type: "text",
      cls: "fm-editor-cell-input fm-editor-cell-input-chips",
      attr: { placeholder: items.length === 0 ? "add value..." : "+ add..." },
    });
    input.focus();
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const v = input.value.trim();
        if (v) {
          items.push(v);
          renderChips();
        } else {
          // Empty Enter on chip list -> commit the list.
          void commit(td, items.length === 0 ? undefined : items, handlers);
        }
      } else if (ev.key === "Backspace" && input.value === "" && items.length > 0) {
        ev.preventDefault();
        items.pop();
        renderChips();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        exitEditMode(td, initial, handlers);
      } else if (ev.key === "Tab") {
        // Tab commits with whatever is staged plus any half-typed
        // value in the input.
        const v = input.value.trim();
        if (v) items.push(v);
        void commit(td, items.length === 0 ? undefined : items, handlers);
      }
    });
    input.addEventListener("blur", () => {
      // Defer so a click on a remove-chip button isn't lost.
      setTimeout(() => {
        if (!td.hasClass("is-editing")) return;
        const v = input.value.trim();
        if (v) items.push(v);
        // Only commit on blur if the list actually changed; otherwise
        // just exit edit mode silently.
        if (
          items.length !== initial.length ||
          items.some((it, i) => it !== initial[i])
        ) {
          void commit(td, items.length === 0 ? undefined : items, handlers);
        } else {
          exitEditMode(td, initial, handlers);
        }
      }, 50);
    });
  };

  renderChips();
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
