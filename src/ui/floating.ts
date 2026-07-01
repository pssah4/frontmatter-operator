/**
 * Floating layer -- positions a popover/menu/dropdown in a body-level layer so
 * it can never be clipped by an `overflow: hidden|auto` ancestor (the WHEN bar
 * and the scrollable table wrap both clip absolutely-positioned children).
 *
 * `computeFloatingPosition` is the pure geometry core (fully unit-tested);
 * `mountFloating` is the thin DOM shell that measures, positions, and wires up
 * outside-click / Escape / scroll-reposition.
 */

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface FloatingPlacement {
  left: number;
  top: number;
  placedAbove: boolean;
}

export interface ComputeFloatingOpts {
  /** Horizontal edge to align the floating box with the anchor. */
  align?: "start" | "end";
  /** Gap between the anchor edge and the floating box. */
  gap?: number;
  /** Minimum distance the box keeps from every viewport edge. */
  margin?: number;
}

/**
 * Place a floating box relative to an anchor, preferring below and flipping
 * above only when below would overflow and above genuinely has more room.
 * The result is always clamped inside the viewport margin so nothing renders
 * off-screen.
 */
export function computeFloatingPosition(
  anchor: Rect,
  floating: Size,
  viewport: Size,
  opts: ComputeFloatingOpts = {},
): FloatingPlacement {
  const gap = opts.gap ?? 4;
  const margin = opts.margin ?? 8;
  const align = opts.align ?? "start";

  // Vertical: below by default, flip above only if it doesn't fit below and
  // there is more space above than below.
  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;
  const fitsBelow = spaceBelow >= floating.height + gap + margin;
  const placedAbove = !fitsBelow && spaceAbove > spaceBelow;

  let top = placedAbove
    ? anchor.top - gap - floating.height
    : anchor.bottom + gap;

  // Horizontal: align the chosen edge, then clamp into the viewport.
  let left =
    align === "end" ? anchor.right - floating.width : anchor.left;

  const maxLeft = viewport.width - floating.width - margin;
  left = Math.min(left, maxLeft);
  left = Math.max(margin, left);

  const maxTop = viewport.height - floating.height - margin;
  top = Math.min(top, maxTop);
  top = Math.max(margin, top);

  return { left, top, placedAbove };
}

export interface FloatingHandle {
  el: HTMLElement;
  reposition: () => void;
  /** Point the layer at a different anchor and reposition against it. Used when
   *  the original anchor was replaced by a DOM rebuild while the layer is open. */
  setAnchor: (anchor: HTMLElement) => void;
  close: () => void;
}

export interface MountFloatingOpts {
  align?: "start" | "end";
  gap?: number;
  margin?: number;
  /** Extra class on the floating container. */
  cls?: string;
  /** Called after the layer is removed from the DOM. */
  onClose?: () => void;
  /** Close when the user clicks outside the floating box. Default true. */
  closeOnOutsideClick?: boolean;
}

/**
 * Mount `build`'s content into a body-level floating layer positioned against
 * `anchor`. Returns a handle to reposition or close it. Escape, outside-click
 * and ancestor scrolling all dismiss it; window resize repositions it.
 */
export function mountFloating(
  anchor: HTMLElement,
  build: (container: HTMLElement) => void,
  opts: MountFloatingOpts = {},
): FloatingHandle {
  const doc = anchor.ownerDocument;
  let currentAnchor = anchor;
  const layer = doc.createElement("div");
  layer.className = "fm-floating";
  if (opts.cls) layer.classList.add(opts.cls);
  build(layer);
  doc.body.appendChild(layer);

  const reposition = (): void => {
    const a = currentAnchor.getBoundingClientRect();
    const win = anchor.ownerDocument.defaultView;
    const viewport = {
      width: win?.innerWidth ?? anchor.ownerDocument.documentElement.clientWidth,
      height:
        win?.innerHeight ?? anchor.ownerDocument.documentElement.clientHeight,
    };
    const f = { width: layer.offsetWidth, height: layer.offsetHeight };
    const pos = computeFloatingPosition(a, f, viewport, {
      align: opts.align,
      gap: opts.gap,
      margin: opts.margin,
    });
    layer.setCssStyles({ left: `${pos.left}px`, top: `${pos.top}px` });
  };

  reposition();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("keydown", onKey, true);
    win?.removeEventListener("resize", reposition, true);
    win?.removeEventListener("scroll", onScroll, true);
    layer.remove();
    opts.onClose?.();
  };

  const onOutside = (ev: MouseEvent): void => {
    const target = ev.target as Node | null;
    if (target && (layer.contains(target) || currentAnchor.contains(target)))
      return;
    close();
  };

  const setAnchor = (next: HTMLElement): void => {
    currentAnchor = next;
    reposition();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  const onScroll = (ev: Event): void => {
    // Ignore scrolling that happens inside the floating box itself.
    const target = ev.target as Node | null;
    if (target && layer.contains(target)) return;
    close();
  };

  const win = doc.defaultView;
  // Defer listener attachment so the click that opened the layer doesn't
  // immediately close it.
  win?.setTimeout(() => {
    if (closed) return;
    if (opts.closeOnOutsideClick !== false) {
      doc.addEventListener("mousedown", onOutside, true);
    }
    doc.addEventListener("keydown", onKey, true);
    win.addEventListener("resize", reposition, true);
    win.addEventListener("scroll", onScroll, true);
  }, 0);

  return { el: layer, reposition, setAnchor, close };
}
