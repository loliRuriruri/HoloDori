import React, { useState, useMemo } from 'react';
import {
  ViewportTransform,
  ViewerOptions,
  ModelParameterInfo,
  ParameterCategory,
  MotionCatalogEntry,
  ExpressionCatalogEntry,
  MotionPlaybackState,
  MotionPlayInfo,
  ExpressionPlayInfo,
  ViewerMode,
  ViewerBackground,
  PlayerFavorites,
  RecentModel,
  ModelDiagnostics,
} from './types';

interface ViewerControlsProps {
  title: string;
  characterId: string;
  outfitId: string;
  availableCharacters: string[];
  availableOutfits: string[];
  onSelectCharacter: (charId: string) => void;
  onSelectOutfit: (outfitId: string) => void;

  mode: ViewerMode;
  onChangeMode: (mode: ViewerMode) => void;

  background: ViewerBackground;
  onChangeBackground: (bg: ViewerBackground) => void;

  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  transform: ViewportTransform;
  options: ViewerOptions;
  parameters: ModelParameterInfo[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onResetCamera: () => void;
  onOptionsChange: (options: Partial<ViewerOptions>) => void;
  onParameterChange: (paramIndex: number, value: number) => void;
  onParameterReset: (paramIndex: number) => void;
  onResetAllParameters: () => void;

  // Motions & Expressions
  motions: MotionCatalogEntry[];
  expressions: ExpressionCatalogEntry[];
  motionState: MotionPlaybackState;
  currentMotionInfo: MotionPlayInfo | null;
  currentExpressionInfo: ExpressionPlayInfo | null;
  motionProgress: number;
  motionElapsed: number;
  onPlayMotion: (motion: MotionCatalogEntry) => void;
  onStopMotion: () => void;
  onPlayRandomMotion: () => void;
  onApplyExpression: (expression: ExpressionCatalogEntry) => void;
  onClearExpression: () => void;
  isLoadingAnimations?: boolean;

  // Auto-Motion
  autoMotion: boolean;
  onToggleAutoMotion: () => void;
  autoMotionDelaySec: number;
  onChangeAutoMotionDelay: (delay: number) => void;

  // Favorites & Recent
  favorites: PlayerFavorites;
  onToggleFavorite: (category: keyof PlayerFavorites, id: string) => void;
  recentModels: RecentModel[];
  onSelectRecentModel: (entry: RecentModel) => void;

  // Diagnostics
  diagnostics: ModelDiagnostics;

  // Desktop Window Controls
  isDesktopActive?: boolean;
  onSendToDesktop?: () => void;
  onCloseDesktop?: () => void;
  onRemotePlayRandomMotion?: () => void;
}

const PARAM_CATEGORIES: ('All' | ParameterCategory)[] = [
  'All',
  'Angle',
  'Eye',
  'Eyebrow',
  'Mouth',
  'Body',
  'Hair',
  'Other',
];

export const ViewerControls: React.FC<ViewerControlsProps> = ({
  title,
  characterId,
  outfitId,
  availableCharacters,
  availableOutfits,
  onSelectCharacter,
  onSelectOutfit,
  mode,
  onChangeMode,
  background,
  onChangeBackground,
  isFullscreen,
  onToggleFullscreen,
  transform,
  options,
  parameters,
  sidebarOpen,
  onToggleSidebar,
  onBack,
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetCamera,
  onOptionsChange,
  onParameterChange,
  onParameterReset,
  onResetAllParameters,
  motions,
  expressions,
  motionState,
  currentMotionInfo,
  currentExpressionInfo,
  motionProgress,
  motionElapsed,
  onPlayMotion,
  onStopMotion,
  onPlayRandomMotion,
  onApplyExpression,
  onClearExpression,
  isLoadingAnimations = false,
  autoMotion,
  onToggleAutoMotion,
  autoMotionDelaySec,
  onChangeAutoMotionDelay,
  favorites,
  onToggleFavorite,
  recentModels,
  onSelectRecentModel,
  diagnostics,
  isDesktopActive = false,
  onSendToDesktop,
  onCloseDesktop,
  onRemotePlayRandomMotion,
}) => {
  const [activeTab, setActiveTab] = useState<'motions' | 'expressions' | 'favorites' | 'advanced'>('motions');
  const [paramSearch, setParamSearch] = useState('');
  const [motionSearch, setMotionSearch] = useState('');
  const [expressionSearch, setExpressionSearch] = useState('');
  const [selectedParamCategory, setSelectedParamCategory] = useState<'All' | ParameterCategory>('All');
  const [selectedMotionCategory, setSelectedMotionCategory] = useState<string>('All');
  const [showRecentMenu, setShowRecentMenu] = useState(false);

  // Character switching helpers
  const currentCharIndex = availableCharacters.indexOf(characterId);
  const handlePrevCharacter = () => {
    if (availableCharacters.length <= 1) return;
    const prevIdx = (currentCharIndex - 1 + availableCharacters.length) % availableCharacters.length;
    onSelectCharacter(availableCharacters[prevIdx]);
  };
  const handleNextCharacter = () => {
    if (availableCharacters.length <= 1) return;
    const nextIdx = (currentCharIndex + 1) % availableCharacters.length;
    onSelectCharacter(availableCharacters[nextIdx]);
  };

  // Outfit switching helpers
  const currentOutfitIndex = availableOutfits.indexOf(outfitId);
  const handlePrevOutfit = () => {
    if (availableOutfits.length <= 1) return;
    const prevIdx = (currentOutfitIndex - 1 + availableOutfits.length) % availableOutfits.length;
    onSelectOutfit(availableOutfits[prevIdx]);
  };
  const handleNextOutfit = () => {
    if (availableOutfits.length <= 1) return;
    const nextIdx = (currentOutfitIndex + 1) % availableOutfits.length;
    onSelectOutfit(availableOutfits[nextIdx]);
  };

  // Discovered categories from motions
  const motionCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of motions) {
      if (m.category) {
        cats.add(m.category.charAt(0).toUpperCase() + m.category.slice(1));
      }
    }
    return ['All', ...Array.from(cats).sort()];
  }, [motions]);

  // Filtered motions
  const filteredMotions = useMemo(() => {
    const q = motionSearch.trim().toLowerCase();
    return motions.filter((m) => {
      if (
        selectedMotionCategory !== 'All' &&
        m.category.toLowerCase() !== selectedMotionCategory.toLowerCase()
      ) {
        return false;
      }
      if (q && !m.name.toLowerCase().includes(q) && !m.asset_name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [motions, motionSearch, selectedMotionCategory]);

  // Filtered expressions
  const filteredExpressions = useMemo(() => {
    const q = expressionSearch.trim().toLowerCase();
    return expressions.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.asset_name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [expressions, expressionSearch]);

  // Filtered Parameters
  const filteredParams = useMemo(() => {
    const q = paramSearch.trim().toLowerCase();
    return parameters
      .map((p, originalIndex) => ({ ...p, originalIndex }))
      .filter((p) => {
        if (selectedParamCategory !== 'All' && p.category !== selectedParamCategory) {
          return false;
        }
        if (q && !p.id.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
  }, [parameters, paramSearch, selectedParamCategory]);

  const isCharFav = favorites.characters.includes(characterId);
  const isOutfitFav = favorites.outfits.includes(`${characterId}_${outfitId}`);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
      {/* --- TOP BAR --- */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          background: 'rgba(22, 24, 29, 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #2f3440',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 10,
          pointerEvents: 'auto',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Left: Back & Identity & Mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onBack}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #3e4451',
              background: '#282c34',
              color: '#abb2bf',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            ← Library
          </button>

          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#e5e7eb',
              maxWidth: '160px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={title}
          >
            {title}
          </span>

          {/* Mode Pill Toggle */}
          <div
            style={{
              display: 'flex',
              background: '#1a1d24',
              borderRadius: '6px',
              border: '1px solid #333842',
              padding: '2px',
            }}
          >
            <button
              onClick={() => onChangeMode('player')}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: 'none',
                background: mode === 'player' ? '#4f8ff7' : 'transparent',
                color: mode === 'player' ? '#fff' : '#888e9b',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Player
            </button>
            <button
              onClick={() => onChangeMode('advanced')}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: 'none',
                background: mode === 'advanced' ? '#4f8ff7' : 'transparent',
                color: mode === 'advanced' ? '#fff' : '#888e9b',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Advanced
            </button>
          </div>

          {/* Character Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#21252b', padding: '2px 6px', borderRadius: '6px', border: '1px solid #333842' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', marginRight: '4px' }}>Char</span>
            <button
              onClick={handlePrevCharacter}
              disabled={availableCharacters.length <= 1}
              style={{ background: 'none', border: 'none', color: '#abb2bf', cursor: 'pointer', padding: '2px 4px', fontSize: '12px' }}
              title="Previous Character"
            >
              ◀
            </button>
            <select
              value={characterId}
              onChange={(e) => onSelectCharacter(e.target.value)}
              style={{
                background: '#1a1d24',
                color: '#e5e7eb',
                border: '1px solid #3a3f4b',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {availableCharacters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={handleNextCharacter}
              disabled={availableCharacters.length <= 1}
              style={{ background: 'none', border: 'none', color: '#abb2bf', cursor: 'pointer', padding: '2px 4px', fontSize: '12px' }}
              title="Next Character"
            >
              ▶
            </button>
            <button
              onClick={() => onToggleFavorite('characters', characterId)}
              style={{
                background: 'none',
                border: 'none',
                color: isCharFav ? '#fbbf24' : '#5c6370',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 2px',
              }}
              title={isCharFav ? 'Unfavorite Character' : 'Favorite Character'}
            >
              ★
            </button>
          </div>

          {/* Outfit Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#21252b', padding: '2px 6px', borderRadius: '6px', border: '1px solid #333842' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', marginRight: '4px' }}>Outfit</span>
            <button
              onClick={handlePrevOutfit}
              disabled={availableOutfits.length <= 1}
              style={{ background: 'none', border: 'none', color: '#abb2bf', cursor: 'pointer', padding: '2px 4px', fontSize: '12px' }}
              title="Previous Outfit"
            >
              ◀
            </button>
            <select
              value={outfitId}
              onChange={(e) => onSelectOutfit(e.target.value)}
              style={{
                background: '#1a1d24',
                color: '#e5e7eb',
                border: '1px solid #3a3f4b',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {availableOutfits.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <button
              onClick={handleNextOutfit}
              disabled={availableOutfits.length <= 1}
              style={{ background: 'none', border: 'none', color: '#abb2bf', cursor: 'pointer', padding: '2px 4px', fontSize: '12px' }}
              title="Next Outfit"
            >
              ▶
            </button>
            <button
              onClick={() => onToggleFavorite('outfits', `${characterId}_${outfitId}`)}
              style={{
                background: 'none',
                border: 'none',
                color: isOutfitFav ? '#fbbf24' : '#5c6370',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 2px',
              }}
              title={isOutfitFav ? 'Unfavorite Outfit' : 'Favorite Outfit'}
            >
              ★
            </button>
          </div>

          {/* Recent Models dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowRecentMenu(!showRecentMenu)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #333842',
                background: '#21252b',
                color: '#abb2bf',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Recent ▾
            </button>
            {showRecentMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: '#1e222b',
                  border: '1px solid #3a3f4b',
                  borderRadius: '6px',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                  zIndex: 20,
                  minWidth: '180px',
                  overflow: 'hidden',
                }}
              >
                {recentModels.length === 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: '11px', color: '#6b7280' }}>No recent models</div>
                ) : (
                  recentModels.map((m) => (
                    <button
                      key={m.modelId}
                      onClick={() => {
                        setShowRecentMenu(false);
                        onSelectRecentModel(m);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 12px',
                        border: 'none',
                        background: 'transparent',
                        color: m.characterId === characterId && m.outfitId === outfitId ? '#4f8ff7' : '#abb2bf',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      {m.displayName || `${m.characterId} (${m.outfitId})`}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Background, Camera Controls, Fullscreen, Sidebar Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Background Selector */}
          <select
            value={background}
            onChange={(e) => onChangeBackground(e.target.value as ViewerBackground)}
            style={{
              background: '#21252b',
              color: '#abb2bf',
              border: '1px solid #333842',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Viewer Background Style"
          >
            <option value="neutral">Neutral</option>
            <option value="checkerboard">Checkerboard</option>
            <option value="transparent">Transparent</option>
          </select>

          {/* Camera Buttons */}
          <button
            onClick={onZoomOut}
            style={{
              padding: '4px 6px',
              borderRadius: '6px',
              border: '1px solid #333842',
              background: '#21252b',
              color: '#abb2bf',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Zoom Out"
          >
            -
          </button>
          <span style={{ fontSize: '11px', color: '#abb2bf', minWidth: '34px', textAlign: 'center' }}>
            {Math.round(transform.zoom * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            style={{
              padding: '4px 6px',
              borderRadius: '6px',
              border: '1px solid #333842',
              background: '#21252b',
              color: '#abb2bf',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={onFitView}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid #333842',
              background: '#21252b',
              color: '#abb2bf',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Fit to Viewport (F or Double Click)"
          >
            Fit
          </button>
          <button
            onClick={onResetCamera}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid #333842',
              background: '#21252b',
              color: '#abb2bf',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Reset Camera (0)"
          >
            100%
          </button>

          {/* Desktop Character Button */}
          {onSendToDesktop && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={isDesktopActive ? onCloseDesktop : onSendToDesktop}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${isDesktopActive ? '#10b981' : '#3b82f6'}`,
                  background: isDesktopActive ? 'rgba(16, 185, 129, 0.15)' : '#1e3a8a',
                  color: isDesktopActive ? '#34d399' : '#93c5fd',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 500,
                }}
                title={
                  isDesktopActive
                    ? 'Desktop Character is Active (Click to Close Desktop Window)'
                    : 'Send Character to Floating Desktop Window'
                }
              >
                <span>🗔</span>
                <span>{isDesktopActive ? 'Desktop Active' : 'Send to Desktop'}</span>
                {isDesktopActive && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#10b981',
                      boxShadow: '0 0 6px #10b981',
                    }}
                  />
                )}
              </button>

              {isDesktopActive && onRemotePlayRandomMotion && (
                <button
                  onClick={onRemotePlayRandomMotion}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '6px',
                    border: '1px solid #334155',
                    background: '#21252b',
                    color: '#e2e8f0',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Play Random Motion on Desktop Window"
                >
                  🎲 Desktop Motion
                </button>
              )}
            </div>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={onToggleFullscreen}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid #333842',
              background: '#21252b',
              color: isFullscreen ? '#4f8ff7' : '#abb2bf',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Fullscreen Toggle (F11)"
          >
            {isFullscreen ? '⤓' : '⤢'}
          </button>

          {/* Sidebar Toggle */}
          <button
            onClick={onToggleSidebar}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #3e4451',
              background: sidebarOpen ? '#3e4451' : '#282c34',
              color: '#fff',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {sidebarOpen ? 'Hide Panel' : 'Show Panel'}
          </button>
        </div>
      </header>

      {/* --- PLAYER ACTION BAR (TIMELINE & RANDOM/AUTO MOTION) --- */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(22, 24, 29, 0.94)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #2f3440',
          borderRadius: '12px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          pointerEvents: 'auto',
          zIndex: 10,
        }}
      >
        {/* Play / Stop Motion button */}
        {motionState === 'playing' ? (
          <button
            onClick={onStopMotion}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: '#e06c75',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Stop Motion (Space)"
          >
            ■ Stop
          </button>
        ) : (
          <button
            onClick={onPlayRandomMotion}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: '#4f8ff7',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Play Random Motion (R or Space)"
          >
            ▶ Play
          </button>
        )}

        {/* Random Motion Button */}
        <button
          onClick={onPlayRandomMotion}
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid #3e4451',
            background: '#282c34',
            color: '#abb2bf',
            fontSize: '13px',
            cursor: 'pointer',
          }}
          title="Play Random Motion (R)"
        >
          🎲 Random
        </button>

        {/* Auto Motion Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={onToggleAutoMotion}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: `1px solid ${autoMotion ? '#4f8ff7' : '#3e4451'}`,
              background: autoMotion ? 'rgba(79, 143, 247, 0.2)' : '#282c34',
              color: autoMotion ? '#4f8ff7' : '#abb2bf',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title="Auto-play random motions after idle delay"
          >
            Auto Motion {autoMotion ? 'ON' : 'OFF'}
          </button>

          {autoMotion && (
            <select
              value={autoMotionDelaySec}
              onChange={(e) => onChangeAutoMotionDelay(Number(e.target.value))}
              style={{
                background: '#1a1d24',
                color: '#abb2bf',
                border: '1px solid #333842',
                borderRadius: '4px',
                padding: '4px',
                fontSize: '11px',
              }}
              title="Idle delay between auto motions"
            >
              <option value={1}>1s delay</option>
              <option value={2}>2s delay</option>
              <option value={3}>3s delay</option>
              <option value={5}>5s delay</option>
            </select>
          )}
        </div>

        {/* Motion Timeline / Status */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: '180px', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#abb2bf' }}>
            <span style={{ fontWeight: 500, color: '#e5e7eb' }}>
              {currentMotionInfo ? currentMotionInfo.name : 'Idle (Breathing)'}
            </span>
            <span>
              {currentMotionInfo ? `${motionElapsed.toFixed(1)}s / ${currentMotionInfo.duration.toFixed(1)}s` : '--'}
            </span>
          </div>

          <div
            style={{
              width: '100%',
              height: '4px',
              background: '#282c34',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${motionProgress * 100}%`,
                height: '100%',
                background: '#4f8ff7',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
        </div>

        {/* Expression Badge & Clear */}
        {currentExpressionInfo && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(152, 195, 121, 0.15)',
              border: '1px solid rgba(152, 195, 121, 0.4)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#98c379',
            }}
          >
            <span>Exp: {currentExpressionInfo.name}</span>
            <button
              onClick={onClearExpression}
              style={{
                background: 'none',
                border: 'none',
                color: '#98c379',
                cursor: 'pointer',
                padding: '0 2px',
                fontWeight: 'bold',
              }}
              title="Clear Active Expression"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* --- SIDEBAR PANEL --- */}
      {sidebarOpen && (
        <aside
          style={{
            position: 'absolute',
            top: '56px',
            right: 0,
            bottom: 0,
            width: '360px',
            background: 'rgba(22, 24, 29, 0.95)',
            backdropFilter: 'blur(16px)',
            borderLeft: '1px solid #2f3440',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10,
            pointerEvents: 'auto',
            boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Tabs Header */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #2f3440',
              background: '#1a1d24',
            }}
          >
            {(['motions', 'expressions', 'favorites', 'advanced'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '12px 4px',
                  background: activeTab === tab ? '#222630' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #4f8ff7' : '2px solid transparent',
                  color: activeTab === tab ? '#fff' : '#6b7280',
                  fontWeight: activeTab === tab ? 600 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab === 'motions'
                  ? isLoadingAnimations ? 'Motions...' : `Motions (${motions.length})`
                  : tab === 'expressions'
                  ? `Exp (${expressions.length})`
                  : tab === 'favorites'
                  ? `★ Favs`
                  : 'Advanced'}
              </button>
            ))}
          </div>

          {/* TAB 1: MOTIONS */}
          {activeTab === 'motions' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Search & Category Filter */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2f3440', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Search motions..."
                  value={motionSearch}
                  onChange={(e) => setMotionSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #333842',
                    background: '#1a1d24',
                    color: '#fff',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
                {/* Category Pills */}
                <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {motionCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedMotionCategory(cat)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '12px',
                        border: 'none',
                        background: selectedMotionCategory === cat ? '#4f8ff7' : '#282c34',
                        color: selectedMotionCategory === cat ? '#fff' : '#888e9b',
                        fontSize: '11px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Motions List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredMotions.map((m) => {
                  const isCurrent = currentMotionInfo?.assetName === m.asset_name;
                  const isFav = favorites.motions.includes(m.name);
                  return (
                    <div
                      key={m.asset_name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: isCurrent ? 'rgba(79, 143, 247, 0.12)' : '#1e222b',
                        border: `1px solid ${isCurrent ? '#4f8ff7' : '#2b303c'}`,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500, color: '#e5e7eb' }}>{m.name}</span>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#282c34',
                              color: '#888e9b',
                              textTransform: 'capitalize',
                            }}
                          >
                            {m.category}
                          </span>
                        </div>
                        <span style={{ fontSize: '10px', color: '#6b7280' }}>{(m.size_bytes / 1024).toFixed(0)} KB</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={() => onToggleFavorite('motions', m.name)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isFav ? '#fbbf24' : '#4b5263',
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: '2px',
                          }}
                          title={isFav ? 'Unfavorite' : 'Favorite'}
                        >
                          ★
                        </button>
                        <button
                          onClick={() => (isCurrent ? onStopMotion() : onPlayMotion(m))}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: 'none',
                            background: isCurrent ? '#e06c75' : '#3e4451',
                            color: '#fff',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isCurrent ? 'Stop' : 'Play'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: EXPRESSIONS */}
          {activeTab === 'expressions' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2f3440', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Search expressions..."
                  value={expressionSearch}
                  onChange={(e) => setExpressionSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #333842',
                    background: '#1a1d24',
                    color: '#fff',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
                {currentExpressionInfo && (
                  <button
                    onClick={onClearExpression}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: '6px',
                      border: '1px solid #e06c75',
                      background: 'rgba(224, 108, 117, 0.1)',
                      color: '#e06c75',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Clear Active Expression ({currentExpressionInfo.name})
                  </button>
                )}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredExpressions.map((e) => {
                  const isActive = currentExpressionInfo?.assetName === e.asset_name;
                  const isFav = favorites.expressions.includes(e.name);
                  return (
                    <div
                      key={e.asset_name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: isActive ? 'rgba(152, 195, 121, 0.12)' : '#1e222b',
                        border: `1px solid ${isActive ? '#98c379' : '#2b303c'}`,
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#e5e7eb' }}>{e.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={() => onToggleFavorite('expressions', e.name)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isFav ? '#fbbf24' : '#4b5263',
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: '2px',
                          }}
                          title={isFav ? 'Unfavorite' : 'Favorite'}
                        >
                          ★
                        </button>
                        <button
                          onClick={() => onApplyExpression(e)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: 'none',
                            background: isActive ? '#98c379' : '#3e4451',
                            color: '#fff',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isActive ? 'Applied' : 'Apply'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: FAVORITES */}
          {activeTab === 'favorites' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#9da5b4', textTransform: 'uppercase' }}>
                  Favorite Motions ({favorites.motions.length})
                </h4>
                {favorites.motions.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#6b7280' }}>No favorite motions yet. Click ★ in Motions tab.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {favorites.motions.map((name) => {
                      const m = motions.find((x) => x.name === name);
                      return (
                        <div
                          key={name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: '#1e222b',
                            border: '1px solid #2b303c',
                          }}
                        >
                          <span style={{ fontSize: '12px', color: '#e5e7eb' }}>{name}</span>
                          {m && (
                            <button
                              onClick={() => onPlayMotion(m)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '4px',
                                border: 'none',
                                background: '#4f8ff7',
                                color: '#fff',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              Play
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#9da5b4', textTransform: 'uppercase' }}>
                  Favorite Expressions ({favorites.expressions.length})
                </h4>
                {favorites.expressions.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#6b7280' }}>No favorite expressions yet. Click ★ in Exp tab.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {favorites.expressions.map((name) => {
                      const e = expressions.find((x) => x.name === name);
                      return (
                        <div
                          key={name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: '#1e222b',
                            border: '1px solid #2b303c',
                          }}
                        >
                          <span style={{ fontSize: '12px', color: '#e5e7eb' }}>{name}</span>
                          {e && (
                            <button
                              onClick={() => onApplyExpression(e)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '4px',
                                border: 'none',
                                background: '#98c379',
                                color: '#fff',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              Apply
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ADVANCED (PARAMETERS & DIAGNOSTICS) */}
          {activeTab === 'advanced' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Toggles */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2f3440', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#abb2bf', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={options.enablePhysics}
                      onChange={(e) => onOptionsChange({ enablePhysics: e.target.checked })}
                    />
                    Live2D Physics
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#abb2bf', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={options.enableBreath}
                      onChange={(e) => onOptionsChange({ enableBreath: e.target.checked })}
                    />
                    Breathing
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#abb2bf', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={options.enableEyeBlink}
                      onChange={(e) => onOptionsChange({ enableEyeBlink: e.target.checked })}
                    />
                    Eye Blink
                  </label>
                </div>

                {/* Diagnostics collapsible */}
                <div style={{ background: '#181b22', padding: '8px', borderRadius: '6px', fontSize: '11px', color: '#888e9b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                  <div>FPS: <span style={{ color: '#fff' }}>{diagnostics.fps}</span></div>
                  <div>Params: <span style={{ color: '#fff' }}>{diagnostics.paramCount}</span></div>
                  <div>Core: <span style={{ color: '#fff' }}>{diagnostics.coreVersion}</span></div>
                  <div>Physics: <span style={{ color: diagnostics.physicsLoaded ? '#98c379' : '#e06c75' }}>{diagnostics.physicsLoaded ? `${diagnostics.physicsSettingsCount} Rigs` : 'Off/None'}</span></div>
                  <div style={{ gridColumn: 'span 2' }}>MOC: <span style={{ color: '#fff' }}>{diagnostics.mocVersion}</span></div>
                </div>

                {/* Search & Reset */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search parameters..."
                    value={paramSearch}
                    onChange={(e) => setParamSearch(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid #333842',
                      background: '#1a1d24',
                      color: '#fff',
                      fontSize: '11px',
                    }}
                  />
                  <button
                    onClick={onResetAllParameters}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      background: '#3e4451',
                      color: '#abb2bf',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Reset All
                  </button>
                </div>

                {/* Category Pills */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {PARAM_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedParamCategory(cat)}
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        border: 'none',
                        background: selectedParamCategory === cat ? '#4f8ff7' : '#21252b',
                        color: selectedParamCategory === cat ? '#fff' : '#888e9b',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Parameter Sliders */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredParams.map((p) => {
                  const isModified = Math.abs(p.currentValue - p.defaultValue) > 1e-4;
                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#abb2bf' }}>
                        <span style={{ color: isModified ? '#4f8ff7' : '#abb2bf', fontWeight: isModified ? 600 : 400 }}>{p.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{p.currentValue.toFixed(1)}</span>
                          {isModified && (
                            <button
                              onClick={() => onParameterReset(p.originalIndex)}
                              style={{ background: 'none', border: 'none', color: '#888e9b', cursor: 'pointer', padding: 0 }}
                              title="Reset parameter"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={0.1}
                        value={p.currentValue}
                        onChange={(e) => onParameterChange(p.originalIndex, parseFloat(e.target.value))}
                        style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
