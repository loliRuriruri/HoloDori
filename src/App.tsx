import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import './App.css';
import { useI18n } from './i18n';
import { Tooltip } from './components/Tooltip';
import { FirstRunGuide } from './components/FirstRunGuide';
import { HelpManual } from './components/HelpManual';
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
  const { t, lang, setLang } = useI18n();

  // Onboarding & Help modal state
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [helpInitialTopic, setHelpInitialTopic] = useState<string>('intro');
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [isAdvancedMode, setIsAdvancedMode] = useState<boolean>(false);

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

  // First-run onboarding check
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const done = localStorage.getItem('hdm_onboarding_done');
      if (!done) {
        setShowOnboarding(true);
      }
    }
  }, []);

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
          <span className="brand-badge">v1.0.0</span>
        </div>

        {/* SOURCE MODE TABS */}
        <div className="nav-tabs">
          <Tooltip title={t('source.local_mode')} body={t('help.tab_library')} placement="bottom">
            <button
              className={`nav-tab ${sourceMode === 'local' ? 'active' : ''}`}
              onClick={() => setSourceMode('local')}
            >
              <span>📁</span>
              <span>{t('source.local_mode')}</span>
            </button>
          </Tooltip>
          <Tooltip title={t('source.game_mode')} body={t('importer.subtitle')} placement="bottom">
            <button
              className={`nav-tab ${sourceMode === 'game' ? 'active' : ''}`}
              onClick={() => setSourceMode('game')}
            >
              <span>🎮</span>
              <span>{t('source.game_mode')}</span>
              <span className="tab-badge">AUTO</span>
            </button>
          </Tooltip>
          <Tooltip title={t('viewer.title')} body={t('help.tab_viewer')} placement="bottom">
            <button
              className="nav-tab"
              onClick={handleOpenFolderInViewer}
            >
              <span>👁️</span>
              <span>{t('nav.viewer')}</span>
            </button>
          </Tooltip>
        </div>

        <div className="header-actions">
          {sourceMode === 'local' && (
            <div className="output-config">
              <span className="output-label">{t('source.output_dir')}:</span>
              <input
                type="text"
                className="output-input"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="Output directory..."
              />
              <Tooltip title={t('source.output_dir')} body="Live2D 모델 패키지가 저장될 폴더를 선택합니다.">
                <button className="btn-secondary" onClick={handlePickOutputDir}>
                  📁
                </button>
              </Tooltip>
              <select
                className="select-policy"
                value={conflictPolicy}
                onChange={(e) => setConflictPolicy(e.target.value as ConflictPolicy)}
                title={t('source.conflict_policy')}
              >
                <option value="Skip">{t('source.conflict_skip')}</option>
                <option value="UniqueSuffix">{t('source.conflict_suffix')}</option>
                <option value="Overwrite">{t('source.conflict_overwrite')}</option>
              </select>
            </div>
          )}

          {/* Normal vs Advanced Mode Toggle */}
          <div style={{ display: 'flex', background: '#1e222b', borderRadius: '6px', border: '1px solid #333842', padding: '2px' }}>
            <button
              onClick={() => setIsAdvancedMode(false)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: !isAdvancedMode ? 600 : 400,
                background: !isAdvancedMode ? '#3b82f6' : 'transparent',
                color: !isAdvancedMode ? '#fff' : '#888e9b',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title={t('nav.mode_normal')}
            >
              {t('nav.mode_normal')}
            </button>
            <button
              onClick={() => setIsAdvancedMode(true)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: isAdvancedMode ? 600 : 400,
                background: isAdvancedMode ? '#3b82f6' : 'transparent',
                color: isAdvancedMode ? '#fff' : '#888e9b',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title={t('nav.mode_advanced')}
            >
              {t('nav.mode_advanced')}
            </button>
          </div>

          {/* Language Switcher */}
          <button
            className="btn-secondary btn-small"
            onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
            style={{ fontWeight: 600, minWidth: '64px', cursor: 'pointer' }}
            title={lang === 'ko' ? 'Switch interface to English' : '인터페이스를 한국어로 전환'}
          >
            🌐 {lang === 'ko' ? '한국어' : 'English'}
          </button>

          {/* Contextual Help */}
          <button
            className="btn-secondary btn-small"
            onClick={() => {
              setHelpInitialTopic(sourceMode === 'game' ? 'importer' : 'library');
              setIsHelpOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
            title={t('nav.contextual_help')}
          >
            <span>ⓘ</span>
            <span>{t('nav.contextual_help')}</span>
          </button>

          {/* Help Manual */}
          <button
            className="btn-primary btn-small"
            onClick={() => {
              setHelpInitialTopic('intro');
              setIsHelpOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
            title={t('nav.help')}
          >
            <span>❓</span>
            <span>{t('nav.help')}</span>
          </button>
        </div>
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
          <Tooltip title={t('source.select_folder')} body="Live2D 에셋이 추출되어 있는 로컬 폴더를 직접 선택합니다.">
            <button className="btn-primary" onClick={handlePickSourceFolder} disabled={isScanning || isBuilding}>
              {t('source.select_folder')}
            </button>
          </Tooltip>
          <input
            type="text"
            className="source-input"
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder={t('library.search_placeholder')}
          />
          <Tooltip contentKey="tooltip.scan_library">
            <button
              className="btn-secondary"
              onClick={() => triggerScan(sourcePath, false)}
              disabled={!sourcePath || isScanning || isBuilding}
            >
              {isScanning ? t('library.scanning') : `🔄 ${t('library.scan_button')}`}
            </button>
          </Tooltip>
          <Tooltip title="강제 전체 재검색" body="캐시를 무시하고 모든 하위 폴더의 MOC3와 텍스처를 처음부터 다시 검색합니다.">
            <button
              className="btn-secondary btn-outline"
              onClick={() => triggerScan(sourcePath, true)}
              disabled={!sourcePath || isScanning || isBuilding}
            >
              ⚡ Force Rescan
            </button>
          </Tooltip>
        </div>

        <div className="filter-row">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('library.search_placeholder')}
            />
            {searchQuery && (
              <button className="btn-clear-search" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>

          <div className="filter-group">
            <label>{t('library.style_label')}:</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LibraryFilter)}>
              <option value="All">{t('library.filter_all')}</option>
              <option value="Buildable">{t('library.filter_ready')}</option>
              <option value="Built">Built in Session</option>
              <option value="Warnings">Has Warnings</option>
              <option value="Ambiguous">{t('library.filter_incomplete')}</option>
              <option value="Failed">Failed Only</option>
            </select>
          </div>

          <div className="filter-group">
            <label>{t('library.style_label')}:</label>
            <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value as StyleFilter)}>
              <option value="All">{t('library.style_all')}</option>
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
            <h3>{t('nav.library')} ({filteredCharacters.length})</h3>
            <button className="btn-link" onClick={handleSelectAllValid} title="Select all valid outfits across all characters">
              {t('library.filter_ready')}
            </button>
          </div>
          <div className="character-list">
            {filteredCharacters.length === 0 ? (
              <div className="empty-hint">{t('library.empty_title')}</div>
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
                t('library.empty_title')
              )}
            </h2>
            {currentCharacter && (
              <div className="outfit-quick-actions">
                <button className="btn-small" onClick={() => selectAllForCharacter(currentCharacter.character_id)}>
                  {t('importer.select_all')}
                </button>
                <button className="btn-small" onClick={() => deselectAllForCharacter(currentCharacter.character_id)}>
                  {t('importer.deselect_all')}
                </button>
              </div>
            )}
          </div>

          <div className="outfits-grid">
            {!currentCharacter || currentCharacter.outfits.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '48px 24px', background: '#1e222b', borderRadius: '8px', border: '1px dashed #3a3f4b' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎭</div>
                <h3 style={{ fontSize: '18px', color: '#e5e7eb', marginBottom: '8px' }}>{t('library.empty_title')}</h3>
                <p style={{ fontSize: '13px', color: '#9da5b4', maxWidth: '440px', margin: '0 auto 20px auto', lineHeight: '1.6' }}>
                  {t('library.empty_desc')}
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button className="btn-primary" onClick={() => setSourceMode('game')}>
                    🎮 {t('library.empty_action_import')}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setHelpInitialTopic('importer');
                      setIsHelpOpen(true);
                    }}
                  >
                    ❓ {t('library.empty_action_help')}
                  </button>
                </div>
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
                <Tooltip title={t('viewer.title')} body="선택한 의상 모델을 내장 WebGL Live2D 뷰어로 실행합니다.">
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
                      width: '100%',
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
                    👁️ {t('viewer.title')}
                  </button>
                </Tooltip>
                <Tooltip title={t('library.build_selected', { count: 1 })} body="선택한 모델의 Live2D 패키지(model3.json)를 생성합니다.">
                  <button
                    className="btn-primary btn-block"
                    style={{ width: '100%' }}
                    onClick={() => handleBatchBuild([activeOutfit])}
                    disabled={isBuilding}
                  >
                    🚀 {t('library.build_selected', { count: 1 })}
                  </button>
                </Tooltip>
              </div>
            </div>
          ) : (
            <div className="empty-hint">{t('library.empty_title')}</div>
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
            {t('library.filter_ready')}
          </button>
          <button className="btn-secondary btn-small" onClick={handleClearSelection} disabled={isBuilding}>
            {t('importer.deselect_all')}
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
          <Tooltip title={t('about.btn_open_output')} body="생성된 Live2D 패키지가 위치한 출력 폴더를 파일 탐색기로 엽니다.">
            <button className="btn-secondary" onClick={handleOpenOutput}>
              📂 {t('about.btn_open_output')}
            </button>
          </Tooltip>
          <Tooltip contentKey="tooltip.import_models">
            <button
              className="btn-primary"
              onClick={() => handleBatchBuild(selectedOutfitsList)}
              disabled={selectedOutfitsList.length === 0 || isBuilding}
            >
              🚀 {t('library.build_selected', { count: selectedOutfitsList.length })}
            </button>
          </Tooltip>
          <Tooltip contentKey="tooltip.import_models">
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
              {t('library.build_all_valid')}
            </button>
          </Tooltip>
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

    <HelpManual
      isOpen={isHelpOpen}
      onClose={() => setIsHelpOpen(false)}
      initialTopic={helpInitialTopic}
      onRestartOnboarding={() => setShowOnboarding(true)}
      outputDir={outputDir}
    />

    <FirstRunGuide
      isOpen={showOnboarding}
      onClose={(dontShowAgain) => {
        setShowOnboarding(false);
        if (dontShowAgain && typeof window !== 'undefined') {
          localStorage.setItem('hdm_onboarding_done', 'true');
        }
      }}
    />
  </div>
);
};
export default App;
