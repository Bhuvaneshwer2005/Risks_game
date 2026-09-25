import { useCallback, useEffect, useRef } from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const DRAG_THRESHOLD = 5;

interface ViewState {
  k: number;
  cx: number;
  cy: number;
}

/** Screen pixels covered by floating UI on each side; "fit" centers the board in what's left. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Pan and zoom for an SVG by rewriting its viewBox directly (no React
 * re-render per frame). Wheel zooms toward the cursor, drag pans, two
 * fingers pinch. `consumeDrag()` tells a click handler whether the pointer
 * gesture was actually a drag and should not count as a click.
 */
export function usePanZoom(width: number, height: number, enabled: boolean, insets: Insets = NO_INSETS) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useRef<ViewState>({ k: 1, cx: width / 2, cy: height / 2 });
  const size = useRef({ w: 1, h: 1 });
  const dragged = useRef(false);
  const animation = useRef<number | null>(null);
  const fittedOnce = useRef(false);
  const insetsRef = useRef(insets);
  useEffect(() => {
    insetsRef.current = insets;
  });

  // At zoom 1 the whole board fits in the part of the container that isn't
  // covered by UI; the viewBox still spans the full container.
  const fitted = useCallback(() => {
    const { w, h } = size.current;
    const i = insetsRef.current;
    const freeW = Math.max(w * 0.4, w - i.left - i.right);
    const freeH = Math.max(h * 0.4, h - i.top - i.bottom);
    const s = Math.min(freeW / width, freeH / height);
    return {
      vw: w / s,
      vh: h / s,
      homeX: width / 2 + (Math.min(i.right, w * 0.3) - Math.min(i.left, w * 0.3)) / 2 / s,
      homeY: height / 2 + (Math.min(i.bottom, h * 0.3) - Math.min(i.top, h * 0.3)) / 2 / s,
    };
  }, [width, height]);

  const apply = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { vw, vh } = fitted();
    const v = view.current;
    const w = vw / v.k;
    const h = vh / v.k;
    // Keep the board in view: the center may not leave the board.
    v.cx = Math.min(Math.max(v.cx, 0), width);
    v.cy = Math.min(Math.max(v.cy, 0), height);
    svg.setAttribute("viewBox", `${v.cx - w / 2} ${v.cy - h / 2} ${w} ${h}`);
  }, [fitted, width, height]);

  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const { vw, vh } = fitted();
      const v = view.current;
      const w = vw / v.k;
      const h = vh / v.k;
      return {
        x: v.cx - w / 2 + ((clientX - rect.left) / rect.width) * w,
        y: v.cy - h / 2 + ((clientY - rect.top) / rect.height) * h,
        fx: (clientX - rect.left) / rect.width,
        fy: (clientY - rect.top) / rect.height,
      };
    },
    [fitted],
  );

  const zoomAt = useCallback(
    (nextK: number, fx: number, fy: number, px: number, py: number) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextK));
      const { vw, vh } = fitted();
      const w = vw / k;
      const h = vh / k;
      view.current = { k, cx: px - fx * w + w / 2, cy: py - fy * h + h / 2 };
      apply();
    },
    [apply, fitted],
  );

  const animateTo = useCallback(
    (target: ViewState) => {
      if (animation.current) cancelAnimationFrame(animation.current);
      const start = { ...view.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 260);
        const e = 1 - (1 - t) ** 3;
        view.current = {
          k: start.k + (target.k - start.k) * e,
          cx: start.cx + (target.cx - start.cx) * e,
          cy: start.cy + (target.cy - start.cy) * e,
        };
        apply();
        animation.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animation.current = requestAnimationFrame(step);
    },
    [apply],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const v = view.current;
      animateTo({ k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor)), cx: v.cx, cy: v.cy });
    },
    [animateTo],
  );

  const fit = useCallback(() => {
    const { homeX, homeY } = fitted();
    animateTo({ k: 1, cx: homeX, cy: homeY });
  }, [animateTo, fitted]);

  /** Pan (and optionally zoom) so a board point is centered. */
  const focus = useCallback(
    (x: number, y: number, k?: number) => animateTo({ k: k ?? Math.max(view.current.k, 1.6), cx: x, cy: y }),
    [animateTo],
  );

  const consumeDrag = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const resize = () => {
      const rect = svg.getBoundingClientRect();
      size.current = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      if (!fittedOnce.current && rect.width > 1) {
        // First real layout: start centered in the free area. On a portrait
        // phone the whole world is tiny, so zoom until it fills the free
        // height instead (drag sideways to see the rest).
        fittedOnce.current = true;
        const { homeX, homeY } = fitted();
        const i = insetsRef.current;
        const freeW = rect.width - i.left - i.right;
        const freeH = rect.height - i.top - i.bottom;
        const k = freeH > freeW ? Math.min(2.2, Math.max(1, (freeH / freeW) * (width / height) * 0.9)) : 1;
        view.current = { k, cx: homeX, cy: homeY };
      }
      apply();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(svg);
    if (!enabled) return () => observer.disconnect();

    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { dist: number; k: number } | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toBoard(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(view.current.k * factor, p.fx, p.fy, p.x, p.y);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        dragged.current = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k };
      }
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const mid = toBoard((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist, mid.fx, mid.fy, mid.x, mid.y);
        dragged.current = true;
        return;
      }
      if (!start) return;
      if (!dragged.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      if (!dragged.current) {
        dragged.current = true;
        svg.setPointerCapture(e.pointerId);
      }
      const rect = svg.getBoundingClientRect();
      const { vw } = fitted();
      const unitsPerPx = vw / view.current.k / rect.width;
      view.current.cx -= (e.clientX - prev.x) * unitsPerPx;
      view.current.cy -= (e.clientY - prev.y) * unitsPerPx;
      apply();
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) start = null;
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    return () => {
      observer.disconnect();
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    };
  }, [apply, enabled, fitted, toBoard, zoomAt, width, height]);

  useEffect(
    () => () => {
      if (animation.current) cancelAnimationFrame(animation.current);
    },
    [],
  );

  return { svgRef, zoomBy, fit, focus, consumeDrag };
}
