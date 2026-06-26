// Minimal Obsidian stub for vitest. Only what our test files touch.

export class TFile {
  path = "";
  basename = "";
  extension = "";
}

export class TFolder {
  path = "";
}

export class Modal {
  constructor(_app: unknown) {}
  open(): void {}
  close(): void {}
}

export class Notice {
  constructor(_msg: string, _t?: number) {}
}

export function setIcon(_el: unknown, _name: string): void {}

export class Setting {
  constructor(_el: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  then(): this {
    return this;
  }
}
