import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '../i18n';
import { Tooltip } from './Tooltip';
import {
  SteamDetectionResult,
  ModelCatalogEntry,
  ImportProgress,
  ImportExecutionResult,
  CacheStats,
  ConflictPolicy,
} from '../types';

interface ImporterViewProps {
  outputDir: string;
  setOutputDir: (dir: string) => void;
  conflictPolicy: ConflictPolicy;
  setConflictPolicy: (policy: ConflictPolicy) => void;
  onNavigateToLibrary: (scanPath: string) => void;
  onOpenViewer?: (target: {
    packageDir: string;
    characterId: string;
    outfitId: string;
    displayName?: string;
  }) => void;
}

export const ImporterView: React.FC<ImporterViewProps> = ({
  outputDir,
  setOutputDir,
  conflictPolicy,
  setConflictPolicy,
  onNavigateToLibrary,
  onOpenViewer,
}) => {
  const { t } = useI18n();

  // Steam & Cache state
  const [detection, setDetection] = useState<SteamDetectionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  // Catalog state
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  const [selectedAssetNames, setSelectedAssetNames] = useState<Set<string>>(new Set());

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [styleFilter, setStyleFilter] = useState<string>('All');
  const [cacheFilter, setCacheFilter] = useState<string>('All'); // 'All' | 'Cached' | 'Remote'

  // Import Execution & Progress
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [lastResult, setLastResult] = useState<ImportExecutionResult | null>(null);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);

  // Notifications
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Initial detection & cache stats fetch
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      runDetection();
      refreshCacheStats();
    }
  }, []);

  // Listen to import progress events from backend
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let unlistenFn: (() => void) | null = null;
    listen<ImportProgress>('import-progress', (event) => {
      setImportProgress(event.payload);
    }).then((unlisten) => {
      unlistenFn = unlisten;
    }).catch((e) => console.warn('Could not register import-progress listener', e));

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const runDetection = async () => {
    setIsDetecting(true);
    setErrorMessage('');
    try {
      const res = await invoke<SteamDetectionResult>('detect_game_install');
      setDetection(res);
      if (res.found) {
        setStatusMessage(`Game install located: ${res.install_path}`);
        // Automatically load catalog if octocache found
        if (res.octocache_path) {
          loadCatalog(res.octocache_path);
        }
      } else {
        setStatusMessage(res.message || 'Steam installation not detected automatically.');
      }
    } catch (err: unknown) {
      setErrorMessage(`Detection error: ${String(err)}`);
    } finally {
      setIsDetecting(false);
    }
  };

  const refreshCacheStats = async () => {
    try {
      const stats = await invoke<CacheStats>('get_import_cache_stats');
      setCacheStats(stats);
    } catch (err) {
      console.warn('Failed to retrieve cache stats', err);
    }
  };

  const handlePickManualFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select HoloDori Game Installation Directory',
      });
      if (selected && typeof selected === 'string') {
        setIsDetecting(true);
        setErrorMessage('');
        try {
          const res = await invoke<SteamDetectionResult>('set_game_install_path', { path: selected });
          setDetection(res);
          if (res.found && res.octocache_path) {
            setStatusMessage(`Game folder configured: ${res.install_path}`);
            loadCatalog(res.octocache_path);
          } else {
            setErrorMessage(res.message || 'Selected folder does not contain a valid HoloDori install.');
          }
        } catch (err: unknown) {
          setErrorMessage(`Failed to set game folder: ${String(err)}`);
        } finally {
          setIsDetecting(false);
        }
      }
    } catch (err) {
      console.warn('Manual folder pick cancelled or failed', err);
    }
  };

  const loadCatalog = async (octoPath?: string) => {
    setIsLoadingCatalog(true);
    setErrorMessage('');
    setStatusMessage('Loading Live2D model catalog from octocache...');
    try {
      const entries = await invoke<ModelCatalogEntry[]>('load_game_catalog', {
        octocachePath: octoPath || null,
      });
      setCatalog(entries);
      setStatusMessage(`Found ${entries.length} Live2D model bundle(s) in game catalog.`);
      // Default: select all
      const allNames = new Set<string>(entries.map((e) => e.asset_name));
      setSelectedAssetNames(allNames);
      refreshCacheStats();
    } catch (err: unknown) {
      setErrorMessage(`Failed to load game catalog: ${String(err)}`);
      setStatusMessage('Catalog load failed.');
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm('Are you sure you want to clear all cached raw game bundles?')) {
      return;
    }
    try {
      const bytesFreed = await invoke<number>('clear_import_cache');
      setStatusMessage(`Cleared ${(bytesFreed / (1024 * 1024)).toFixed(1)} MB from bundle cache.`);
      refreshCacheStats();
      if (detection?.octocache_path) {
        loadCatalog(detection.octocache_path);
      }
    } catch (err: unknown) {
      setErrorMessage(`Failed to clear cache: ${String(err)}`);
    }
  };

  const handlePickOutputDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Choose Output Directory for Live2D Models',
      });
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (err) {
      console.warn('Output picker cancelled', err);
    }
  };

  const toggleSelectAsset = (assetName: string) => {
    setSelectedAssetNames((prev) => {
      const next = new Set(prev);
      if (next.has(assetName)) {
        next.delete(assetName);
      } else {
        next.add(assetName);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedAssetNames(new Set(filteredCatalog.map((e) => e.asset_name)));
  };

  const deselectAll = () => {
    setSelectedAssetNames(new Set());
  };

  const selectCachedOnly = () => {
    setSelectedAssetNames(new Set(filteredCatalog.filter((e) => e.is_cached).map((e) => e.asset_name)));
  };

  const handleStartImport = async () => {
    const selectedEntries = catalog.filter((e) => selectedAssetNames.has(e.asset_name));
    if (selectedEntries.length === 0) {
      setErrorMessage('Please select at least one model to import.');
      return;
    }
    if (!outputDir) {
      setErrorMessage('Please specify an output directory.');
      return;
    }

    setErrorMessage('');
    setIsImporting(true);
    setShowResultModal(false);
    setStatusMessage(`Starting import of ${selectedEntries.length} model(s)...`);

    try {
      const result = await invoke<ImportExecutionResult>('import_models', {
        entries: selectedEntries,
        outputDir,
        conflictPolicy,
      });

      setLastResult(result);
      setShowResultModal(true);
      refreshCacheStats();

      // Refresh catalog to update cache flags
      if (detection?.octocache_path) {
        loadCatalog(detection.octocache_path);
      }

      const successCount = result.succeeded.length;
      const failCount = result.failed.length;
      setStatusMessage(
        `Import finished: ${successCount} succeeded, ${failCount} failed${result.cancelled ? ' (cancelled)' : ''}.`
      );
    } catch (err: unknown) {
      setErrorMessage(`Import pipeline failed: ${String(err)}`);
      setStatusMessage('Import failed.');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const handleCancelImport = async () => {
    try {
      await invoke('cancel_import');
      setStatusMessage('Cancelling import operation...');
    } catch (err) {
      console.warn('Failed to send cancel signal', err);
    }
  };

  // Filter catalog
  const filteredCatalog = catalog.filter((entry) => {
    // Style filter
    if (styleFilter !== 'All') {
      if (entry.style.toLowerCase() !== styleFilter.toLowerCase()) return false;
    }
    // Cache filter
    if (cacheFilter === 'Cached' && !entry.is_cached) return false;
    if (cacheFilter === 'Remote' && entry.is_cached) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const cMatch = entry.character_id.toLowerCase().includes(q);
      const oMatch = entry.outfit_token.toLowerCase().includes(q);
      const sMatch = entry.style.toLowerCase().includes(q);
      const aMatch = entry.asset_name.toLowerCase().includes(q);
      if (!cMatch && !oMatch && !sMatch && !aMatch) return false;
    }

    return true;
  });

  const selectedCount = catalog.filter((e) => selectedAssetNames.has(e.asset_name)).length;
  const selectedBytes = catalog
    .filter((e) => selectedAssetNames.has(e.asset_name))
    .reduce((sum, e) => sum + e.size_bytes, 0);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="importer-container">
      {/* STEAM DETECTION & CACHE BAR */}
      <div className="importer-top-panel">
        <div className="detection-card">
          <div className="card-header-row">
            <div className="header-title">
              <span className="icon">{detection?.found ? '🎮' : '🔍'}</span>
              <span className="title-text">{t('importer.title')}</span>
            </div>
            <div className="detection-badges">
              {detection?.found ? (
                <span className="badge badge-success">✓ DETECTED</span>
              ) : (
                <span className="badge badge-warning">NOT LOCATED</span>
              )}
              {detection?.source && (
                <span className="badge badge-source">{detection.source.toUpperCase()}</span>
              )}
            </div>
          </div>

          <div className="card-body">
            <div className="path-display">
              <span className="path-label">Game Directory:</span>
              <span className="path-value">
                {detection?.install_path || 'Not detected. Select folder manually.'}
              </span>
            </div>
            {detection?.octocache_path && (
              <div className="path-display sub-path">
                <span className="path-label">Streaming Assets:</span>
                <span className="path-value text-muted">{detection.octocache_path}</span>
              </div>
            )}
          </div>

          <div className="card-actions">
            <Tooltip title={t('importer.steam_detect_btn')} body="Steam 라이브러리 목록을 다시 스캔하여 HoloDori 게임 설치 위치를 탐색합니다.">
              <button
                className="btn-secondary btn-small"
                onClick={runDetection}
                disabled={isDetecting || isImporting}
              >
                {isDetecting ? t('importer.steam_detecting') : t('importer.steam_detect_btn')}
              </button>
            </Tooltip>
            <Tooltip title={t('importer.choose_game_dir')} body="HoloDori 설치 폴더나 StreamingAssets가 있는 디렉터리를 직접 지정합니다.">
              <button
                className="btn-secondary btn-small"
                onClick={handlePickManualFolder}
                disabled={isDetecting || isImporting}
              >
                {t('importer.choose_game_dir')}
              </button>
            </Tooltip>
          </div>
        </div>

        {/* BUNDLE CACHE CARD */}
        <div className="cache-card">
          <div className="card-header-row">
            <div className="header-title">
              <span className="icon">💾</span>
              <span className="title-text">{t('importer.cache_status')}</span>
            </div>
            <span className="badge badge-info">
              {cacheStats ? `${cacheStats.cached_bundles_count} Cached` : '0 Cached'}
            </span>
          </div>

          <div className="card-body">
            <div className="cache-stat-row">
              <span className="stat-label">Cache Size:</span>
              <span className="stat-value">
                {cacheStats ? formatBytes(cacheStats.total_bytes) : '0 MB'}
              </span>
            </div>
            <div className="cache-stat-row">
              <span className="stat-label">Cache Path:</span>
              <span className="path-value text-muted truncate" title={cacheStats?.cache_directory || ''}>
                {cacheStats?.cache_directory || 'Standard LocalAppData cache'}
              </span>
            </div>
          </div>

          <div className="card-actions">
            <Tooltip title="캐시 폴더 열기" body="다운로드 및 추출된 원본 에셋 번들이 저장된 로컬 캐시 폴더를 파일 탐색기로 엽니다.">
              <button
                className="btn-secondary btn-small"
                onClick={() => {
                  if (cacheStats?.cache_directory) {
                    openPath(cacheStats.cache_directory).catch((e) => console.warn(e));
                  }
                }}
              >
                📂 Open Cache
              </button>
            </Tooltip>
            <Tooltip title={t('importer.cache_clear_btn')} body={t('confirm.clear_cache_desc')}>
              <button
                className="btn-danger-outline btn-small"
                onClick={handleClearCache}
                disabled={!cacheStats || cacheStats.cached_bundles_count === 0 || isImporting}
              >
                🗑️ {t('importer.cache_clear_btn')}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* CATALOG FILTER & TOOLBAR */}
      <div className="catalog-toolbar">
        <div className="toolbar-row">
          <div className="catalog-load-actions">
            <button
              className="btn-primary"
              onClick={() => loadCatalog(detection?.octocache_path || undefined)}
              disabled={isLoadingCatalog || isImporting}
            >
              {isLoadingCatalog ? 'Loading Catalog...' : '📖 Refresh Model Catalog'}
            </button>
          </div>

          <div className="catalog-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search model (e.g. 00007, 001, nrml)..."
            />
            {searchQuery && (
              <button className="btn-clear-search" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>

          <div className="filter-group">
            <label>Style:</label>
            <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}>
              <option value="All">All Styles</option>
              <option value="nrml">nrml (Normal)</option>
              <option value="uniq">uniq (Unique)</option>
              <option value="cmmn">cmmn (Common)</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Cache:</label>
            <select value={cacheFilter} onChange={(e) => setCacheFilter(e.target.value)}>
              <option value="All">All Bundles</option>
              <option value="Cached">💾 Cached (Local)</option>
              <option value="Remote">☁️ Remote (CDN)</option>
            </select>
          </div>
        </div>

        <div className="selection-toolbar-row">
          <div className="quick-selects">
            <button className="btn-secondary btn-small" onClick={selectAll} disabled={isImporting}>
              Select All ({filteredCatalog.length})
            </button>
            <button className="btn-secondary btn-small" onClick={deselectAll} disabled={isImporting}>
              Deselect All
            </button>
            <button className="btn-secondary btn-small" onClick={selectCachedOnly} disabled={isImporting}>
              Select Cached Only
            </button>
          </div>

          <div className="selection-metrics">
            <span>
              Showing <strong>{filteredCatalog.length}</strong> of {catalog.length} model(s)
            </span>
            <span className="divider">•</span>
            <span>
              Selected: <strong>{selectedCount}</strong> ({formatBytes(selectedBytes)})
            </span>
          </div>
        </div>
      </div>

      {/* NOTIFICATIONS */}
      {statusMessage && <div className="status-banner info-banner">{statusMessage}</div>}
      {errorMessage && <div className="status-banner error-banner">{errorMessage}</div>}

      {/* CATALOG TABLE */}
      <div className="catalog-table-container">
        {catalog.length === 0 ? (
          <div className="catalog-empty-state">
            <div className="empty-icon">🎮</div>
            <h3>No Live2D Models Loaded</h3>
            <p>
              {detection?.found
                ? 'Click "Refresh Model Catalog" above to read available models from your HoloDori install.'
                : 'Detect or browse for your HoloDori game installation folder to load model assets.'}
            </p>
            {detection?.found && (
              <button
                className="btn-primary"
                onClick={() => loadCatalog(detection.octocache_path || undefined)}
                disabled={isLoadingCatalog}
              >
                📖 Load Game Catalog
              </button>
            )}
          </div>
        ) : (
          <table className="catalog-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={
                      filteredCatalog.length > 0 &&
                      filteredCatalog.every((e) => selectedAssetNames.has(e.asset_name))
                    }
                    onChange={(e) => {
                      if (e.target.checked) selectAll();
                      else deselectAll();
                    }}
                  />
                </th>
                <th style={{ width: '120px' }}>Model ID</th>
                <th style={{ width: '140px' }}>Outfit & Style</th>
                <th>Asset Name</th>
                <th style={{ width: '100px' }}>Size</th>
                <th style={{ width: '120px' }}>Cache Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.length === 0 ? (
                <tr>
                  <td colSpan={6} className="no-match-row">
                    No models match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredCatalog.map((entry) => {
                  const isSelected = selectedAssetNames.has(entry.asset_name);
                  const modelId = `${entry.character_id}_${entry.outfit_token}`;

                  return (
                    <tr
                      key={entry.asset_name}
                      className={`catalog-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleSelectAsset(entry.asset_name)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectAsset(entry.asset_name)}
                        />
                      </td>
                      <td>
                        <span className="model-id-cell">{modelId}</span>
                      </td>
                      <td>
                        <span className="outfit-tag">
                          {entry.outfit_token} <span className="style-pill">{entry.style}</span>
                        </span>
                      </td>
                      <td>
                        <span className="asset-name-cell">{entry.asset_name}</span>
                      </td>
                      <td>
                        <span className="size-cell">{formatBytes(entry.size_bytes)}</span>
                      </td>
                      <td>
                        {entry.is_cached ? (
                          <span className="badge badge-cached">💾 Cached</span>
                        ) : (
                          <span className="badge badge-remote">☁️ Remote</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* IMPORT PROGRESS MODAL / OVERLAY */}
      {isImporting && importProgress && (
        <div className="modal-backdrop">
          <div className="progress-modal-card">
            <div className="progress-modal-header">
              <h3>📥 Importing HoloDori Live2D Models</h3>
              <span className="phase-pill phase-{importProgress.phase}">
                {importProgress.phase.toUpperCase()}
              </span>
            </div>

            <div className="progress-modal-body">
              <div className="progress-model-info">
                <span className="model-counter">
                  Model <strong>{importProgress.current_model_index}</strong> of{' '}
                  <strong>{importProgress.total_models}</strong>
                </span>
                <span className="current-model-name truncate">
                  <code>{importProgress.current_model_name}</code>
                </span>
              </div>

              <div className="progress-bar-container large">
                <div
                  className="progress-bar-fill animated"
                  style={{ width: `${Math.max(importProgress.overall_percentage, 5)}%` }}
                />
              </div>

              <div className="progress-stats-row">
                <span className="pct-text">{importProgress.overall_percentage.toFixed(0)}% Complete</span>
                {importProgress.bytes_total > 0 && (
                  <span className="bytes-text">
                    {formatBytes(importProgress.bytes_received)} / {formatBytes(importProgress.bytes_total)}
                  </span>
                )}
              </div>

              {importProgress.error_message && (
                <div className="progress-error-notice">{importProgress.error_message}</div>
              )}
            </div>

            <div className="progress-modal-footer">
              <button className="btn-danger" onClick={handleCancelImport}>
                ⏹ Cancel Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPLETION REPORT MODAL */}
      {showResultModal && lastResult && (
        <div className="modal-backdrop">
          <div className="result-modal-card">
            <div className="result-modal-header">
              <h3>🎉 Import Execution Complete</h3>
              <button className="btn-close" onClick={() => setShowResultModal(false)}>
                ×
              </button>
            </div>

            <div className="result-modal-body">
              <div className="result-summary-stats">
                <div className="stat-box success">
                  <span className="stat-number">{lastResult.succeeded.length}</span>
                  <span className="stat-label">Imported Successfully</span>
                </div>
                <div className={`stat-box ${lastResult.failed.length > 0 ? 'fail' : 'neutral'}`}>
                  <span className="stat-number">{lastResult.failed.length}</span>
                  <span className="stat-label">Failed</span>
                </div>
                <div className="stat-box neutral">
                  <span className="stat-number">{lastResult.total_processed}</span>
                  <span className="stat-label">Total Processed</span>
                </div>
              </div>

              {lastResult.succeeded.length > 0 && (
                <div className="result-section">
                  <h4>✅ Successfully Created Packages</h4>
                  <div className="result-list-scroll">
                    {lastResult.succeeded.map((s, idx) => (
                      <div key={idx} className="result-item-row success-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                          <span className="item-id">
                            {s.character_id}_{s.outfit_id}
                          </span>
                          <span className="item-asset text-muted">{s.asset_name}</span>
                          <span className="item-dest truncate" title={s.output_dir}>
                            {s.output_dir}
                          </span>
                        </div>
                        {onOpenViewer && (
                          <button
                            className="btn-primary"
                            style={{
                              padding: '2px 8px',
                              fontSize: '11px',
                              backgroundColor: '#98c379',
                              color: '#181a1f',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => {
                              onOpenViewer({
                                packageDir: s.output_dir,
                                characterId: s.character_id,
                                outfitId: s.outfit_id,
                                displayName: `${s.character_id}_${s.outfit_id}`,
                              });
                            }}
                          >
                            👁️ View
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lastResult.failed.length > 0 && (
                <div className="result-section">
                  <h4 className="text-danger">⚠️ Failed Models</h4>
                  <div className="result-list-scroll">
                    {lastResult.failed.map((f, idx) => (
                      <div key={idx} className="result-item-row fail-item">
                        <span className="item-asset text-danger">{f.asset_name}</span>
                        <span className="item-error">{f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="result-modal-footer">
              <button
                className="btn-secondary"
                onClick={() => {
                  if (outputDir) openPath(outputDir).catch((e) => console.warn(e));
                }}
              >
                📂 {t('about.btn_open_output')}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowResultModal(false);
                  onNavigateToLibrary(outputDir);
                }}
              >
                📚 {t('importer.go_to_library')}
              </button>
              <button className="btn-secondary" onClick={() => setShowResultModal(false)}>
                {t('btn.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM ACTION BAR */}
      <footer className="importer-footer">
        <div className="footer-left">
          <div className="output-config">
            <span className="output-label">{t('source.output_dir')}:</span>
            <input
              type="text"
              className="output-input wide"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Destination folder for Live2D packages..."
            />
            <Tooltip title={t('source.output_dir')} body="Live2D 모델 패키지가 저장될 대상 폴더를 선택합니다.">
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
        </div>

        <div className="footer-right">
          <Tooltip title={t('about.btn_open_output')} body="생성된 Live2D 패키지 폴더를 파일 탐색기로 엽니다.">
            <button
              className="btn-secondary"
              onClick={() => {
                if (outputDir) openPath(outputDir).catch((e) => console.warn(e));
              }}
            >
              📂 {t('about.btn_open_output')}
            </button>
          </Tooltip>
          <Tooltip contentKey="tooltip.import_models">
            <button
              className="btn-primary btn-large"
              onClick={handleStartImport}
              disabled={selectedCount === 0 || isImporting}
            >
              ⬇️ {t('importer.import_btn')} ({selectedCount})
            </button>
          </Tooltip>
        </div>
      </footer>
    </div>
  );
};

export default ImporterView;
