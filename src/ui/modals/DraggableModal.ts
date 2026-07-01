import { Modal } from "obsidian";

/**
 * Modal subclass whose box can be repositioned by dragging the title
 * bar -- like a desktop window. The drag delta is applied as a CSS
 * translate on `modalEl`, which layers on top of whatever centring
 * layout Obsidian uses (flexbox on the container) without fighting it.
 *
 * The drag wiring is installed once in `open()`, not in `onOpen()`:
 * several modals call `onOpen()` repeatedly to re-render their body
 * (GenerateActionModal, ProviderDetailModal), and the title bar element
 * survives those re-renders, so a single set of listeners is enough and
 * never stacks up. State resets on `close()` so reopening the same
 * instance starts centred again.
 */
export class DraggableModal extends Modal {
  private dragOffset = { x: 0, y: 0 };
  private dragTeardown: (() => void) | null = null;

  open(): void {
    super.open();
    this.installDrag();
  }

  close(): void {
    this.dragTeardown?.();
    this.dragTeardown = null;
    this.dragOffset = { x: 0, y: 0 };
    super.close();
  }

  private installDrag(): void {
    if (this.dragTeardown) return;
    const handle = this.titleEl;
    const box = this.modalEl;
    if (!handle || !box) return;

    handle.addClass("fm-editor-modal-drag-handle");

    let dragging = false;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;

    const apply = (): void => {
      box.setCssStyles({
        transform: `translate(${this.dragOffset.x}px, ${this.dragOffset.y}px)`,
      });
    };

    const onDown = (ev: PointerEvent): void => {
      // Left button only; ignore the close-button hit area.
      if (ev.button !== 0) return;
      dragging = true;
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      baseX = this.dragOffset.x;
      baseY = this.dragOffset.y;
      // Pointer capture keeps move/up events flowing to the handle even
      // when the cursor outruns it, so a fast drag never desyncs.
      handle.setPointerCapture(pointerId);
      activeDocument.body.addClass("fm-editor-modal-is-dragging");
      ev.preventDefault();
    };

    const onMove = (ev: PointerEvent): void => {
      if (!dragging) return;
      this.dragOffset.x = baseX + (ev.clientX - startX);
      this.dragOffset.y = baseY + (ev.clientY - startY);
      apply();
    };

    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      activeDocument.body.removeClass("fm-editor-modal-is-dragging");
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);

    this.dragTeardown = () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.removeClass("fm-editor-modal-drag-handle");
      box.setCssStyles({ transform: "" });
      activeDocument.body.removeClass("fm-editor-modal-is-dragging");
    };
  }
}
