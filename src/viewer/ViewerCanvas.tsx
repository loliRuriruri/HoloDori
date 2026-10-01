import React, { useRef, useEffect, useCallback } from 'react';
import { ViewerRenderer } from './cubism/renderer';
import { ViewportTransform, ViewerBackground } from './types';

interface ViewerCanvasProps {
  renderer: ViewerRenderer | null;
  background?: ViewerBackground;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  onCanvasDestroy: () => void;
  onTransformChange?: (transform: ViewportTransform) => void;
  onDoubleClick?: () => void;
  interactive?: boolean;
}

export const ViewerCanvas: React.FC<ViewerCanvasProps> = ({
  renderer,
  background = 'neutral',
  onCanvasReady,
  onCanvasDestroy,
  onTransformChange,
  onDoubleClick,
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Inform parent when canvas element mounts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      onCanvasReady(canvas);
    }
    return () => {
      onCanvasDestroy();
    };
  }, [onCanvasReady, onCanvasDestroy]);

  // Handle ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !renderer) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          renderer.resize(width, height);
        }
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [renderer]);

  // Pointer drag for panning
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, [interactive]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDraggingRef.current || !renderer) return;

      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Convert pixel delta to normalized view delta
      const current = renderer.getTransform();
      const panFactor = 2.0 / (canvas.clientHeight * current.zoom);

      const newPanX = current.panX + dx * panFactor;
      const newPanY = current.panY - dy * panFactor; // Invert Y for WebGL coordinates

      renderer.setTransform({ panX: newPanX, panY: newPanY });
      if (onTransformChange) {
        onTransformChange(renderer.getTransform());
      }
    },
    [renderer, onTransformChange]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture was already lost
    }
  }, []);

  // Mouse wheel for zooming
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      e.preventDefault();
      if (!renderer) return;

      const current = renderer.getTransform();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(current.zoom * zoomFactor, 0.2), 8.0);

      renderer.setTransform({ zoom: newZoom });
      if (onTransformChange) {
        onTransformChange(renderer.getTransform());
      }
    },
    [renderer, onTransformChange]
  );

  // Background styling
  const getBackgroundStyle = (): React.CSSProperties => {
    switch (background) {
      case 'checkerboard':
        return {
          backgroundColor: '#181a1f',
          backgroundImage:
            'linear-gradient(45deg, #252830 25%, transparent 25%), linear-gradient(-45deg, #252830 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252830 75%), linear-gradient(-45deg, transparent 75%, #252830 75%)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
        };
      case 'transparent':
        return {
          backgroundColor: 'transparent',
        };
      case 'neutral':
      default:
        return {
          backgroundColor: '#16181d',
          backgroundImage:
            'radial-gradient(#252830 1px, transparent 1px), radial-gradient(#252830 1px, #16181d 1px)',
          backgroundSize: '32px 32px',
          backgroundPosition: '0 0, 16px 16px',
        };
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        ...getBackgroundStyle(),
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={onDoubleClick}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: !interactive ? 'default' : isDraggingRef.current ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      />
    </div>
  );
};
