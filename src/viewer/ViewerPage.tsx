import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ModelPackageTarget,
  ViewerStatus,
  ViewportTransform,
  ViewerOptions,
  ModelParameterInfo,
  ModelAnimationMetadata,
  MotionCatalogEntry,
  ExpressionCatalogEntry,
  MotionPlaybackState,
  MotionPlayInfo,
  ExpressionPlayInfo,
  ViewerMode,
  ViewerBackground,
  ViewerSettings,
  PlayerFavorites,
  RecentModel,
  ModelDiagnostics,
} from './types';
import {
  DEFAULT_VIEWER_SETTINGS,
  DEFAULT_FAVORITES,
  loadPlayerState,
  savePlayerState,
  pushRecentModel,
  toggleFavoriteItem,
} from './settings';
import {
  isCubismCoreAvailable,
  acquireCubismFramework,
  releaseCubismFramework,
} from './cubism/runtime';
import { loadModelPackageFromDisk } from './cubism/resources';
import { Live2DModelWrapper } from './cubism/model';
import { ViewerRenderer } from './cubism/renderer';
import { ViewerCanvas } from './ViewerCanvas';
import { ViewerControls } from './ViewerControls';
import { CharacterLibrary } from '../types';

export interface ViewerPageProps {
  target: ModelPackageTarget;
  onBack: () => void;
  library?: CharacterLibrary | null;
  outputDir?: string;
  onSwitchModel?: (newTarget: ModelPackageTarget) => void;
}

export const ViewerPage: React.FC<ViewerPageProps> = ({
  target,
  onBack,
  library,
  outputDir,
  onSwitchModel,
}) => {
  const [currentTarget, setCurrentTarget] = useState<ModelPackageTarget>(target);

  // Sync if target prop changes externally
  useEffect(() => {
    setCurrentTarget(target);
  }, [target]);

  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [renderer, setRenderer] = useState<ViewerRenderer | null>(null);
  const [parameters, setParameters] = useState<ModelParameterInfo[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Player Settings & Favorites
  const [playerSettings, setPlayerSettings] = useState<ViewerSettings>(DEFAULT_VIEWER_SETTINGS);
  const [favorites, setFavorites] = useState<PlayerFavorites>(DEFAULT_FAVORITES);
  const [recentModels, setRecentModels] = useState<RecentModel[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDesktopActive, setIsDesktopActive] = useState(false);

  // Animations & Expressions State
  const [animations, setAnimations] = useState<ModelAnimationMetadata | null>(null);
  const [isLoadingAnimations, setIsLoadingAnimations] = useState(false);
  const [motionState, setMotionState] = useState<MotionPlaybackState>('idle');
  const [currentMotionInfo, setCurrentMotionInfo] = useState<MotionPlayInfo | null>(null);
  const [currentExpressionInfo, setCurrentExpressionInfo] = useState<ExpressionPlayInfo | null>(null);
  const [motionProgress, setMotionProgress] = useState(0);
  const [motionElapsed, setMotionElapsed] = useState(0);

  const [transform, setTransform] = useState<ViewportTransform>({
    zoom: 1.0,
    panX: 0.0,
    panY: 0.0,
  });

  const [viewerOptions, setViewerOptions] = useState<ViewerOptions>({
    enableBreath: true,
    enableEyeBlink: true,
    enablePhysics: true,
  });

  const [diagnostics, setDiagnostics] = useState<ModelDiagnostics>({
    fps: 0,
    modelId: `${target.characterId}_${target.outfitId}`,
    mocVersion: '3 (Cubism 3.0+)',
    paramCount: 0,
    playingMotion: null,
    activeExpression: null,
    physicsLoaded: false,
    physicsSettingsCount: 0,
    webglVendor: 'WebGL',
    webglRenderer: 'WebGL',
    coreVersion: '4.x',
  });

  const modelRef = useRef<Live2DModelWrapper | null>(null);
  const rendererRef = useRef<ViewerRenderer | null>(null);
  const lastPlayedMotionNameRef = useRef<string | null>(null);
  const autoMotionTimerRef = useRef<number | null>(null);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    setCanvasElement(canvas);
  }, []);

  const handleCanvasDestroy = useCallback(() => {
    setCanvasElement(null);
  }, []);

  // Load persisted player settings and favorites on mount
  useEffect(() => {
    loadPlayerState().then((state) => {
      setPlayerSettings(state.settings);
      setFavorites(state.favorites);
      setRecentModels(state.recentModels);
      const opts: ViewerOptions = {
        enableBreath: state.settings.enableBreath,
        enableEyeBlink: state.settings.enableBlink,
        enablePhysics: state.settings.enablePhysics,
      };
      setViewerOptions(opts);
      if (rendererRef.current) {
        rendererRef.current.setViewerOptions(opts);
      }
    });
  }, []);

  // Sync Fullscreen state
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Check and listen to Desktop Window state
  useEffect(() => {
    const checkDesktop = async () => {
      try {
        const state = await invoke<{ is_open: boolean }>('get_desktop_window_state');
        setIsDesktopActive(state?.is_open ?? false);
      } catch {
        // Fallback in tests
      }
    };
    checkDesktop();

    const unlistenPromise = listen<{ is_open: boolean }>('desktop-state-changed', (e) => {
      setIsDesktopActive(e.payload?.is_open ?? false);
    });

    return () => {
      unlistenPromise.then((f) => f()).catch(() => {});
    };
  }, []);

  const handleSendToDesktop = useCallback(async () => {
    try {
      const ds = playerSettings.desktop;
      await invoke('open_desktop_window', {
        req: {
          character_id: currentTarget.characterId,
          outfit_id: currentTarget.outfitId,
          package_dir: currentTarget.packageDir,
          display_name: currentTarget.displayName,
          x: ds?.x,
          y: ds?.y,
          width: ds?.width,
          height: ds?.height,
          always_on_top: ds?.alwaysOnTop,
          click_through: ds?.clickThrough,
        },
      });
      setIsDesktopActive(true);
    } catch (err) {
      console.error('[ViewerPage] Failed to send model to desktop:', err);
    }
  }, [currentTarget, playerSettings.desktop]);

  const handleCloseDesktop = useCallback(async () => {
    try {
      await invoke('close_desktop_window');
      setIsDesktopActive(false);
    } catch (err) {
      console.error('[ViewerPage] Failed to close desktop window:', err);
    }
  }, []);

  const handleRemotePlayRandomMotion = useCallback(() => {
    invoke('send_desktop_control', { action: 'random_motion', payload: null }).catch(() => {});
  }, []);

  // Available Characters and Outfits derived from library
  const availableCharacters = useMemo(() => {
    if (library?.characters && library.characters.length > 0) {
      return library.characters.map((c) => c.character_id);
    }
    return [currentTarget.characterId];
  }, [library, currentTarget.characterId]);

  const availableOutfits = useMemo(() => {
    if (library?.characters) {
      const char = library.characters.find((c) => c.character_id === currentTarget.characterId);
      if (char && char.outfits.length > 0) {
        return char.outfits.map((o) => o.outfit_id);
      }
    }
    return [currentTarget.outfitId];
  }, [library, currentTarget.characterId, currentTarget.outfitId]);

  const getBaseOutputDir = useCallback(() => {
    if (outputDir) return outputDir;
    const idx = currentTarget.packageDir.lastIndexOf('/');
    if (idx > 0) return currentTarget.packageDir.substring(0, idx);
    const winIdx = currentTarget.packageDir.lastIndexOf('\\');
    if (winIdx > 0) return currentTarget.packageDir.substring(0, winIdx);
    return './output';
  }, [outputDir, currentTarget.packageDir]);

  const handleSelectCharacter = useCallback(
    (newCharId: string) => {
      let newOutfitId = '001';
      let displayName = `Character ${newCharId}`;
      if (library?.characters) {
        const char = library.characters.find((c) => c.character_id === newCharId);
        if (char && char.outfits.length > 0) {
          newOutfitId = char.outfits[0].outfit_id;
          displayName = `${char.outfits[0].id} (${char.outfits[0].style_token || 'Normal'})`;
        }
      }
      const baseDir = getBaseOutputDir();
      const newTarget: ModelPackageTarget = {
        packageDir: `${baseDir}/${newCharId}_${newOutfitId}`,
        characterId: newCharId,
        outfitId: newOutfitId,
        displayName,
      };
      setCurrentTarget(newTarget);
      if (onSwitchModel) onSwitchModel(newTarget);
    },
    [library, getBaseOutputDir, onSwitchModel]
  );

  const handleSelectOutfit = useCallback(
    (newOutfitId: string) => {
      let displayName = `Character ${currentTarget.characterId} — Outfit ${newOutfitId}`;
      if (library?.characters) {
        const char = library.characters.find((c) => c.character_id === currentTarget.characterId);
        const outfit = char?.outfits.find((o) => o.outfit_id === newOutfitId);
        if (outfit) {
          displayName = `${outfit.id} (${outfit.style_token || 'Normal'})`;
        }
      }
      const baseDir = getBaseOutputDir();
      const newTarget: ModelPackageTarget = {
        packageDir: `${baseDir}/${currentTarget.characterId}_${newOutfitId}`,
        characterId: currentTarget.characterId,
        outfitId: newOutfitId,
        displayName,
      };
      setCurrentTarget(newTarget);
      if (onSwitchModel) onSwitchModel(newTarget);
    },
    [library, getBaseOutputDir, currentTarget.characterId, onSwitchModel]
  );

  const handleSelectRecentModel = useCallback(
    (entry: RecentModel) => {
      const newTarget: ModelPackageTarget = {
        packageDir: entry.packageDir,
        characterId: entry.characterId,
        outfitId: entry.outfitId,
        displayName: entry.displayName,
      };
      setCurrentTarget(newTarget);
      if (onSwitchModel) onSwitchModel(newTarget);
    },
    [onSwitchModel]
  );

  // Fetch Available Animations & Expressions for this character
  useEffect(() => {
    let isCancelled = false;
    async function loadAnimations() {
      setIsLoadingAnimations(true);
      try {
        const data = await invoke<ModelAnimationMetadata>('get_model_animations', {
          characterId: currentTarget.characterId,
          octocachePath: null,
        });
        if (!isCancelled) {
          setAnimations(data);
        }
      } catch (e) {
        if (!isCancelled) {
          console.warn('[ViewerPage] Could not load animations metadata:', e);
          setAnimations({
            character_id: currentTarget.characterId,
            expressions: [],
            motions: [],
          });
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingAnimations(false);
        }
      }
    }

    loadAnimations();

    return () => {
      isCancelled = true;
    };
  }, [currentTarget.characterId]);

  // Initialize WebGL and Load Model Package (supports multi-switch without context recreation)
  useEffect(() => {
    if (!canvasElement) return;

    let isCancelled = false;

    async function initOrUpdateViewer() {
      // 1. Verify Cubism Core runtime availability
      if (!isCubismCoreAvailable()) {
        setStatus('error');
        setErrorMessage(
          'Live2D Cubism Core runtime (live2dcubismcore.min.js) is not loaded into the browser. ' +
            'Due to proprietary licensing boundaries, this file is not committed in Git. ' +
            'Please place live2dcubismcore.min.js inside public/live2d/ to enable embedded Live2D viewing.'
        );
        return;
      }

      // 2. Initialize Cubism Framework
      if (!acquireCubismFramework()) {
        setStatus('error');
        setErrorMessage('Failed to initialize Cubism Framework runtime.');
        return;
      }

      try {
        setStatus('loading');

        // Ensure renderer exists on canvas
        let currentRenderer = rendererRef.current;
        if (!currentRenderer) {
          currentRenderer = new ViewerRenderer({
            canvas: canvasElement!,
            onContextLost: () => {
              console.warn('[ViewerPage] WebGL Context Lost');
            },
            onContextRestored: () => {
              console.info('[ViewerPage] WebGL Context Restored');
            },
          });
          const rect = canvasElement!.getBoundingClientRect();
          currentRenderer.resize(rect.width || 800, rect.height || 600);
          currentRenderer.setViewerOptions(viewerOptions);
          rendererRef.current = currentRenderer;
          setRenderer(currentRenderer);
          currentRenderer.start();
        }

        // Cleanly dispose previous model if any
        if (modelRef.current) {
          currentRenderer.setModel(null);
          modelRef.current.disposeModel(currentRenderer.getGL());
          modelRef.current = null;
        }

        // 3. Load package resources from disk via Tauri IPC
        const loadedPackage = await loadModelPackageFromDisk(
          currentTarget.packageDir,
          currentTarget.modelJsonFile
        );

        if (isCancelled) {
          loadedPackage.dispose();
          return;
        }

        // 4. Initialize model wrapper with WebGL context
        const modelWrapper = new Live2DModelWrapper();
        await modelWrapper.init(
          currentRenderer.getGL(),
          loadedPackage,
          canvasElement!.width,
          canvasElement!.height
        );

        if (isCancelled) {
          modelWrapper.disposeModel(currentRenderer.getGL());
          return;
        }

        // Hook up motion, expression, and progress state callbacks
        modelWrapper.getMotionManager().setStateCallback((st, info) => {
          setMotionState(st);
          setCurrentMotionInfo(info);
          if (st === 'idle') {
            setMotionProgress(0);
            setMotionElapsed(0);
          }
        });
        modelWrapper.getMotionManager().setProgressCallback((prog, elap) => {
          setMotionProgress(prog);
          setMotionElapsed(elap);
        });
        modelWrapper.getExpressionManager().setCallback((info) => {
          setCurrentExpressionInfo(info);
        });

        modelRef.current = modelWrapper;
        currentRenderer.setModel(modelWrapper);

        // 5. Extract initial parameters for inspector
        const initialParams = modelWrapper.getParameters();
        setParameters(initialParams);

        // 6. Update Recent Models
        const modelId = `${currentTarget.characterId}_${currentTarget.outfitId}`;
        const display =
          currentTarget.displayName ||
          `Character ${currentTarget.characterId} — Outfit ${currentTarget.outfitId}`;
        setRecentModels((prev) => {
          const updated = pushRecentModel(prev, {
            modelId,
            characterId: currentTarget.characterId,
            outfitId: currentTarget.outfitId,
            displayName: display,
            packageDir: currentTarget.packageDir,
          });
          savePlayerState({
            settings: {
              ...playerSettings,
              lastCharacterId: currentTarget.characterId,
              lastOutfitId: currentTarget.outfitId,
            },
            favorites,
            recentModels: updated,
          });
          return updated;
        });

        setStatus('ready');
      } catch (err: unknown) {
        if (!isCancelled) {
          console.error('[ViewerPage] Initialization error:', err);
          setStatus('error');
          setErrorMessage(
            err instanceof Error ? err.message : 'Unknown error during model initialization.'
          );
        }
      }
    }

    initOrUpdateViewer();

    return () => {
      isCancelled = true;
    };
  }, [currentTarget, canvasElement]);

  // Dispose renderer on component unmount
  useEffect(() => {
    return () => {
      if (modelRef.current && rendererRef.current) {
        modelRef.current.disposeModel(rendererRef.current.getGL());
        modelRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      setRenderer(null);
      releaseCubismFramework();
    };
  }, []);

  // Motion Actions
  const handlePlayMotion = useCallback(async (motion: MotionCatalogEntry) => {
    if (!modelRef.current) return;
    try {
      setMotionState('loading');
      const bytes = await invoke<number[]>('get_motion_bytes', {
        objectName: motion.object_name,
        assetName: motion.asset_name,
        md5: motion.md5,
        expectedSize: motion.size_bytes,
      });
      const uint8 = new Uint8Array(bytes);
      const ab = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
      lastPlayedMotionNameRef.current = motion.asset_name;
      modelRef.current.getMotionManager().playMotion(ab, motion.asset_name, motion.name);
    } catch (e) {
      console.error('[ViewerPage] Failed to play motion:', e);
      setMotionState('error');
    }
  }, []);

  const handleStopMotion = useCallback(() => {
    if (!modelRef.current) return;
    modelRef.current.getMotionManager().stopMotion();
    setMotionProgress(0);
    setMotionElapsed(0);
  }, []);

  // Random Motion (avoids immediate repeat if >1 motion exists)
  const handlePlayRandomMotion = useCallback(() => {
    if (!animations?.motions || animations.motions.length === 0) return;
    const motions = animations.motions;
    let candidates = motions;
    if (motions.length > 1 && lastPlayedMotionNameRef.current) {
      const filtered = motions.filter((m) => m.asset_name !== lastPlayedMotionNameRef.current);
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    handlePlayMotion(chosen);
  }, [animations?.motions, handlePlayMotion]);

  // Auto-Motion timer controller
  useEffect(() => {
    if (autoMotionTimerRef.current !== null) {
      window.clearTimeout(autoMotionTimerRef.current);
      autoMotionTimerRef.current = null;
    }

    if (
      playerSettings.autoMotion &&
      status === 'ready' &&
      motionState === 'idle' &&
      !document.hidden
    ) {
      const delayMs = Math.max(1000, (playerSettings.autoMotionDelaySec || 3.0) * 1000);
      autoMotionTimerRef.current = window.setTimeout(() => {
        handlePlayRandomMotion();
      }, delayMs);
    }

    return () => {
      if (autoMotionTimerRef.current !== null) {
        window.clearTimeout(autoMotionTimerRef.current);
        autoMotionTimerRef.current = null;
      }
    };
  }, [
    playerSettings.autoMotion,
    playerSettings.autoMotionDelaySec,
    status,
    motionState,
    handlePlayRandomMotion,
  ]);

  // Expression Actions
  const handleApplyExpression = useCallback(async (expr: ExpressionCatalogEntry) => {
    if (!modelRef.current) return;
    try {
      const bytes = await invoke<number[]>('get_expression_bytes', {
        objectName: expr.object_name,
        assetName: expr.asset_name,
        md5: expr.md5,
        expectedSize: expr.size_bytes,
      });
      const uint8 = new Uint8Array(bytes);
      const ab = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
      modelRef.current.getExpressionManager().applyExpression(ab, expr.asset_name, expr.name);
    } catch (e) {
      console.error('[ViewerPage] Failed to apply expression:', e);
    }
  }, []);

  const handleClearExpression = useCallback(() => {
    if (!modelRef.current) return;
    modelRef.current.getExpressionManager().clearExpression();
  }, []);

  // Viewport camera actions
  const handleZoomIn = useCallback(() => {
    if (!rendererRef.current) return;
    const current = rendererRef.current.getTransform();
    const nextZoom = Math.min(current.zoom * 1.2, 8.0);
    rendererRef.current.setTransform({ zoom: nextZoom });
    setTransform(rendererRef.current.getTransform());
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!rendererRef.current) return;
    const current = rendererRef.current.getTransform();
    const nextZoom = Math.max(current.zoom * 0.8, 0.2);
    rendererRef.current.setTransform({ zoom: nextZoom });
    setTransform(rendererRef.current.getTransform());
  }, []);

  const handleFitView = useCallback(() => {
    if (!rendererRef.current) return;
    rendererRef.current.fitView();
    setTransform(rendererRef.current.getTransform());
  }, []);

  const handleResetCamera = useCallback(() => {
    if (!rendererRef.current) return;
    rendererRef.current.resetCamera();
    setTransform(rendererRef.current.getTransform());
  }, []);

  // Mode and Background changes
  const handleChangeMode = useCallback(
    (mode: ViewerMode) => {
      setPlayerSettings((prev) => {
        const updated = { ...prev, mode };
        savePlayerState({ settings: updated, favorites, recentModels });
        return updated;
      });
    },
    [favorites, recentModels]
  );

  const handleChangeBackground = useCallback(
    (background: ViewerBackground) => {
      setPlayerSettings((prev) => {
        const updated = { ...prev, background };
        savePlayerState({ settings: updated, favorites, recentModels });
        return updated;
      });
    },
    [favorites, recentModels]
  );

  const handleToggleAutoMotion = useCallback(() => {
    setPlayerSettings((prev) => {
      const updated = { ...prev, autoMotion: !prev.autoMotion };
      savePlayerState({ settings: updated, favorites, recentModels });
      return updated;
    });
  }, [favorites, recentModels]);

  const handleChangeAutoMotionDelay = useCallback(
    (delay: number) => {
      setPlayerSettings((prev) => {
        const updated = { ...prev, autoMotionDelaySec: delay };
        savePlayerState({ settings: updated, favorites, recentModels });
        return updated;
      });
    },
    [favorites, recentModels]
  );

  const handleToggleFavorite = useCallback(
    (category: keyof PlayerFavorites, id: string) => {
      const updated = toggleFavoriteItem(favorites, category, id);
      setFavorites(updated);
      savePlayerState({ settings: playerSettings, favorites: updated, recentModels });
    },
    [favorites, playerSettings, recentModels]
  );

  const handleOptionsChange = useCallback(
    (newOpts: Partial<ViewerOptions>) => {
      setViewerOptions((prev) => {
        const merged = { ...prev, ...newOpts };
        if (rendererRef.current) {
          rendererRef.current.setViewerOptions(merged);
        }
        setPlayerSettings((ps) => {
          const updated: ViewerSettings = {
            ...ps,
            enableBreath: merged.enableBreath ?? ps.enableBreath,
            enableBlink: merged.enableEyeBlink ?? ps.enableBlink,
            enablePhysics: merged.enablePhysics ?? ps.enablePhysics,
          };
          savePlayerState({ settings: updated, favorites, recentModels });
          return updated;
        });
        return merged;
      });
    },
    [favorites, recentModels]
  );

  // Parameter adjustments
  const handleParameterChange = useCallback((paramIndex: number, value: number) => {
    if (!modelRef.current) return;
    modelRef.current.setParameter(paramIndex, value);
    setParameters((prev) =>
      prev.map((p, idx) => (idx === paramIndex ? { ...p, currentValue: value } : p))
    );
  }, []);

  const handleParameterReset = useCallback((paramIndex: number) => {
    if (!modelRef.current) return;
    modelRef.current.resetParameter(paramIndex);
    const def = modelRef.current.getModel()?.getParameterDefaultValue(paramIndex) ?? 0;
    setParameters((prev) =>
      prev.map((p, idx) => (idx === paramIndex ? { ...p, currentValue: def } : p))
    );
  }, []);

  const handleResetAllParameters = useCallback(() => {
    if (!modelRef.current) return;
    modelRef.current.resetAllParameters();
    setParameters((prev) =>
      prev.map((p) => ({ ...p, currentValue: p.defaultValue }))
    );
  }, []);

  // Keyboard Shortcuts (Space: Play/Stop, R: Random, F: Fit, 0: Reset, F11: Fullscreen, Esc: Exit Fullscreen)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (motionState === 'playing') {
          handleStopMotion();
        } else {
          handlePlayRandomMotion();
        }
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handlePlayRandomMotion();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        handleFitView();
      } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        handleResetCamera();
      } else if (e.code === 'F11') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.code === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    motionState,
    handleStopMotion,
    handlePlayRandomMotion,
    handleFitView,
    handleResetCamera,
    handleToggleFullscreen,
  ]);

  // Diagnostics periodic update
  useEffect(() => {
    const timer = setInterval(() => {
      const glInfo = rendererRef.current?.getGLInfo() || { vendor: 'WebGL', renderer: 'WebGL' };
      const fps = rendererRef.current?.getFps() || 0;
      const hasPhys = modelRef.current?.hasPhysics() ?? false;
      const rigCount = modelRef.current?.getPhysicsRigCount() ?? 0;
      const coreVer =
        typeof (window as unknown as { Live2DCubismCore?: { Version?: string } }).Live2DCubismCore !== 'undefined'
          ? (window as unknown as { Live2DCubismCore?: { Version?: string } }).Live2DCubismCore?.Version || '4.x'
          : '4.x';

      setDiagnostics({
        fps,
        modelId: `${currentTarget.characterId}_${currentTarget.outfitId}`,
        mocVersion: '3 (Cubism 3.0+)',
        paramCount: parameters.length,
        playingMotion: currentMotionInfo?.name || null,
        activeExpression: currentExpressionInfo?.name || null,
        physicsLoaded: hasPhys,
        physicsSettingsCount: rigCount,
        webglVendor: glInfo.vendor,
        webglRenderer: glInfo.renderer,
        coreVersion: coreVer,
      });
    }, 500);

    return () => clearInterval(timer);
  }, [
    currentTarget.characterId,
    currentTarget.outfitId,
    parameters.length,
    currentMotionInfo,
    currentExpressionInfo,
  ]);

  const displayTitle =
    currentTarget.displayName ||
    `Character ${currentTarget.characterId} — Outfit ${currentTarget.outfitId}`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#181a1f',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        overflow: 'hidden',
      }}
    >
      {/* Viewer Controls & Header */}
      <ViewerControls
        title={displayTitle}
        characterId={currentTarget.characterId}
        outfitId={currentTarget.outfitId}
        availableCharacters={availableCharacters}
        availableOutfits={availableOutfits}
        onSelectCharacter={handleSelectCharacter}
        onSelectOutfit={handleSelectOutfit}
        mode={playerSettings.mode}
        onChangeMode={handleChangeMode}
        background={playerSettings.background}
        onChangeBackground={handleChangeBackground}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        transform={transform}
        options={viewerOptions}
        parameters={parameters}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onBack={onBack}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
        onResetCamera={handleResetCamera}
        onOptionsChange={handleOptionsChange}
        onParameterChange={handleParameterChange}
        onParameterReset={handleParameterReset}
        onResetAllParameters={handleResetAllParameters}
        motions={animations?.motions || []}
        expressions={animations?.expressions || []}
        motionState={motionState}
        currentMotionInfo={currentMotionInfo}
        currentExpressionInfo={currentExpressionInfo}
        motionProgress={motionProgress}
        motionElapsed={motionElapsed}
        onPlayMotion={handlePlayMotion}
        onStopMotion={handleStopMotion}
        onPlayRandomMotion={handlePlayRandomMotion}
        onApplyExpression={handleApplyExpression}
        onClearExpression={handleClearExpression}
        isLoadingAnimations={isLoadingAnimations}
        autoMotion={playerSettings.autoMotion}
        onToggleAutoMotion={handleToggleAutoMotion}
        autoMotionDelaySec={playerSettings.autoMotionDelaySec}
        onChangeAutoMotionDelay={handleChangeAutoMotionDelay}
        favorites={favorites}
        onToggleFavorite={handleToggleFavorite}
        recentModels={recentModels}
        onSelectRecentModel={handleSelectRecentModel}
        diagnostics={diagnostics}
        isDesktopActive={isDesktopActive}
        onSendToDesktop={handleSendToDesktop}
        onCloseDesktop={handleCloseDesktop}
        onRemotePlayRandomMotion={handleRemotePlayRandomMotion}
      />

      {/* Main Viewport */}
      <div style={{ flex: 1, position: 'relative', marginTop: '52px' }}>
        {status === 'loading' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              color: '#abb2bf',
              zIndex: 20,
              backgroundColor: '#181a1f',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                border: '3px solid #3e4451',
                borderTopColor: '#61afef',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span style={{ fontSize: '14px', fontWeight: 500 }}>
              Loading Live2D Model ({currentTarget.characterId}_{currentTarget.outfitId})...
            </span>
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              zIndex: 20,
              backgroundColor: '#181a1f',
            }}
          >
            <div
              style={{
                maxWidth: '560px',
                backgroundColor: '#21252b',
                border: '1px solid #e06c75',
                borderRadius: '8px',
                padding: '24px',
                color: '#e6e6e6',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
            >
              <h3 style={{ margin: '0 0 12px 0', color: '#e06c75', fontSize: '18px' }}>
                Cannot Display Model
              </h3>
              <p
                style={{
                  fontSize: '13px',
                  lineHeight: '1.6',
                  color: '#abb2bf',
                  marginBottom: '16px',
                }}
              >
                {errorMessage}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={onBack}
                  style={{
                    backgroundColor: '#61afef',
                    color: '#181a1f',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Return to Library
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WebGL Canvas */}
        <ViewerCanvas
          renderer={renderer}
          background={playerSettings.background}
          onCanvasReady={handleCanvasReady}
          onCanvasDestroy={handleCanvasDestroy}
          onTransformChange={(t) => setTransform(t)}
          onDoubleClick={handleFitView}
        />
      </div>
    </div>
  );
};
