import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import './App.css';
import { ImporterView } from './components/ImporterView';
import { ViewerPage, ModelPackageTarget } from './viewer';
import {
  CharacterLibrary,
  OutfitEntry,
  ConflictPolicy,
  LibraryFilter,
  StyleFilter,
  BatchProgress,
  BatchBuildReport,
  BuildStatus,
} from './types';

export const App: React.FC = () => {
  // Viewer Target State (when non-null, embedded Live2D viewer is active)
  const [viewerTarget, setViewerTarget] = useState<ModelPackageTarget | null>(null);

  // Source Mode: 'local' (Local Resource Files) vs 'game' (HoloDori Installation)
  const [sourceMode, setSourceMode] = useState<'local' | 'game'>('game');

  // Source & Settings
  const [sourcePath, setSourcePath] = useState<string>('');
  const [outputDir, setOutputDir] = useState<string>('');
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('Skip');

  // Library State
  const [library, setLibrary] = useState<CharacterLibrary | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedOutfitIds, setSelectedOutfitIds] = useState<Set<string>>(new Set());
  const [activeOutfit, setActiveOutfit] = useState<OutfitEntry | null>(null);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<LibraryFilter>('All');
  const [styleFilter, setStyleFilter] = useState<StyleFilter>('All');

  // Operations
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [buildProgress, setBuildProgress] = useState<BatchProgress | null>(null);
  const [lastBuildReport, setLastBuildReport] = useState<BatchBuildReport | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Per-outfit session build status memory
  const [outfitBuildStatuses, setOutfitBuildStatuses] = useState<Record<string, BuildStatus>>({});

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      invoke<string>('get_default_output_dir')
        .then((dir) => setOutputDir(dir))
        .catch(() => setOutputDir('./output'));
    } else {
      setOutputDir('./output');
    }
  }, []);

  // Listen to batch progress events from Tauri
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let unlistenFn: (() => void) | null = null;
    listen<BatchProgress>('batch-progress', (event) => {
      setBuildProgress(event.payload);
      setStatusMessage(`Building ${event.payload.current_index} / ${event.payload.total_models} — ${event.payload.current_model_id}`);
    }).then((unlisten) => {
      unlistenFn = unlisten;
    }).catch((e) => console.warn('Could not register batch-progress listener', e));

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handlePickSourceFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setSourcePath(selected);
        triggerScan(selected, false);
      }
    } catch (e) {
      console.warn('Folder picker unavailable or cancelled', e);
    }
  };

  const handlePickOutputDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (e) {
      console.warn('Output folder picker unavailable or cancelled', e);
    }
  };

  const handleOpenFolderInViewer = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        const clean = selected.replace(/[\\/]+$/, '');
        const base = clean.split(/[\\/]/).pop() || 'model';
        const parts = base.split('_');
        setViewerTarget({
          packageDir: selected,
          characterId: parts[0] || 'Unknown',
          outfitId: parts[1] || '001',
          displayName: base,
        });
      }
    } catch (e) {
      console.warn('Viewer folder picker cancelled or failed', e);
    }
  };

  const triggerScan = async (path: string, forceRescan: boolean) => {
    if (!path.trim()) {
      setErrorMessage('Please select a source folder to scan.');
      return;
    }
    setErrorMessage('');
    setIsScanning(true);
    setStatusMessage(forceRescan ? 'Performing full rescan...' : 'Scanning library (cached)...');

    try {
      const lib = await invoke<CharacterLibrary>('scan_library', {
        paths: [path],
        forceRescan,
      });

      setLibrary(lib);
      setStatusMessage(
        `Scanned ${lib.total_models} model(s) across ${lib.characters.length} character(s) in ${lib.scan_report.scan_duration_ms}ms (Cache: ${lib.scan_report.cache_hit_count} hits, ${lib.scan_report.cache_miss_count} misses).`
      );

      // Auto-select first character if available
      if (lib.characters.length > 0) {
        setSelectedCharacterId(lib.characters[0].character_id);
        if (lib.characters[0].outfits.length > 0) {
          setActiveOutfit(lib.characters[0].outfits[0]);
        }
      }

      // Default: select all buildable models
      const buildableIds = new Set<string>();
      for (const c of lib.characters) {
        for (const o of c.outfits) {
          if (o.match_status !== 'Ambiguous' && o.match_status !== 'NoMatch' && o.textures.length > 0) {
            buildableIds.add(o.id);
          }
        }
      }
      setSelectedOutfitIds(buildableIds);
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : String(err);
      setErrorMessage(`Scan failed: ${msg}`);
      setStatusMessage('Scan error encountered.');
    } finally {
      setIsScanning(false);
    }
  };

  // Helper to toggle an outfit selection
  const toggleOutfitSelection = (id: string) => {
    setSelectedOutfitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all outfits for a character
  const selectAllForCharacter = (charId: string) => {
    if (!library) return;
    const char = library.characters.find((c) => c.character_id === charId);
    if (!char) return;

    setSelectedOutfitIds((prev) => {
      const next = new Set(prev);
      for (const o of char.outfits) {
        next.add(o.id);
      }
      return next;
    });
  };

  // Deselect all outfits for a character
  const deselectAllForCharacter = (charId: string) => {
    if (!library) return;
    const char = library.characters.find((c) => c.character_id === charId);
    if (!char) return;

    setSelectedOutfitIds((prev) => {
      const next = new Set(prev);
      for (const o of char.outfits) {
        next.delete(o.id);
      }
      return next;
    });
  };

  // Select all valid (buildable) outfits
  const handleSelectAllValid = () => {
    if (!library) return;
    const validIds = new Set<string>();
    for (const c of library.characters) {
      for (const o of c.outfits) {
        if (o.match_status !== 'Ambiguous' && o.match_status !== 'NoMatch' && o.textures.length > 0) {
          validIds.add(o.id);
        }
      }
    }
    setSelectedOutfitIds(validIds);
  };

  const handleClearSelection = () => {
    setSelectedOutfitIds(new Set());
  };

  // Execute Batch Build
  const handleBatchBuild = async (outfitsToBuild: OutfitEntry[]) => {
    if (outfitsToBuild.length === 0) {
      setErrorMessage('No outfits selected for building.');
      return;
    }
    if (!outputDir) {
      setErrorMessage('Please specify an output directory.');
      return;
    }

    setErrorMessage('');
    setIsBuilding(true);
    setBuildProgress({
      current_index: 0,
      total_models: outfitsToBuild.length,
      current_model_id: outfitsToBuild[0].id,
      stage: 'Starting',
      status: 'InProgress',
    });
    setStatusMessage(`Starting batch build of ${outfitsToBuild.length} model(s)...`);

    try {
      const pairs = outfitsToBuild.map((o) => o.matched_pair);
      const report = await invoke<BatchBuildReport>('batch_build', {
        pairs,
        outputDir,
        conflictPolicy,
      });

      setLastBuildReport(report);

      // Update per-outfit session build status
      const updatedStatuses = { ...outfitBuildStatuses };
      for (const r of report.reports) {
        updatedStatuses[r.model_id] = r.status;
      }
      setOutfitBuildStatuses(updatedStatuses);

      setStatusMessage(
        `Batch complete: ${report.passed} PASS, ${report.passed_with_warnings} WITH WARNINGS, ${report.failed} FAIL (Total ${report.total_models}).`
      );
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : String(err);
      setErrorMessage(`Batch build error: ${msg}`);
      setStatusMessage('Batch build halted.');
    } finally {
      setIsBuilding(false);
      setBuildProgress(null);
    }
  };

  const handleCancelBuild = async () => {
    try {
      await invoke('cancel_batch_build');
      setStatusMessage('Cancelling batch build...');
    } catch (e) {
      console.warn('Failed to cancel build', e);
    }
  };

  const handleOpenOutput = async () => {
    if (outputDir) {
      try {
        await openPath(outputDir);
      } catch (err) {
        console.warn('Failed to open output directory', err);
      }
    }
  };

  // Filtering outfits
  const getFilteredCharacters = () => {
    if (!library) return [];
    const q = searchQuery.trim().toLowerCase();

    return library.characters
      .map((char) => {
        const filteredOutfits = char.outfits.filter((outfit) => {
          // Style filter
          if (styleFilter !== 'All') {
            const outfitStyle = (outfit.style_token || 'unknown').toLowerCase();
            if (outfitStyle !== styleFilter.toLowerCase()) return false;
          }

          // Status filter
          const effectiveStatus = outfitBuildStatuses[outfit.id] || outfit.build_status;
          if (statusFilter === 'Buildable' && (outfit.match_status === 'Ambiguous' || outfit.match_status === 'NoMatch' || outfit.textures.length === 0)) {
            return false;
          }
          if (statusFilter === 'Built' && (!effectiveStatus || effectiveStatus === 'Fail')) {
            return false;
          }
          if (statusFilter === 'Warnings' && outfit.warnings.length === 0 && effectiveStatus !== 'PassWithWarnings') {
            return false;
          }
          if (statusFilter === 'Ambiguous' && outfit.match_status !== 'Ambiguous') {
            return false;
          }
          if (statusFilter === 'Failed' && effectiveStatus !== 'Fail') {
            return false;
          }

          // Search query
          if (q) {
            const charMatch = char.character_id.toLowerCase().includes(q);
            const outfitMatch = outfit.outfit_id.toLowerCase().includes(q);
            const styleMatch = (outfit.style_token || '').toLowerCase().includes(q);
            const idMatch = outfit.id.toLowerCase().includes(q);
            if (!charMatch && !outfitMatch && !styleMatch && !idMatch) return false;
          }

          return true;
        });

        return {
          ...char,
          outfits: filteredOutfits,
        };
      })
      .filter((char) => char.outfits.length > 0);
  };

  const filteredCharacters = getFilteredCharacters();
  const currentCharacter = filteredCharacters.find((c) => c.character_id === selectedCharacterId) || filteredCharacters[0];

  // Selected outfits list
  const allOutfits: OutfitEntry[] = library ? library.characters.flatMap((c) => c.outfits) : [];
  const selectedOutfitsList = allOutfits.filter((o) => selectedOutfitIds.has(o.id));

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="brand-title">
          <span className="brand-logo">🎭</span>
          <span>HoloDori Live2D Manager</span>
          <span className="brand-badge">AGENT.4A</span>
        </div>

        {/* SOURCE MODE TABS */}
        <div className="nav-tabs">
          <button
            className={`nav-tab ${sourceMode === 'local' ? 'active' : ''}`}
            onClick={() => setSourceMode('local')}
          >
            <span>📁</span>
            <span>Local Resource Files</span>
          </button>
          <button
            className={`nav-tab ${sourceMode === 'game' ? 'active' : ''}`}
            onClick={() => setSourceMode('game')}
          >
            <span>🎮</span>
            <span>HoloDori Installation</span>
            <span className="tab-badge">AUTO</span>
          </button>
          <button
            className="nav-tab"
            onClick={handleOpenFolderInViewer}
            title="Open any built or imported Live2D package directory in the embedded viewer"
          >
            <span>👁️</span>
            <span>Live2D Viewer</span>
          </button>
        </div>

        {sourceMode === 'local' && (
          <div className="header-actions">
            <div className="output-config">
              <span className="output-label">Output:</span>
              <input
                type="text"
                className="output-input"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="Output directory..."
              />
              <button className="btn-secondary" onClick={handlePickOutputDir} title="Choose Output Directory">
                📁
              </button>
              <select
                className="select-policy"
                value={conflictPolicy}
                onChange={(e) => setConflictPolicy(e.target.value as ConflictPolicy)}
                title="Conflict Policy"
              >
                <option value="Skip">Skip Existing</option>
                <option value="UniqueSuffix">Unique Suffix</option>
                <option value="Overwrite">Overwrite (Explicit)</option>
              </select>
            </div>
          </div>
        )}
      </header>

      {sourceMode === 'game' ? (
        <ImporterView
          outputDir={outputDir}
          setOutputDir={setOutputDir}
          conflictPolicy={conflictPolicy}
          setConflictPolicy={setConflictPolicy}
          onNavigateToLibrary={(importedDir) => {
            setSourcePath(importedDir);
            setSourceMode('local');
            triggerScan(importedDir, false);
          }}
          onOpenViewer={(target) => setViewerTarget(target)}
        />
      ) : (
        <>
          {/* TOP CONTROL BAR */}
      <div className="top-control-bar">
        <div className="source-row">
          <button className="btn-primary" onClick={handlePickSourceFolder} disabled={isScanning || isBuilding}>
            📂 Select Source Folder
          </button>
          <input
            type="text"
            className="source-input"
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder="Path to extracted Live2D assets folder..."
          />
          <button
            className="btn-secondary"
            onClick={() => triggerScan(sourcePath, false)}
            disabled={!sourcePath || isScanning || isBuilding}
          >
            {isScanning ? 'Scanning...' : '🔄 Rescan'}
          </button>
          <button
            className="btn-secondary btn-outline"
            onClick={() => triggerScan(sourcePath, true)}
            disabled={!sourcePath || isScanning || isBuilding}
            title="Bypass cache and force full rescan"
          >
            ⚡ Force Rescan
          </button>
        </div>

        <div className="filter-row">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Char ID (00007), Outfit (001), Style (nrml)..."
            />
            {searchQuery && (
              <button className="btn-clear-search" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>

          <div className="filter-group">
            <label>Status:</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LibraryFilter)}>
              <option value="All">All Outfits</option>
              <option value="Buildable">Buildable Only</option>
              <option value="Built">Built in Session</option>
              <option value="Warnings">Has Warnings</option>
              <option value="Ambiguous">Ambiguous Matches</option>
              <option value="Failed">Failed Only</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Style:</label>
            <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value as StyleFilter)}>
              <option value="All">All Styles</option>
              <option value="Nrml">nrml (Normal)</option>
              <option value="Uniq">uniq (Unique)</option>
              <option value="Cmmn">cmmn (Common)</option>
              <option value="Unknown">unknown</option>
            </select>
          </div>
        </div>
      </div>

      {/* NOTIFICATIONS / STATUS */}
      {statusMessage && <div className="status-banner info-banner">{statusMessage}</div>}
      {errorMessage && <div className="status-banner error-banner">{errorMessage}</div>}

      {/* 3-COLUMN LIBRARY WORKSPACE */}
      <div className="library-workspace">
        {/* LEFT COLUMN: Character Sidebar */}
        <div className="character-sidebar">
          <div className="sidebar-header">
            <h3>Characters ({filteredCharacters.length})</h3>
            <button className="btn-link" onClick={handleSelectAllValid} title="Select all valid outfits across all characters">
              Select Valid
            </button>
          </div>
          <div className="character-list">
            {filteredCharacters.length === 0 ? (
              <div className="empty-hint">No characters match the filter.</div>
            ) : (
              filteredCharacters.map((char) => {
                const isSelected = currentCharacter?.character_id === char.character_id;
                const charSelectedCount = char.outfits.filter((o) => selectedOutfitIds.has(o.id)).length;
                const allSelected = char.outfits.length > 0 && charSelectedCount === char.outfits.length;

                return (
                  <div
                    key={char.character_id}
                    className={`character-item ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedCharacterId(char.character_id)}
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (allSelected) {
                          deselectAllForCharacter(char.character_id);
                        } else {
                          selectAllForCharacter(char.character_id);
                        }
                      }}
                      title="Select all outfits for this character"
                    />
                    <div className="character-info">
                      <span className="character-id">{char.character_id}</span>
                      {char.display_name && <span className="character-name">{char.display_name}</span>}
                    </div>
                    <div className="character-badges">
                      <span className="count-badge" title="Buildable / Total outfits">
                        {char.buildable_count}/{char.outfits.length}
                      </span>
                      {charSelectedCount > 0 && (
                        <span className="selected-badge" title="Selected in this character">
                          ✓{charSelectedCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CENTER COLUMN: Outfits Cards Grid */}
        <div className="outfits-main">
          <div className="outfits-header">
            <h2>
              {currentCharacter ? (
                <>
                  Character <span className="highlight">{currentCharacter.character_id}</span> Outfits ({currentCharacter.outfits.length})
                </>
              ) : (
                'Select a Character'
              )}
            </h2>
            {currentCharacter && (
              <div className="outfit-quick-actions">
                <button className="btn-small" onClick={() => selectAllForCharacter(currentCharacter.character_id)}>
                  Select All
                </button>
                <button className="btn-small" onClick={() => deselectAllForCharacter(currentCharacter.character_id)}>
                  Deselect All
                </button>
              </div>
            )}
          </div>

          <div className="outfits-grid">
            {!currentCharacter || currentCharacter.outfits.length === 0 ? (
              <div className="empty-state">
                <p>No outfits found for this character matching active filters.</p>
              </div>
            ) : (
              currentCharacter.outfits.map((outfit) => {
                const isChecked = selectedOutfitIds.has(outfit.id);
                const isActive = activeOutfit?.id === outfit.id;
                const sessionStatus = outfitBuildStatuses[outfit.id] || outfit.build_status;

                return (
                  <div
                    key={outfit.id}
                    className={`outfit-card ${isChecked ? 'selected' : ''} ${isActive ? 'focused' : ''}`}
                    onClick={() => setActiveOutfit(outfit)}
                  >
                    <div className="card-top">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleOutfitSelection(outfit.id);
                        }}
                      />
                      <span className="outfit-tag">
                        {outfit.outfit_id} {outfit.style_token ? `· ${outfit.style_token}` : '· unknown'}
                      </span>
                      <span className={`confidence-badge confidence-${outfit.match_status.toLowerCase()}`}>
                        {outfit.match_status}
                      </span>
                    </div>

                    <div className="card-thumb-container">
                      {outfit.thumbnail_source ? (
                        <img
                          src={convertFileSrc(outfit.thumbnail_source)}
                          alt="Atlas Thumbnail"
                          className="outfit-thumb"
                          onError={(e) => {
                            // Fallback to placeholder if asset protocol fails
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="placeholder-thumb">🎨 No Texture</div>
                      )}
                    </div>

                    <div className="card-meta">
                      <span className="model-id-label">{outfit.id}</span>
                      {sessionStatus ? (
                        <span className={`status-badge status-${sessionStatus.toLowerCase()}`}>
                          {sessionStatus}
                        </span>
                      ) : (
                        <span className="status-badge status-notbuilt">NOT BUILT</span>
                      )}
                      <button
                        className="btn-card-view"
                        title="View in Live2D Viewer"
                        onClick={(e) => {
                          e.stopPropagation();
                          const pkgDir = `${outputDir}/${outfit.id}`;
                          setViewerTarget({
                            packageDir: pkgDir,
                            characterId: outfit.character_id,
                            outfitId: outfit.outfit_id,
                            displayName: `${outfit.id} (${outfit.style_token || 'Normal'})`,
                          });
                        }}
                        style={{
                          marginLeft: 'auto',
                          background: 'none',
                          border: '1px solid #3e4451',
                          borderRadius: '3px',
                          color: '#98c379',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        👁️
                      </button>
                    </div>

                    {outfit.warnings.length > 0 && (
                      <div className="card-warning-pill" title={outfit.warnings.join('\n')}>
                        ⚠️ {outfit.warnings.length} warning(s)
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Details / Inspector Panel */}
        <div className="details-panel">
          <h3>Outfit Details</h3>
          {activeOutfit ? (
            <div className="details-content">
              <div className="detail-item">
                <label>Model ID:</label>
                <div className="copy-row">
                  <code>{activeOutfit.id}</code>
                  <button className="btn-copy" onClick={() => navigator.clipboard.writeText(activeOutfit.id)}>
                    📋
                  </button>
                </div>
              </div>

              <div className="detail-row-duo">
                <div className="detail-item">
                  <label>Character ID:</label>
                  <span>{activeOutfit.character_id}</span>
                </div>
                <div className="detail-item">
                  <label>Outfit ID:</label>
                  <span>{activeOutfit.outfit_id}</span>
                </div>
              </div>

              <div className="detail-item">
                <label>Style Token:</label>
                <span className="style-pill">{activeOutfit.style_token || 'unknown'}</span>
              </div>

              <div className="detail-item">
                <label>Model Source:</label>
                <div className="path-box" title={activeOutfit.model_source}>
                  {activeOutfit.model_source}
                </div>
              </div>

              <div className="detail-item">
                <label>Textures ({activeOutfit.textures.length}):</label>
                {activeOutfit.textures.length === 0 ? (
                  <span className="text-muted">None associated</span>
                ) : (
                  <div className="texture-list">
                    {activeOutfit.textures.map((tex, i) => (
                      <div key={i} className="texture-item" title={tex}>
                        🖼️ {tex.split(/[\\/]/).pop()}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="detail-item">
                <label>Match Confidence:</label>
                <span className={`confidence-badge confidence-${activeOutfit.match_status.toLowerCase()}`}>
                  {activeOutfit.match_status}
                </span>
              </div>

              <div className="detail-item">
                <label>Match Evidence:</label>
                <ul className="evidence-list">
                  {activeOutfit.evidence.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              </div>

              <div className="detail-item">
                <label>Build Status:</label>
                <span className={`status-badge status-${(outfitBuildStatuses[activeOutfit.id] || 'NOT_BUILT').toLowerCase()}`}>
                  {outfitBuildStatuses[activeOutfit.id] || 'NOT_BUILT'}
                </span>
              </div>

              {(() => {
                const activeReport = lastBuildReport?.reports.find((r) => r.model_id === activeOutfit.id);
                if (!activeReport) return null;

                const mocLabel =
                  activeReport.moc_version === 'Invalid'
                    ? 'Invalid MOC3'
                    : typeof activeReport.moc_version === 'object' && 'Known' in activeReport.moc_version
                    ? `${activeReport.moc_version.Known.version_label} (0x0${activeReport.moc_version.Known.raw})`
                    : 'Unknown Version';

                return (
                  <div className="report-inspection-box">
                    <div className="detail-item">
                      <label>MOC3 Version:</label>
                      <span className="code-pill">{mocLabel}</span>
                    </div>

                    <div className="detail-item">
                      <label>Runtime Validation:</label>
                      <span className={`status-badge status-${activeReport.runtime_validation.toLowerCase()}`}>
                        {activeReport.runtime_validation}
                      </span>
                    </div>

                    <div className="detail-item">
                      <label>Validation Stages:</label>
                      <div className="stages-list">
                        {activeReport.validation_stages.map((st, i) => (
                          <div key={i} className={`stage-row ${st.passed ? 'stage-pass' : 'stage-fail'}`}>
                            <span>{st.passed ? '✓' : '✗'}</span>
                            <span className="stage-name">{st.stage_name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {activeReport.errors.length > 0 && (
                      <div className="detail-item">
                        <label className="text-danger">Errors:</label>
                        <div className="error-box">
                          {activeReport.errors.map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {activeOutfit.warnings.length > 0 && (
                <div className="detail-item">
                  <label className="text-warning">Warnings:</label>
                  <ul className="warning-list">
                    {activeOutfit.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="details-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  className="btn-viewer btn-block"
                  style={{
                    backgroundColor: '#98c379',
                    color: '#181a1f',
                    fontWeight: 600,
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  onClick={() => {
                    const pkgDir = `${outputDir}/${activeOutfit.id}`;
                    setViewerTarget({
                      packageDir: pkgDir,
                      characterId: activeOutfit.character_id,
                      outfitId: activeOutfit.outfit_id,
                      displayName: `${activeOutfit.id} (${activeOutfit.style_token || 'Normal'})`,
                    });
                  }}
                >
                  👁️ Open in Live2D Viewer
                </button>
                <button
                  className="btn-primary btn-block"
                  onClick={() => handleBatchBuild([activeOutfit])}
                  disabled={isBuilding}
                >
                  🚀 Build This Model
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-hint">Select an outfit from the cards to inspect details.</div>
          )}
        </div>
      </div>

      {/* BOTTOM TOOLBAR / BATCH CONTROLS */}
      <footer className="app-footer">
        <div className="footer-left">
          <span className="selection-summary">
            Selected: <strong>{selectedOutfitIds.size}</strong> of {allOutfits.length} model(s)
          </span>
          <button className="btn-secondary btn-small" onClick={handleSelectAllValid} disabled={isBuilding}>
            Select All Valid
          </button>
          <button className="btn-secondary btn-small" onClick={handleClearSelection} disabled={isBuilding}>
            Clear
          </button>
        </div>

        {isBuilding && buildProgress && (
          <div className="footer-progress">
            <span className="progress-label">
              Building {buildProgress.current_index} / {buildProgress.total_models} —{' '}
              <code>{buildProgress.current_model_id}</code>
            </span>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${(buildProgress.current_index / buildProgress.total_models) * 100}%` }}
              />
            </div>
            <button className="btn-danger btn-small" onClick={handleCancelBuild}>
              ⏹ Cancel
            </button>
          </div>
        )}

        <div className="footer-right">
          <button className="btn-secondary" onClick={handleOpenOutput}>
            📂 Open Output
          </button>
          <button
            className="btn-primary"
            onClick={() => handleBatchBuild(selectedOutfitsList)}
            disabled={selectedOutfitsList.length === 0 || isBuilding}
          >
            🚀 Build Selected ({selectedOutfitsList.length})
          </button>
          <button
            className="btn-primary btn-outline"
            onClick={() => {
              const valid = allOutfits.filter(
                (o) => o.match_status !== 'Ambiguous' && o.match_status !== 'NoMatch' && o.textures.length > 0
              );
              handleBatchBuild(valid);
            }}
            disabled={allOutfits.length === 0 || isBuilding}
          >
            ⚡ Build All Valid
          </button>
        </div>
      </footer>
      </>
    )}

    {viewerTarget && (
      <ViewerPage
        target={viewerTarget}
        onBack={() => setViewerTarget(null)}
        library={library}
        outputDir={outputDir}
        onSwitchModel={(newTarget) => setViewerTarget(newTarget)}
      />
    )}
  </div>
);
};
export default App;
