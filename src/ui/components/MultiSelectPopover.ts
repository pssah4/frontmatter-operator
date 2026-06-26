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
  private wrapper!: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private query = "";
  private boundOutsideClick!: (ev: MouseEvent) => void;
  private boundKey!: (ev: KeyboardEvent) => void;

  constructor(private opts: MultiSelectPopoverOpts) {}

  attach(anchor: HTMLElement): void {
    this.wrapper = anchor.createDiv({ cls: "fm-multiselect-popover" });

    const head = this.wrapper.createDiv({ cls: "fm-multiselect-head" });
    this.input = head.createEl("input", {
      type: "text",
      cls: "fm-multiselect-search",
    });
    this.input.placeholder = this.opts.placeholder ?? "Search properties...";
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.renderList();
    });

    const counts = head.createDiv({ cls: "fm-multiselect-counts" });
    counts.setText(`${this.opts.selected.size} selected`);
    head.dataset.countsId = "counts";

    this.list = this.wrapper.createDiv({ cls: "fm-multiselect-list" });
    this.renderList();

    const footer = this.wrapper.createDiv({ cls: "fm-multiselect-footer" });
    const closeBtn = footer.createEl("button", {
      text: "Done",
      cls: "fm-editor-btn fm-editor-btn-primary",
    });
    closeBtn.addEventListener("click", () => this.close());

    this.boundOutsideClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (target && !this.wrapper.contains(target)) {
        this.close();
      }
    };
    this.boundKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    };
    window.setTimeout(() => {
      document.addEventListener("mousedown", this.boundOutsideClick);
      document.addEventListener("keydown", this.boundKey);
      this.input.focus();
    }, 0);
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
      const toggle = () => {
        const next = !this.opts.selected.has(opt.value);
        cb.checked = next;
        if (next) this.opts.selected.add(opt.value);
        else this.opts.selected.delete(opt.value);
        this.opts.onToggle(opt.value, next);
        this.updateHeadCount();
      };
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const next = cb.checked;
        if (next) this.opts.selected.add(opt.value);
        else this.opts.selected.delete(opt.value);
        this.opts.onToggle(opt.value, next);
        this.updateHeadCount();
      });
      row.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).tagName === "INPUT") return;
        toggle();
      });
    }
  }

  private updateHeadCount(): void {
    const head = this.wrapper.querySelector(".fm-multiselect-counts");
    if (head) head.textContent = `${this.opts.selected.size} selected`;
  }

  close(): void {
    document.removeEventListener("mousedown", this.boundOutsideClick);
    document.removeEventListener("keydown", this.boundKey);
    this.wrapper.remove();
    this.opts.onClose?.();
  }
}
