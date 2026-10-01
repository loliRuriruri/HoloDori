import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
} from './types';
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

interface ViewerPageProps {
  target: ModelPackageTarget;
  onBack: () => void;
}

export const ViewerPage: React.FC<ViewerPageProps> = ({ target, onBack }) => {
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [renderer, setRenderer] = useState<ViewerRenderer | null>(null);
  const [parameters, setParameters] = useState<ModelParameterInfo[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Animations & Expressions State
  const [animations, setAnimations] = useState<ModelAnimationMetadata | null>(null);
  const [isLoadingAnimations, setIsLoadingAnimations] = useState(false);
  const [motionState, setMotionState] = useState<MotionPlaybackState>('idle');
  const [currentMotionInfo, setCurrentMotionInfo] = useState<MotionPlayInfo | null>(null);
  const [currentExpressionInfo, setCurrentExpressionInfo] = useState<ExpressionPlayInfo | null>(null);

  const [transform, setTransform] = useState<ViewportTransform>({
    zoom: 1.0,
    panX: 0.0,
    panY: 0.0,
  });

  const [viewerOptions, setViewerOptions] = useState<ViewerOptions>({
    enableBreath: true,
    enableEyeBlink: true,
  });

  const modelRef = useRef<Live2DModelWrapper | null>(null);
  const rendererRef = useRef<ViewerRenderer | null>(null);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    setCanvasElement(canvas);
  }, []);

  const handleCanvasDestroy = useCallback(() => {
    setCanvasElement(null);
  }, []);

  // Fetch Available Animations & Expressions for this character
  useEffect(() => {
    let isCancelled = false;
    async function loadAnimations() {
      setIsLoadingAnimations(true);
      try {
        const data = await invoke<ModelAnimationMetadata>('get_model_animations', {
          characterId: target.characterId,
          octocachePath: null,
        });
        if (!isCancelled) {
          setAnimations(data);
        }
      } catch (e) {
        if (!isCancelled) {
          console.warn('[ViewerPage] Could not load animations metadata:', e);
          setAnimations({
            character_id: target.characterId,
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
  }, [target.characterId]);

  // Initialize WebGL and Load Model Package once Canvas is ready
  useEffect(() => {
    if (!canvasElement) return;

    let isCancelled = false;

    async function initViewer() {
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

        // Instantiate renderer directly on the canvas DOM element
        const newRenderer = new ViewerRenderer({
          canvas: canvasElement!,
          onContextLost: () => {
            console.warn('[ViewerPage] WebGL Context Lost');
          },
          onContextRestored: () => {
            console.info('[ViewerPage] WebGL Context Restored');
          },
        });

        // Set initial canvas dimension based on client rect
        const rect = canvasElement!.getBoundingClientRect();
        newRenderer.resize(rect.width || 800, rect.height || 600);

        rendererRef.current = newRenderer;
        setRenderer(newRenderer);

        // 3. Load package resources from disk via Tauri IPC
        const loadedPackage = await loadModelPackageFromDisk(
          target.packageDir,
          target.modelJsonFile
        );

        if (isCancelled) {
          loadedPackage.dispose();
          newRenderer.dispose();
          releaseCubismFramework();
          return;
        }

        // 4. Initialize model wrapper with WebGL context
        const modelWrapper = new Live2DModelWrapper();
        await modelWrapper.init(
          newRenderer.getGL(),
          loadedPackage,
          canvasElement!.width,
          canvasElement!.height
        );

        if (isCancelled) {
          modelWrapper.disposeModel(newRenderer.getGL());
          newRenderer.dispose();
          releaseCubismFramework();
          return;
        }

        // Hook up motion and expression state callbacks
        modelWrapper.getMotionManager().setStateCallback((state, info) => {
          setMotionState(state);
          setCurrentMotionInfo(info);
        });
        modelWrapper.getExpressionManager().setCallback((info) => {
          setCurrentExpressionInfo(info);
        });

        modelRef.current = modelWrapper;
        newRenderer.setModel(modelWrapper);

        // 5. Extract initial parameters for inspector
        const initialParams = modelWrapper.getParameters();
        setParameters(initialParams);

        // 6. Start animation render loop
        newRenderer.start();
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

    initViewer();

    return () => {
      isCancelled = true;
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      if (modelRef.current) {
        modelRef.current = null;
      }
      setRenderer(null);
      releaseCubismFramework();
    };
  }, [target, canvasElement]);

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
      modelRef.current.getMotionManager().playMotion(ab, motion.asset_name, motion.name);
    } catch (e) {
      console.error('[ViewerPage] Failed to play motion:', e);
      setMotionState('error');
    }
  }, []);

  const handleStopMotion = useCallback(() => {
    if (!modelRef.current) return;
    modelRef.current.getMotionManager().stopMotion();
  }, []);

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

  const handleOptionsChange = useCallback((newOpts: Partial<ViewerOptions>) => {
    setViewerOptions((prev) => {
      const merged = { ...prev, ...newOpts };
      if (rendererRef.current) {
        rendererRef.current.setViewerOptions(merged);
      }
      return merged;
    });
  }, []);

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

  const displayTitle =
    target.displayName ||
    `Character ${target.characterId} — Outfit ${target.outfitId}`;

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
        onPlayMotion={handlePlayMotion}
        onStopMotion={handleStopMotion}
        onApplyExpression={handleApplyExpression}
        onClearExpression={handleClearExpression}
        isLoadingAnimations={isLoadingAnimations}
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
              Loading Live2D Model ({target.characterId}_{target.outfitId})...
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
          onCanvasReady={handleCanvasReady}
          onCanvasDestroy={handleCanvasDestroy}
          onTransformChange={(t) => setTransform(t)}
        />
      </div>
    </div>
  );
};
