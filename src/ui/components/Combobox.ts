export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  meta?: string;
}

export interface ComboboxOpts {
  placeholder?: string;
  allowFreeform?: boolean;
  emptyMessage?: string;
  maxResults?: number;
  onChange: (value: string) => void;
  onOpen?: () => void;
}

const DEFAULT_MAX = 80;

export class Combobox {
  private wrapper!: HTMLElement;
  private input!: HTMLInputElement;
  private dropdown!: HTMLElement;
  private options: ComboOption[] = [];
  private filtered: ComboOption[] = [];
  private highlighted = -1;
  private allowFreeform: boolean;
  private maxResults: number;

  constructor(private opts: ComboboxOpts) {
    this.allowFreeform = opts.allowFreeform ?? true;
    this.maxResults = opts.maxResults ?? DEFAULT_MAX;
  }

  mount(parent: HTMLElement, initialValue: string): HTMLElement {
    this.wrapper = parent.createDiv({ cls: "fm-combo" });
    this.input = this.wrapper.createEl("input", {
      type: "text",
      cls: "fm-combo-input",
    });
    this.input.placeholder = this.opts.placeholder ?? "";
    this.input.value = initialValue;

    this.dropdown = this.wrapper.createDiv({ cls: "fm-combo-dropdown" });

    this.input.addEventListener("input", () => {
      this.filter(this.input.value);
      this.open();
    });
    this.input.addEventListener("focus", () => {
      this.filter(this.input.value);
      this.open();
    });
    this.input.addEventListener("blur", () => {
      window.setTimeout(() => this.close(), 120);
    });
    this.input.addEventListener("keydown", (ev) => this.handleKey(ev));

    return this.wrapper;
  }

  setOptions(options: ComboOption[]): void {
    this.options = options;
    if (this.input) this.filter(this.input.value);
  }

  setValue(value: string): void {
    if (this.input) this.input.value = value;
  }

  getValue(): string {
    return this.input?.value ?? "";
  }

  focus(): void {
    this.input?.focus();
  }

  private filter(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filtered = this.options.slice(0, this.maxResults);
    } else {
      const exact: ComboOption[] = [];
      const prefix: ComboOption[] = [];
      const substr: ComboOption[] = [];
      const hint: ComboOption[] = [];
      for (const o of this.options) {
        const ln = o.label.toLowerCase();
        if (ln === q) exact.push(o);
        else if (ln.startsWith(q)) prefix.push(o);
        else if (ln.includes(q)) substr.push(o);
        else if (o.hint?.toLowerCase().includes(q)) hint.push(o);
      }
      this.filtered = [...exact, ...prefix, ...substr, ...hint].slice(
        0,
        this.maxResults,
      );
    }
    this.highlighted = this.filtered.length > 0 ? 0 : -1;
    this.renderDropdown();
  }

  private renderDropdown(): void {
    this.dropdown.empty();
    if (this.filtered.length === 0) {
      const msg = this.allowFreeform
        ? (this.opts.emptyMessage ?? "No matches -- Enter to use as custom value")
        : (this.opts.emptyMessage ?? "No matches");
      this.dropdown.createDiv({ cls: "fm-combo-empty", text: msg });
      return;
    }
    this.filtered.forEach((opt, i) => {
      const item = this.dropdown.createDiv({ cls: "fm-combo-item" });
      if (i === this.highlighted) item.addClass("fm-combo-item-active");
      const main = item.createDiv({ cls: "fm-combo-item-main" });
      main.createSpan({ cls: "fm-combo-item-label", text: opt.label });
      if (opt.hint) {
        main.createSpan({ cls: "fm-combo-item-hint", text: opt.hint });
      }
      if (opt.meta) {
        item.createSpan({ cls: "fm-combo-item-meta", text: opt.meta });
      }
      item.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.select(opt);
      });
      item.addEventListener("mouseenter", () => {
        this.highlighted = i;
        this.refreshHighlight();
      });
    });
  }

  private refreshHighlight(): void {
    const items = Array.from(this.dropdown.children) as HTMLElement[];
    items.forEach((el, i) => {
      el.toggleClass("fm-combo-item-active", i === this.highlighted);
    });
  }

  private select(opt: ComboOption): void {
    this.input.value = opt.value;
    this.opts.onChange(opt.value);
    this.close();
  }

  private handleKey(ev: KeyboardEvent): void {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (this.highlighted < this.filtered.length - 1) {
        this.highlighted++;
        this.refreshHighlight();
      }
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (this.highlighted > 0) {
        this.highlighted--;
        this.refreshHighlight();
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (this.highlighted >= 0 && this.filtered[this.highlighted]) {
        this.select(this.filtered[this.highlighted]);
      } else if (this.allowFreeform) {
        this.opts.onChange(this.input.value);
        this.close();
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      this.close();
      this.input.blur();
    } else if (ev.key === "Tab") {
      this.close();
    }
  }

  private open(): void {
    this.wrapper.addClass("fm-combo-open");
    this.opts.onOpen?.();
  }

  private close(): void {
    this.wrapper.removeClass("fm-combo-open");
  }
}
