import React, { useState, useMemo } from 'react';
import {
  ViewportTransform,
  ViewerOptions,
  ModelParameterInfo,
  ParameterCategory,
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
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | ParameterCategory>('All');

  const filteredParams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parameters
      .map((p, originalIndex) => ({ ...p, originalIndex }))
      .filter((p) => {
        if (selectedCategory !== 'All' && p.category !== selectedCategory) {
          return false;
        }
        if (q && !p.id.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
  }, [parameters, search, selectedCategory]);

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
            {sidebarOpen ? 'Hide Parameters' : 'Parameters'} ({parameters.length})
          </button>
        </div>
      </header>

      {/* Right Sidebar: Parameter Inspector */}
      {sidebarOpen && (
        <aside
          style={{
            position: 'absolute',
            top: '52px',
            right: 0,
            bottom: 0,
            width: '340px',
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
          {/* Sidebar Header & Filters */}
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    background: selectedCategory === cat ? '#61afef' : '#21252b',
                    color: selectedCategory === cat ? '#181a1f' : '#abb2bf',
                    border: '1px solid #3e4451',
                    borderRadius: '3px',
                    padding: '2px 6px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: selectedCategory === cat ? 600 : 400,
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
