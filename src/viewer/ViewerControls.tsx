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
} from './types';

interface ViewerControlsProps {
  title: string;
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

  // Motion & Expression props
  motions: MotionCatalogEntry[];
  expressions: ExpressionCatalogEntry[];
  motionState: MotionPlaybackState;
  currentMotionInfo: MotionPlayInfo | null;
  currentExpressionInfo: ExpressionPlayInfo | null;
  onPlayMotion: (motion: MotionCatalogEntry) => void;
  onStopMotion: () => void;
  onApplyExpression: (expression: ExpressionCatalogEntry) => void;
  onClearExpression: () => void;
  isLoadingAnimations?: boolean;
}

const CATEGORIES: ('All' | ParameterCategory)[] = [
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
  onPlayMotion,
  onStopMotion,
  onApplyExpression,
  onClearExpression,
  isLoadingAnimations = false,
}) => {
  const [activeTab, setActiveTab] = useState<'motions' | 'expressions' | 'parameters'>('motions');
  const [paramSearch, setParamSearch] = useState('');
  const [motionSearch, setMotionSearch] = useState('');
  const [expressionSearch, setExpressionSearch] = useState('');
  const [selectedParamCategory, setSelectedParamCategory] = useState<'All' | ParameterCategory>('All');
  const [selectedMotionCategory, setSelectedMotionCategory] = useState<string>('All');

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

  // Derived motion categories
  const motionCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of motions) {
      if (m.category) {
        cats.add(m.category);
      }
    }
    return ['All', ...Array.from(cats).sort()];
  }, [motions]);

  // Filtered motions
  const filteredMotions = useMemo(() => {
    const q = motionSearch.trim().toLowerCase();
    return motions.filter((m) => {
      if (selectedMotionCategory !== 'All' && m.category !== selectedMotionCategory) {
        return false;
      }
      if (q && !m.name.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) {
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

  return (
    <>
      {/* Top Header Bar */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '52px',
          backgroundColor: 'rgba(24, 26, 31, 0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #333842',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 10,
          color: '#e6e6e6',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onBack}
            style={{
              background: '#2c313a',
              color: '#abb2bf',
              border: '1px solid #3e4451',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ← Back to Library
          </button>
          <span
            style={{
              fontWeight: 600,
              fontSize: '14px',
              color: '#61afef',
              background: 'rgba(97, 175, 239, 0.1)',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(97, 175, 239, 0.25)',
            }}
          >
            {title}
          </span>
        </div>

        {/* Center: Viewport Camera Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={onZoomOut}
            title="Zoom Out"
            style={btnStyle}
          >
            −
          </button>
          <span
            style={{
              fontSize: '12px',
              minWidth: '50px',
              textAlign: 'center',
              color: '#abb2bf',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(transform.zoom * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            title="Zoom In"
            style={btnStyle}
          >
            +
          </button>
          <div style={{ width: '1px', height: '16px', background: '#3e4451', margin: '0 4px' }} />
          <button
            onClick={onFitView}
            title="Fit Model to Canvas"
            style={btnStyle}
          >
            Fit
          </button>
          <button
            onClick={onResetCamera}
            title="Reset Camera Pan and Zoom"
            style={btnStyle}
          >
            Reset
          </button>
        </div>

        {/* Right: Idle Animation & Sidebar Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#abb2bf',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={options.enableBreath}
              onChange={(e) => onOptionsChange({ enableBreath: e.target.checked })}
              style={{ accentColor: '#98c379', cursor: 'pointer' }}
            />
            Breath
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#abb2bf',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={options.enableEyeBlink}
              onChange={(e) => onOptionsChange({ enableEyeBlink: e.target.checked })}
              style={{ accentColor: '#98c379', cursor: 'pointer' }}
            />
            Eye Blink
          </label>

          <button
            onClick={onToggleSidebar}
            style={{
              ...btnStyle,
              background: sidebarOpen ? '#98c379' : '#2c313a',
              color: sidebarOpen ? '#181a1f' : '#abb2bf',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: '4px',
            }}
          >
            {sidebarOpen ? 'Hide Panel' : 'Panel'}
          </button>
        </div>
      </header>

      {/* Right Sidebar */}
      {sidebarOpen && (
        <aside
          style={{
            position: 'absolute',
            top: '52px',
            right: 0,
            bottom: 0,
            width: '360px',
            backgroundColor: 'rgba(24, 26, 31, 0.95)',
            backdropFilter: 'blur(8px)',
            borderLeft: '1px solid #333842',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9,
            color: '#abb2bf',
            boxSizing: 'border-box',
          }}
        >
          {/* Main Navigation Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #333842',
              backgroundColor: '#1e2227',
            }}
          >
            <button
              onClick={() => setActiveTab('motions')}
              style={{
                flex: 1,
                padding: '10px 4px',
                background: activeTab === 'motions' ? 'rgba(97, 175, 239, 0.15)' : 'none',
                border: 'none',
                borderBottom: activeTab === 'motions' ? '2px solid #61afef' : '2px solid transparent',
                color: activeTab === 'motions' ? '#61afef' : '#abb2bf',
                fontWeight: activeTab === 'motions' ? 600 : 400,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Motions ({motions.length})
            </button>
            <button
              onClick={() => setActiveTab('expressions')}
              style={{
                flex: 1,
                padding: '10px 4px',
                background: activeTab === 'expressions' ? 'rgba(198, 120, 221, 0.15)' : 'none',
                border: 'none',
                borderBottom: activeTab === 'expressions' ? '2px solid #c678dd' : '2px solid transparent',
                color: activeTab === 'expressions' ? '#c678dd' : '#abb2bf',
                fontWeight: activeTab === 'expressions' ? 600 : 400,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Expressions ({expressions.length})
            </button>
            <button
              onClick={() => setActiveTab('parameters')}
              style={{
                flex: 1,
                padding: '10px 4px',
                background: activeTab === 'parameters' ? 'rgba(152, 195, 121, 0.15)' : 'none',
                border: 'none',
                borderBottom: activeTab === 'parameters' ? '2px solid #98c379' : '2px solid transparent',
                color: activeTab === 'parameters' ? '#98c379' : '#abb2bf',
                fontWeight: activeTab === 'parameters' ? 600 : 400,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Params ({parameters.length})
            </button>
          </div>

          {/* TAB 1: MOTIONS */}
          {activeTab === 'motions' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Motion Status Box */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #333842',
                  backgroundColor: '#21252b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#5c6370', textTransform: 'uppercase' }}>
                      Playback Status
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>
                      {motionState === 'playing' && currentMotionInfo ? (
                        <span style={{ color: '#98c379' }}>
                          ▶ {currentMotionInfo.name}{' '}
                          <span style={{ fontSize: '11px', color: '#abb2bf', fontWeight: 400 }}>
                            ({currentMotionInfo.duration.toFixed(1)}s)
                          </span>
                        </span>
                      ) : motionState === 'loading' ? (
                        <span style={{ color: '#e5c07b' }}>⏳ Loading motion...</span>
                      ) : (
                        <span style={{ color: '#abb2bf' }}>Idle (Procedural Idle)</span>
                      )}
                    </div>
                  </div>
                  {motionState === 'playing' && (
                    <button
                      onClick={onStopMotion}
                      style={{
                        background: '#e06c75',
                        color: '#181a1f',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      ■ Stop
                    </button>
                  )}
                </div>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search motions (e.g. joy, smile, yes)..."
                  value={motionSearch}
                  onChange={(e) => setMotionSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    backgroundColor: '#181a1f',
                    border: '1px solid #3e4451',
                    borderRadius: '4px',
                    color: '#e6e6e6',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginTop: '10px',
                    marginBottom: '8px',
                  }}
                />

                {/* Categories */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '60px', overflowY: 'auto' }}>
                  {motionCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedMotionCategory(cat)}
                      style={{
                        background: selectedMotionCategory === cat ? '#61afef' : '#181a1f',
                        color: selectedMotionCategory === cat ? '#181a1f' : '#abb2bf',
                        border: '1px solid #3e4451',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: selectedMotionCategory === cat ? 600 : 400,
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Motions List */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {isLoadingAnimations ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#abb2bf' }}>
                    Loading HoloDori motions...
                  </div>
                ) : filteredMotions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#5c6370', fontSize: '12px' }}>
                    No motions match the filter.
                  </div>
                ) : (
                  filteredMotions.map((m) => {
                    const isPlayingThis =
                      motionState === 'playing' && currentMotionInfo?.assetName === m.asset_name;
                    return (
                      <div
                        key={m.asset_name}
                        style={{
                          backgroundColor: isPlayingThis ? 'rgba(97, 175, 239, 0.15)' : '#21252b',
                          borderRadius: '4px',
                          padding: '8px 10px',
                          border: isPlayingThis ? '1px solid #61afef' : '1px solid #282c34',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div style={{ overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: isPlayingThis ? '#61afef' : '#e6e6e6',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                            title={m.name}
                          >
                            {m.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span
                              style={{
                                fontSize: '10px',
                                background: '#2c313a',
                                color: '#abb2bf',
                                padding: '1px 5px',
                                borderRadius: '3px',
                              }}
                            >
                              {m.category}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                color: m.is_cached ? '#98c379' : '#61afef',
                              }}
                            >
                              {m.is_cached ? 'Cached' : 'CDN'}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => onPlayMotion(m)}
                          style={{
                            background: isPlayingThis ? '#98c379' : '#2c313a',
                            color: isPlayingThis ? '#181a1f' : '#61afef',
                            border: '1px solid #3e4451',
                            borderRadius: '3px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isPlayingThis ? '▶ Replay' : '▶ Play'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: EXPRESSIONS */}
          {activeTab === 'expressions' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Expression Status Box */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #333842',
                  backgroundColor: '#21252b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#5c6370', textTransform: 'uppercase' }}>
                      Active Expression
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>
                      {currentExpressionInfo ? (
                        <span style={{ color: '#c678dd' }}>✨ {currentExpressionInfo.name}</span>
                      ) : (
                        <span style={{ color: '#abb2bf' }}>Neutral (Default Face)</span>
                      )}
                    </div>
                  </div>
                  {currentExpressionInfo && (
                    <button
                      onClick={onClearExpression}
                      style={{
                        background: '#2c313a',
                        color: '#e06c75',
                        border: '1px solid #e06c75',
                        borderRadius: '3px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search expressions (e.g. smile, anger, sad)..."
                  value={expressionSearch}
                  onChange={(e) => setExpressionSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    backgroundColor: '#181a1f',
                    border: '1px solid #3e4451',
                    borderRadius: '4px',
                    color: '#e6e6e6',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginTop: '10px',
                  }}
                />
              </div>

              {/* Expressions List */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {isLoadingAnimations ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#abb2bf' }}>
                    Loading HoloDori expressions...
                  </div>
                ) : filteredExpressions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#5c6370', fontSize: '12px' }}>
                    No expressions match the filter.
                  </div>
                ) : (
                  filteredExpressions.map((e) => {
                    const isActive = currentExpressionInfo?.assetName === e.asset_name;
                    return (
                      <div
                        key={e.asset_name}
                        style={{
                          backgroundColor: isActive ? 'rgba(198, 120, 221, 0.15)' : '#21252b',
                          borderRadius: '4px',
                          padding: '8px 10px',
                          border: isActive ? '1px solid #c678dd' : '1px solid #282c34',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div style={{ overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: isActive ? '#c678dd' : '#e6e6e6',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                          >
                            {e.name}
                          </div>
                          <div style={{ fontSize: '10px', color: e.is_cached ? '#98c379' : '#61afef', marginTop: '3px' }}>
                            {e.is_cached ? 'Cached' : 'CDN'}
                          </div>
                        </div>

                        <button
                          onClick={() => onApplyExpression(e)}
                          style={{
                            background: isActive ? '#c678dd' : '#2c313a',
                            color: isActive ? '#181a1f' : '#c678dd',
                            border: '1px solid #3e4451',
                            borderRadius: '3px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isActive ? 'Applied' : 'Apply'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PARAMETERS */}
          {activeTab === 'parameters' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #333842' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '10px',
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#e6e6e6', fontSize: '13px' }}>
                    Parameter Inspector
                  </span>
                  <button
                    onClick={onResetAllParameters}
                    style={{
                      background: 'none',
                      border: '1px solid #e06c75',
                      color: '#e06c75',
                      borderRadius: '3px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Reset All
                  </button>
                </div>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search parameter..."
                  value={paramSearch}
                  onChange={(e) => setParamSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    backgroundColor: '#21252b',
                    border: '1px solid #3e4451',
                    borderRadius: '4px',
                    color: '#e6e6e6',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: '8px',
                  }}
                />

                {/* Category tabs */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedParamCategory(cat)}
                      style={{
                        background: selectedParamCategory === cat ? '#61afef' : '#21252b',
                        color: selectedParamCategory === cat ? '#181a1f' : '#abb2bf',
                        border: '1px solid #3e4451',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: selectedParamCategory === cat ? 600 : 400,
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Parameters List */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {filteredParams.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '24px 0',
                      color: '#5c6370',
                      fontSize: '12px',
                    }}
                  >
                    No parameters match the filter.
                  </div>
                ) : (
                  filteredParams.map((p) => {
                    const isModified = Math.abs(p.currentValue - p.defaultValue) > 0.0001;
                    return (
                      <div
                        key={p.id}
                        style={{
                          backgroundColor: '#21252b',
                          borderRadius: '4px',
                          padding: '8px 10px',
                          border: isModified ? '1px solid #e5c07b' : '1px solid #282c34',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '12px',
                              color: '#e6e6e6',
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '180px',
                            }}
                            title={p.id}
                          >
                            {p.name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                fontSize: '11px',
                                color: isModified ? '#e5c07b' : '#61afef',
                                fontFamily: 'monospace',
                              }}
                            >
                              {p.currentValue.toFixed(2)}
                            </span>
                            {isModified && (
                              <button
                                onClick={() => onParameterReset(p.originalIndex)}
                                title={`Reset to default (${p.defaultValue})`}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#e06c75',
                                  cursor: 'pointer',
                                  padding: 0,
                                  fontSize: '11px',
                                }}
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '10px', color: '#5c6370', minWidth: '24px' }}>
                            {p.min}
                          </span>
                          <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={(p.max - p.min) / 100 || 0.01}
                            value={p.currentValue}
                            onChange={(e) =>
                              onParameterChange(p.originalIndex, parseFloat(e.target.value))
                            }
                            style={{
                              flex: 1,
                              accentColor: isModified ? '#e5c07b' : '#61afef',
                              cursor: 'pointer',
                            }}
                          />
                          <span
                            style={{
                              fontSize: '10px',
                              color: '#5c6370',
                              minWidth: '24px',
                              textAlign: 'right',
                            }}
                          >
                            {p.max}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>
      )}
    </>
  );
};

const btnStyle: React.CSSProperties = {
  background: '#2c313a',
  color: '#abb2bf',
  border: '1px solid #3e4451',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '12px',
  cursor: 'pointer',
};
