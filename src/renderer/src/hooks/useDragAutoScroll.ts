import { useCallback, useEffect, useRef, type DragEvent, type RefObject, type WheelEvent } from 'react';

type UseDragAutoScrollOptions = {
  edgeThreshold?: number;
  maxSpeed?: number;
};

type DragAutoScrollApi = {
  handlePointerMove: (clientX: number, clientY: number) => void;
  handleDragOver: (event: DragEvent<HTMLElement>) => void;
  handleWheelWhileDragging: (event: WheelEvent<HTMLElement>) => void;
  stopAutoScroll: () => void;
};

export function useDragAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  options?: UseDragAutoScrollOptions,
): DragAutoScrollApi {
  const edgeThreshold = options?.edgeThreshold ?? 72;
  const maxSpeed = options?.maxSpeed ?? 18;
  const speedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const stopAutoScroll = useCallback(() => {
    speedRef.current = 0;
    pointerRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const normalizeWheelDelta = useCallback((deltaY: number, deltaMode: number, clientHeight: number) => {
    let pixelDelta = deltaY;
    if (deltaMode === 1) {
      // WheelEvent.DOM_DELTA_LINE
      pixelDelta *= 16;
    } else if (deltaMode === 2) {
      // WheelEvent.DOM_DELTA_PAGE
      pixelDelta *= clientHeight;
    }
    return pixelDelta;
  }, []);

  const applyWheelScroll = useCallback((deltaY: number, deltaMode: number) => {
    const container = containerRef.current;
    if (!container) return;

    const pixelDelta = normalizeWheelDelta(deltaY, deltaMode, container.clientHeight);
    container.scrollTop += pixelDelta;
  }, [containerRef, normalizeWheelDelta]);

  const loop = useRef<() => void>(() => {});
  loop.current = () => {
    const container = containerRef.current;
    if (!container) {
      stopAutoScroll();
      return;
    }
    const speed = speedRef.current;
    if (speed === 0) {
      rafRef.current = null;
      return;
    }
    const prev = container.scrollTop;
    container.scrollTop = prev + speed;
    const stuckAtBoundary = container.scrollTop === prev;
    if (stuckAtBoundary) {
      speedRef.current = 0;
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(loop.current);
  };

  const updateSpeedByClientPosition = useCallback((clientX: number, clientY: number) => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    pointerRef.current = { x: clientX, y: clientY };
    const rect = container.getBoundingClientRect();
    const topEdge = rect.top + edgeThreshold;
    const bottomEdge = rect.bottom - edgeThreshold;
    let nextSpeed = 0;

    if (clientY < topEdge) {
      const ratio = Math.min(1, (topEdge - clientY) / edgeThreshold);
      nextSpeed = -Math.max(2, Math.round(maxSpeed * ratio));
    } else if (clientY > bottomEdge) {
      const ratio = Math.min(1, (clientY - bottomEdge) / edgeThreshold);
      nextSpeed = Math.max(2, Math.round(maxSpeed * ratio));
    }

    speedRef.current = nextSpeed;
    if (nextSpeed !== 0 && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(loop.current);
    }
    if (nextSpeed === 0 && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [containerRef, edgeThreshold, enabled, maxSpeed]);

  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    updateSpeedByClientPosition(clientX, clientY);
  }, [updateSpeedByClientPosition]);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    updateSpeedByClientPosition(event.clientX, event.clientY);
  }, [updateSpeedByClientPosition]);

  const handleWheelWhileDragging = useCallback((event: WheelEvent<HTMLElement>) => {
    if (!enabled) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    applyWheelScroll(event.deltaY, event.deltaMode);
  }, [applyWheelScroll, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onGlobalWheel = (event: globalThis.WheelEvent) => {
      if (!containerRef.current) return;

      event.preventDefault();
      applyWheelScroll(event.deltaY, event.deltaMode);
    };

    const onGlobalMouseWheel = (event: Event) => {
      if (!containerRef.current) return;
      const legacy = event as Event & { wheelDelta?: number };
      if (typeof legacy.wheelDelta !== 'number') return;

      event.preventDefault();
      // mousewheel: wheelDelta > 0 means scroll up, opposite of deltaY.
      const deltaY = -legacy.wheelDelta;
      applyWheelScroll(deltaY, 0);
    };

    window.addEventListener('wheel', onGlobalWheel, { capture: true, passive: false });
    window.addEventListener('mousewheel', onGlobalMouseWheel, { capture: true, passive: false });
    document.addEventListener('wheel', onGlobalWheel, { capture: true, passive: false });
    document.addEventListener('mousewheel', onGlobalMouseWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', onGlobalWheel, true);
      window.removeEventListener('mousewheel', onGlobalMouseWheel, true);
      document.removeEventListener('wheel', onGlobalWheel, true);
      document.removeEventListener('mousewheel', onGlobalMouseWheel, true);
    };
  }, [applyWheelScroll, containerRef, enabled]);

  useEffect(() => {
    if (!enabled) {
      stopAutoScroll();
    }
  }, [enabled, stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return {
    handlePointerMove,
    handleDragOver,
    handleWheelWhileDragging,
    stopAutoScroll,
  };
}
