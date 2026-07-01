import { mountFloating, type FloatingHandle } from "../floating";

export interface MultiOption {
  value: string;
  label: string;
  hint?: string;
  meta?: string;
}

export interface MultiSelectPopoverOpts {
  options: MultiOption[];
  selected: Set<string>;
  placeholder?: string;
  onToggle: (value: string, selected: boolean) => void;
  onClose?: () => void;
}

export class MultiSelectPopover {
  private handle: FloatingHandle | null = null;
  private wrapper!: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private query = "";

  constructor(private opts: MultiSelectPopoverOpts) {}

  /**
   * Open the picker in a body-level floating layer anchored to `anchor`, so it
   * floats above everything and is never clipped by the scrollable table wrap
   * or the WHEN bar (both of which clip absolutely-positioned descendants).
   */
  attach(anchor: HTMLElement): void {
    this.handle = mountFloating(anchor, (layer) => this.build(layer), {
      align: "end",
      gap: 6,
      onClose: () => {
        this.handle = null;
        this.opts.onClose?.();
      },
    });
    window.setTimeout(() => this.input?.focus(), 0);
  }

  private build(layer: HTMLElement): void {
    this.wrapper = layer.createDiv({ cls: "fm-multiselect-popover" });

    const head = this.wrapper.createDiv({ cls: "fm-multiselect-head" });
    this.input = head.createEl("input", {
      type: "text",
      cls: "fm-multiselect-search",
    });
    this.input.placeholder = this.opts.placeholder ?? "Search properties...";
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.renderList();
      this.handle?.reposition();
    });

    head.createDiv({
      cls: "fm-multiselect-counts",
      text: `${this.opts.selected.size} selected`,
    });

    this.list = this.wrapper.createDiv({ cls: "fm-multiselect-list" });
    this.renderList();

    const footer = this.wrapper.createDiv({ cls: "fm-multiselect-footer" });
    const closeBtn = footer.createEl("button", {
      text: "Done",
      cls: "fm-editor-btn fm-editor-btn-primary",
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderList(): void {
    this.list.empty();
    const q = this.query.trim().toLowerCase();
    const items = q
      ? this.opts.options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.hint?.toLowerCase().includes(q) ?? false),
        )
      : this.opts.options;

    if (items.length === 0) {
      this.list.createDiv({
        cls: "fm-combo-empty",
        text: "No properties match",
      });
      return;
    }

    for (const opt of items) {
      const row = this.list.createDiv({ cls: "fm-multiselect-item" });
      const cb = row.createEl("input", {
        type: "checkbox",
        cls: "fm-multiselect-check",
      });
      cb.checked = this.opts.selected.has(opt.value);
      const main = row.createDiv({ cls: "fm-multiselect-item-main" });
      main.createSpan({ cls: "fm-multiselect-item-label", text: opt.label });
      if (opt.hint) {
        main.createSpan({ cls: "fm-multiselect-item-hint", text: opt.hint });
      }
      if (opt.meta) {
        row.createSpan({ cls: "fm-multiselect-item-meta", text: opt.meta });
      }
      const apply = (next: boolean): void => {
        cb.checked = next;
        if (next) this.opts.selected.add(opt.value);
        else this.opts.selected.delete(opt.value);
        this.opts.onToggle(opt.value, next);
        this.updateHeadCount();
      };
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        apply(cb.checked);
      });
      row.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).tagName === "INPUT") return;
        apply(!this.opts.selected.has(opt.value));
      });
    }
  }

  private updateHeadCount(): void {
    const head = this.wrapper.querySelector(".fm-multiselect-counts");
    if (head) head.textContent = `${this.opts.selected.size} selected`;
  }

  /** Re-anchor the open popover, e.g. after the table (and its "+" button) was
   *  rebuilt underneath it while the picker stayed open. */
  reanchorTo(anchor: HTMLElement): void {
    this.handle?.setAnchor(anchor);
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
  }
}
