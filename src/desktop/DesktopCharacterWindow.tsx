import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useI18n } from '../i18n';
import { ViewerCanvas } from '../viewer/ViewerCanvas';
import { ViewerRenderer } from '../viewer/cubism/renderer';
import { Live2DModelWrapper } from '../viewer/cubism/model';
import { loadModelPackageFromDisk } from '../viewer/cubism/resources';
import {
  isCubismCoreAvailable,
  acquireCubismFramework,
  releaseCubismFramework,
} from '../viewer/cubism/runtime';
import {
  DesktopWindowSettings,
  DEFAULT_DESKTOP_SETTINGS,
  ModelAnimationMetadata,
  ModelPackageTarget,
} from '../viewer/types';
import { WallpaperStatus } from '../types';
import { loadPlayerState, savePlayerState } from '../viewer/settings';

interface SwitchModelPayload {
  characterId: string;
  outfitId: string;
  packageDir?: string;
  displayName?: string;
}

interface DesktopActionPayload {
  action: string;
  asset_name?: string;
  paused?: boolean;
  fps?: number;
}

const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export const DesktopCharacterWindow: React.FC = () => {
  const { t } = useI18n();
  // Query parameters from initial window spawn
  const params = new URLSearchParams(window.location.search);
  const initialChar = params.get('char') || '00007';
  const initialOutfit = params.get('outfit') || '001';
  const initialPkg = params.get('pkg') || `./output/${initialChar}_${initialOutfit}`;
  const initialDisplay = params.get('display') || `Character ${initialChar} — ${initialOutfit}`;

  const [target, setTarget] = useState<ModelPackageTarget>({
    characterId: initialChar,
    outfitId: initialOutfit,
    packageDir: initialPkg,
    displayName: initialDisplay,
  });

  const [desktopSettings, setDesktopSettings] = useState<DesktopWindowSettings>(DEFAULT_DESKTOP_SETTINGS);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [clickThrough, setClickThrough] = useState<boolean>(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(true);
  const [scale, setScale] = useState<number>(1.0);
  const [fps, setFps] = useState<number>(60);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Wallpaper mode host status
  const [wallpaperStatus, setWallpaperStatus] = useState<WallpaperStatus | null>(null);

  // Animations catalog
  const [animations, setAnimations] = useState<ModelAnimationMetadata | null>(null);

  // Context Menu State (in Lock Mode when click-through is false)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ViewerRenderer | null>(null);
  const modelRef = useRef<Live2DModelWrapper | null>(null);
  const autoMotionTimerRef = useRef<number | null>(null);

  // Apply desktop-mode transparent CSS class to document root
  useEffect(() => {
    document.documentElement.classList.add('desktop-mode');
    document.body.classList.add('desktop-mode');
    return () => {
      document.documentElement.classList.remove('desktop-mode');
      document.body.classList.remove('desktop-mode');
    };
  }, []);

  // Fetch initial wallpaper state and subscribe to changes
  useEffect(() => {
    if (isTauriEnv()) {
      invoke<WallpaperStatus>('get_wallpaper_state')
        .then((res) => setWallpaperStatus(res))
        .catch(() => {});

      const unlistenPromise = listen<WallpaperStatus>('wallpaper-status-changed', (event) => {
        setWallpaperStatus(event.payload);
      });

      return () => {
        unlistenPromise.then((fn) => fn());
      };
    }
  }, []);

  // Load persisted desktop settings on mount
  useEffect(() => {
    loadPlayerState().then((state) => {
      const ds = state.settings.desktop || DEFAULT_DESKTOP_SETTINGS;
      setDesktopSettings(ds);
      setScale(ds.scale || 1.0);
      setFps(ds.fps || 60);
      setAlwaysOnTop(ds.alwaysOnTop ?? true);
      setClickThrough(ds.clickThrough ?? false);
      setEditMode(ds.editMode ?? false);
      setIsPaused(ds.paused ?? false);

      if (rendererRef.current) {
        rendererRef.current.setTargetFps(ds.fps || 60);
        rendererRef.current.setPaused(ds.paused ?? false);
        rendererRef.current.setTransform({ zoom: ds.scale || 1.0 });
      }
    });
  }, []);

  // Update backend window properties when clickThrough or alwaysOnTop change
  const updateClickThrough = useCallback((ct: boolean) => {
    setClickThrough(ct);
    if (isTauriEnv()) {
      invoke('set_desktop_click_through', { clickThrough: ct }).catch(() => {});
    }
  }, []);

  const updateAlwaysOnTop = useCallback((aot: boolean) => {
    setAlwaysOnTop(aot);
    if (isTauriEnv()) {
      invoke('set_desktop_always_on_top', { alwaysOnTop: aot }).catch(() => {});
    }
  }, []);

  // Toggle Edit Mode
  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      if (next) {
        // Entering Edit Mode: temporarily disable click-through so user can interact with controls
        if (isTauriEnv()) {
          invoke('set_desktop_click_through', { clickThrough: false }).catch(() => {});
        }
      } else {
        // Exiting Edit Mode: restore configured click-through
        if (clickThrough && isTauriEnv()) {
          invoke('set_desktop_click_through', { clickThrough: true }).catch(() => {});
        }
      }
      return next;
    });
    setContextMenuPos(null);
  }, [clickThrough]);

  // Global Emergency Hotkey (Ctrl + Shift + D) to toggle Edit Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        toggleEditMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleEditMode]);

  // Save geometry and desktop settings
  const persistDesktopSettings = useCallback(
    async (overrides?: Partial<DesktopWindowSettings>) => {
      try {
        if (!isTauriEnv()) return;
        const win = getCurrentWindow();
        const pos = await win.outerPosition().catch(() => null);
        const size = await win.innerSize().catch(() => null);
        const dpr = await win.scaleFactor().catch(() => 1.0);

        const currentDesktop: DesktopWindowSettings = {
          ...desktopSettings,
          x: pos ? pos.x / dpr : desktopSettings.x,
          y: pos ? pos.y / dpr : desktopSettings.y,
          width: size ? size.width / dpr : desktopSettings.width,
          height: size ? size.height / dpr : desktopSettings.height,
          scale,
          fps,
          alwaysOnTop,
          clickThrough,
          editMode,
          paused: isPaused,
          ...overrides,
        };

        setDesktopSettings(currentDesktop);
        const fullState = await loadPlayerState();
        await savePlayerState({
          ...fullState,
          settings: {
            ...fullState.settings,
            desktop: currentDesktop,
          },
        });
      } catch {
        // Ignore in tests
      }
    },
    [desktopSettings, scale, fps, alwaysOnTop, clickThrough, editMode, isPaused]
  );

  // Load Model & Animations
  const loadTargetModel = useCallback(
    async (modelTarget: ModelPackageTarget, canvas: HTMLCanvasElement) => {
      if (!isCubismCoreAvailable()) {
        setStatus('error');
        setErrorMessage('Cubism Core not found.');
        return;
      }

      setStatus('loading');
      setErrorMessage(null);

      try {
        acquireCubismFramework();

        // 1. Create or get renderer
        let currentRenderer = rendererRef.current;
        if (!currentRenderer) {
          currentRenderer = new ViewerRenderer({
            canvas,
          });
          rendererRef.current = currentRenderer;
          currentRenderer.start();
        }

        currentRenderer.setTargetFps(fps);
        currentRenderer.setPaused(isPaused);
        currentRenderer.setTransform({ zoom: scale, panX: 0, panY: 0 });

        // 2. Load package resources from disk
        const loadedPackage = await loadModelPackageFromDisk(modelTarget.packageDir, modelTarget.modelJsonFile);

        // 3. Initialize model wrapper
        if (modelRef.current) {
          modelRef.current.disposeModel(currentRenderer.getGL());
          modelRef.current = null;
        }

        const modelWrapper = new Live2DModelWrapper();
        await modelWrapper.init(
          currentRenderer.getGL(),
          loadedPackage,
          canvas.width || 500,
          canvas.height || 700
        );

        modelRef.current = modelWrapper;
        currentRenderer.setModel(modelWrapper);

        // 4. Fetch animations from catalog
        try {
          if (isTauriEnv()) {
            const animData = await invoke<ModelAnimationMetadata>('get_model_animations', {
              characterId: modelTarget.characterId,
            });
            setAnimations(animData);

            // Preload first motion if available
            if (animData.motions && animData.motions.length > 0) {
              const firstMot = animData.motions[0];
              try {
                const bytes = await invoke<number[]>('get_motion_bytes', {
                  objectName: firstMot.object_name,
                  assetName: firstMot.asset_name,
                  md5: firstMot.md5,
                  expectedSize: firstMot.size_bytes,
                });
                const uint8 = new Uint8Array(bytes);
                const ab = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
                modelWrapper.getMotionManager().playMotion(ab, firstMot.asset_name, firstMot.name);
              } catch (firstErr) {
                console.warn('[DesktopWindow] Error preloading motion:', firstErr);
              }
            }
          }
        } catch (animErr) {
          console.warn('[DesktopWindow] Could not load animations for character:', animErr);
        }

        setStatus('ready');
      } catch (err: unknown) {
        console.error('[DesktopWindow] Initialization failed:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to initialize desktop character.');
      }
    },
    [fps, isPaused, scale]
  );

  // Initialize viewer when canvas element mounts or target changes
  const handleCanvasReady = useCallback(
    (canvas: HTMLCanvasElement) => {
      canvasRef.current = canvas;
      loadTargetModel(target, canvas);
    },
    [loadTargetModel, target]
  );

  const handleCanvasDestroy = useCallback(() => {
    canvasRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoMotionTimerRef.current) {
        clearInterval(autoMotionTimerRef.current);
      }
      if (modelRef.current && rendererRef.current) {
        modelRef.current.disposeModel(rendererRef.current.getGL());
        modelRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      releaseCubismFramework();
    };
  }, []);

  // Play a motion by asset name
  const playMotionByName = useCallback(
    async (assetName: string) => {
      const model = modelRef.current;
      if (!model || !animations?.motions) return;
      const motion = animations.motions.find((m) => m.asset_name === assetName);
      if (!motion) return;
      try {
        const bytes = await invoke<number[]>('get_motion_bytes', {
          objectName: motion.object_name,
          assetName: motion.asset_name,
          md5: motion.md5,
          expectedSize: motion.size_bytes,
        });
        const uint8 = new Uint8Array(bytes);
        const ab = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
        model.getMotionManager().playMotion(ab, motion.asset_name, motion.name);
      } catch (err) {
        console.error('[DesktopWindow] Error playing motion:', err);
      }
    },
    [animations]
  );

  // Apply expression by asset name
  const applyExpressionByName = useCallback(
    async (assetName: string) => {
      const model = modelRef.current;
      if (!model || !animations?.expressions) return;
      const expr = animations.expressions.find((e) => e.asset_name === assetName);
      if (!expr) return;
      try {
        const bytes = await invoke<number[]>('get_expression_bytes', {
          objectName: expr.object_name,
          assetName: expr.asset_name,
          md5: expr.md5,
          expectedSize: expr.size_bytes,
        });
        const uint8 = new Uint8Array(bytes);
        const ab = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
        model.getExpressionManager().applyExpression(ab, expr.asset_name, expr.name);
      } catch (err) {
        console.error('[DesktopWindow] Error applying expression:', err);
      }
    },
    [animations]
  );

  // Play random motion from catalog
  const playRandomMotion = useCallback(() => {
    if (!animations?.motions || animations.motions.length === 0) return;
    const idx = Math.floor(Math.random() * animations.motions.length);
    playMotionByName(animations.motions[idx].asset_name);
  }, [animations, playMotionByName]);

  // Listen to Tauri events: 'switch-model', 'desktop-action', 'click-through-changed', 'always-on-top-changed'
  useEffect(() => {
    if (!isTauriEnv()) return;

    const unlistenModelPromise = listen<SwitchModelPayload>('switch-model', (event) => {
      const p = event.payload;
      const newTarget: ModelPackageTarget = {
        characterId: p.characterId,
        outfitId: p.outfitId,
        packageDir: p.packageDir || `./output/${p.characterId}_${p.outfitId}`,
        displayName: p.displayName || `Character ${p.characterId} — ${p.outfitId}`,
      };
      setTarget(newTarget);
      if (canvasRef.current) {
        loadTargetModel(newTarget, canvasRef.current);
      }
    });

    const unlistenActionPromise = listen<DesktopActionPayload>('desktop-action', (event) => {
      const p = event.payload;
      switch (p.action) {
        case 'play_motion':
          if (p.asset_name) playMotionByName(p.asset_name);
          break;
        case 'apply_expression':
          if (p.asset_name) applyExpressionByName(p.asset_name);
          break;
        case 'stop_motion':
          if (modelRef.current) modelRef.current.getMotionManager().stopMotion();
          break;
        case 'clear_expression':
          if (modelRef.current) modelRef.current.getExpressionManager().clearExpression();
          break;
        case 'random_motion':
          playRandomMotion();
          break;
        case 'toggle_pause':
          setIsPaused((prev) => {
            const next = !prev;
            if (rendererRef.current) rendererRef.current.setPaused(next);
            return next;
          });
          break;
        case 'set_pause':
          if (typeof p.paused === 'boolean') {
            setIsPaused(p.paused);
            if (rendererRef.current) rendererRef.current.setPaused(p.paused);
          }
          break;
        case 'set_fps':
          if (p.fps) {
            setFps(p.fps);
            if (rendererRef.current) rendererRef.current.setTargetFps(p.fps);
          }
          break;
        case 'toggle_lock':
          toggleEditMode();
          break;
        case 'toggle_click_through':
          updateClickThrough(!clickThrough);
          break;
        case 'toggle_always_on_top':
          updateAlwaysOnTop(!alwaysOnTop);
          break;
        case 'close':
          invoke('close_desktop_window').catch(() => {});
          break;
      }
    });

    const unlistenCtPromise = listen<boolean>('click-through-changed', (e) => {
      setClickThrough(e.payload);
    });

    const unlistenAotPromise = listen<boolean>('always-on-top-changed', (e) => {
      setAlwaysOnTop(e.payload);
    });

    return () => {
      unlistenModelPromise.then((f) => f());
      unlistenActionPromise.then((f) => f());
      unlistenCtPromise.then((f) => f());
      unlistenAotPromise.then((f) => f());
    };
  }, [
    loadTargetModel,
    playMotionByName,
    applyExpressionByName,
    playRandomMotion,
    toggleEditMode,
    clickThrough,
    alwaysOnTop,
    updateClickThrough,
    updateAlwaysOnTop,
  ]);

  // Adjust zoom/scale
  const handleScaleChange = useCallback(
    (newScale: number) => {
      const clamped = Math.min(Math.max(newScale, 0.25), 3.0);
      setScale(clamped);
      if (rendererRef.current) {
        rendererRef.current.setTransform({ zoom: clamped });
      }
      persistDesktopSettings({ scale: clamped });
    },
    [persistDesktopSettings]
  );

  // Toggle FPS between 30 and 60
  const toggleFps = useCallback(() => {
    const nextFps = fps === 60 ? 30 : 60;
    setFps(nextFps);
    if (rendererRef.current) {
      rendererRef.current.setTargetFps(nextFps);
    }
    persistDesktopSettings({ fps: nextFps });
  }, [fps, persistDesktopSettings]);

  // Toggle pause/resume
  const togglePause = useCallback(() => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    if (rendererRef.current) {
      rendererRef.current.setPaused(nextPaused);
    }
    persistDesktopSettings({ paused: nextPaused });
    setContextMenuPos(null);
  }, [isPaused, persistDesktopSettings]);

  // Drag start handler for Edit Mode
  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 0 && isTauriEnv()) {
        try {
          getCurrentWindow().startDragging();
        } catch {
          // Ignore
        }
      }
    },
    []
  );

  // Context Menu handler in Lock Mode
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (editMode || clickThrough) return;
      e.preventDefault();
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    },
    [editMode, clickThrough]
  );

  return (
    <div
      onContextMenu={handleContextMenu}
      onClick={() => {
        if (contextMenuPos) setContextMenuPos(null);
      }}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'transparent',
        border: editMode ? '2px dashed rgba(59, 130, 246, 0.7)' : 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* Canvas container */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
        <ViewerCanvas
          renderer={rendererRef.current}
          background="transparent"
          interactive={editMode}
          onCanvasReady={handleCanvasReady}
          onCanvasDestroy={handleCanvasDestroy}
          onDoubleClick={editMode ? () => handleScaleChange(1.0) : playRandomMotion}
        />
      </div>

      {/* --- EDIT MODE TOP TOOLBAR --- */}
      {editMode && (
        <div
          data-tauri-drag-region
          onPointerDown={handleDragStart}
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: '8px',
            background: 'rgba(24, 27, 34, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid #3b82f6',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            zIndex: 100,
            cursor: 'move',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            userSelect: 'none',
          }}
        >
          {/* Title & Drag indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1 }}>
            <span style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 'bold' }}>✥</span>
            <span
              style={{
                fontSize: '11px',
                color: '#e2e8f0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '120px',
              }}
              title={target.displayName}
            >
              {target.displayName || `${target.characterId}_${target.outfitId}`}
            </span>
          </div>

          {/* Scale controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleScaleChange(scale - 0.1);
              }}
              style={{
                background: '#21252b',
                border: '1px solid #3e4451',
                borderRadius: '4px',
                color: '#e2e8f0',
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                fontSize: '11px',
                padding: 0,
              }}
              title="Scale Down"
            >
              -
            </button>
            <span style={{ fontSize: '11px', color: '#abb2bf', minWidth: '32px', textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleScaleChange(scale + 0.1);
              }}
              style={{
                background: '#21252b',
                border: '1px solid #3e4451',
                borderRadius: '4px',
                color: '#e2e8f0',
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                fontSize: '11px',
                padding: 0,
              }}
              title="Scale Up"
            >
              +
            </button>
          </div>

          {/* Wallpaper Host Badge & Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                fontSize: '9px',
                padding: '2px 5px',
                borderRadius: '4px',
                background: wallpaperStatus?.is_wallpaper_active
                  ? 'rgba(16, 185, 129, 0.25)'
                  : wallpaperStatus?.is_fallback
                  ? 'rgba(234, 179, 8, 0.25)'
                  : 'rgba(59, 130, 246, 0.25)',
                border: `1px solid ${
                  wallpaperStatus?.is_wallpaper_active
                    ? '#10b981'
                    : wallpaperStatus?.is_fallback
                    ? '#eab308'
                    : '#3b82f6'
                }`,
                color: wallpaperStatus?.is_wallpaper_active
                  ? '#34d399'
                  : wallpaperStatus?.is_fallback
                  ? '#facc15'
                  : '#60a5fa',
                fontWeight: 'bold',
                letterSpacing: '0.3px',
              }}
              title={
                wallpaperStatus?.is_wallpaper_active
                  ? `True Wallpaper Active: hosted on ${wallpaperStatus.active_host}`
                  : wallpaperStatus?.is_fallback
                  ? `Fallback Overlay Mode (${wallpaperStatus.error_message || 'Explorer host unavailable'})`
                  : 'Desktop Overlay Mode'
              }
            >
              {wallpaperStatus?.is_wallpaper_active
                ? `WP: ${wallpaperStatus.active_host.toUpperCase()}`
                : wallpaperStatus?.is_fallback
                ? 'OVERLAY (FALLBACK)'
                : 'OVERLAY'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTauriEnv()) {
                  const nextPref = wallpaperStatus?.is_wallpaper_active
                    ? 'desktop_overlay'
                    : 'auto';
                  invoke('set_wallpaper_mode', { preference: nextPref }).catch(() => {});
                }
              }}
              style={{
                background: wallpaperStatus?.is_wallpaper_active ? '#065f46' : '#21252b',
                border: `1px solid ${wallpaperStatus?.is_wallpaper_active ? '#10b981' : '#3e4451'}`,
                borderRadius: '4px',
                color: '#e2e8f0',
                padding: '2px 5px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
              title="Toggle Wallpaper Mode (WorkerW / Progman) vs Overlay"
            >
              {wallpaperStatus?.is_wallpaper_active ? '🖼️ Wallpaper' : '🪟 Overlay'}
            </button>
          </div>

          {/* Quick Toggles: FPS, Always on Top, Click-Through */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFps();
              }}
              style={{
                background: fps === 60 ? '#1e3a8a' : '#21252b',
                border: `1px solid ${fps === 60 ? '#3b82f6' : '#3e4451'}`,
                borderRadius: '4px',
                color: '#e2e8f0',
                padding: '2px 5px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
              title="Toggle Target Framerate (30 vs 60 FPS)"
            >
              {fps} FPS
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateAlwaysOnTop(!alwaysOnTop);
              }}
              style={{
                background: alwaysOnTop ? '#1e3a8a' : '#21252b',
                border: `1px solid ${alwaysOnTop ? '#3b82f6' : '#3e4451'}`,
                borderRadius: '4px',
                color: '#e2e8f0',
                padding: '2px 5px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
              title={alwaysOnTop ? 'Always On Top: ON' : 'Always On Top: OFF'}
            >
              📌
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateClickThrough(!clickThrough);
              }}
              style={{
                background: clickThrough ? '#065f46' : '#21252b',
                border: `1px solid ${clickThrough ? '#10b981' : '#3e4451'}`,
                borderRadius: '4px',
                color: '#e2e8f0',
                padding: '2px 5px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
              title={clickThrough ? 'Click-Through: Enabled' : 'Click-Through: Disabled'}
            >
              🖱️
            </button>
          </div>

          {/* Lock & Close buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleEditMode();
              }}
              style={{
                background: '#2563eb',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                padding: '2px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              title="Lock Character (Ctrl+Shift+D)"
            >
              🔒 Lock
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTauriEnv()) {
                  invoke('close_desktop_window').catch(() => {});
                }
              }}
              style={{
                background: '#ef4444',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                cursor: 'pointer',
              }}
              title="Close Desktop Window"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* --- LOCK MODE CONTEXT MENU --- */}
      {!editMode && contextMenuPos && (
        <div
          style={{
            position: 'fixed',
            top: contextMenuPos.y,
            left: contextMenuPos.x,
            background: 'rgba(20, 24, 33, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '4px 0',
            minWidth: '180px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              color: '#94a3b8',
              borderBottom: '1px solid #334155',
              fontWeight: 'bold',
            }}
          >
            {target.displayName || `${target.characterId} — ${target.outfitId}`}
          </div>
          <button
            onClick={() => {
              toggleEditMode();
            }}
            style={contextMenuItemStyle}
          >
            🔓 {t('desktop.menu_edit')} (Ctrl+Shift+D)
          </button>
          <button
            onClick={() => {
              playRandomMotion();
              setContextMenuPos(null);
            }}
            style={contextMenuItemStyle}
          >
            🎲 {t('desktop.menu_random_motion')}
          </button>
          <button onClick={togglePause} style={contextMenuItemStyle}>
            {isPaused ? `▶️ ${t('desktop.resume')}` : `⏸️ ${t('desktop.pause')}`}
          </button>
          <button
            onClick={() => {
              updateAlwaysOnTop(!alwaysOnTop);
              setContextMenuPos(null);
            }}
            style={contextMenuItemStyle}
          >
            {alwaysOnTop ? `📌 ${t('desktop.always_on_top')}: ON` : `📌 ${t('desktop.always_on_top')}: OFF`}
          </button>
          <button
            onClick={() => {
              updateClickThrough(true);
              setContextMenuPos(null);
            }}
            style={contextMenuItemStyle}
          >
            🖱️ {t('desktop.menu_click_through')}
          </button>
          <div style={{ height: '1px', background: '#334155', margin: '4px 0' }} />
          <button
            onClick={() => {
              if (isTauriEnv()) {
                const nextPref = wallpaperStatus?.is_wallpaper_active
                  ? 'desktop_overlay'
                  : 'auto';
                invoke('set_wallpaper_mode', { preference: nextPref }).catch(() => {});
              }
              setContextMenuPos(null);
            }}
            style={contextMenuItemStyle}
          >
            {wallpaperStatus?.is_wallpaper_active
              ? `🪟 ${t('wallpaper.disable')}`
              : `🖼️ ${t('wallpaper.enable')}`}
          </button>
          <button
            onClick={() => {
              if (isTauriEnv()) {
                invoke('recover_wallpaper').catch(() => {});
              }
              setContextMenuPos(null);
            }}
            style={contextMenuItemStyle}
          >
            🔄 {t('wallpaper.recover')}
          </button>
          <div style={{ height: '1px', background: '#334155', margin: '4px 0' }} />
          <button
            onClick={() => {
              if (isTauriEnv()) {
                invoke('close_desktop_window').catch(() => {});
              }
            }}
            style={{ ...contextMenuItemStyle, color: '#f87171' }}
          >
            ✕ {t('desktop.menu_close')}
          </button>
        </div>
      )}

      {/* Loading or Error feedback */}
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            background: 'rgba(0,0,0,0.7)',
            color: '#60a5fa',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            pointerEvents: 'none',
          }}
        >
          Loading character...
        </div>
      )}
      {status === 'error' && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            background: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            maxWidth: '300px',
          }}
        >
          {errorMessage || 'Failed to load model.'}
        </div>
      )}
    </div>
  );
};

const contextMenuItemStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  color: '#e2e8f0',
  fontSize: '12px',
  cursor: 'pointer',
  display: 'block',
};
