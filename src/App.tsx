import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import './App.css';
import {
  MatchedPair,
  BatchBuildReport,
  ConflictPolicy,
} from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'input' | 'models' | 'results'>('input');
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [manualPathInput, setManualPathInput] = useState<string>('');
  const [detectedPairs, setDetectedPairs] = useState<MatchedPair[]>([]);
  const [selectedPairIds, setSelectedPairIds] = useState<Set<string>>(new Set());
  const [outputDir, setOutputDir] = useState<string>('');
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('Skip');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [buildReport, setBuildReport] = useState<BatchBuildReport | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    // Attempt to load default output directory
    invoke<string>('get_default_output_dir')
      .then((dir) => setOutputDir(dir))
      .catch(() => setOutputDir('./output'));
  }, []);

  const handleAddManualPath = () => {
    if (manualPathInput.trim()) {
      const trimmed = manualPathInput.trim();
      if (!inputPaths.includes(trimmed)) {
        setInputPaths([...inputPaths, trimmed]);
      }
      setManualPathInput('');
    }
  };

  const handlePickFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: true,
      });
      if (selected) {
        const newPaths = Array.isArray(selected) ? selected : [selected];
        setInputPaths((prev) => Array.from(new Set([...prev, ...newPaths])));
      }
    } catch (e) {
      console.warn('Folder dialog skipped or unsupported in browser mode', e);
    }
  };

  const handlePickFiles = async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: true,
        filters: [{ name: 'Live2D Resources', extensions: ['json', 'png', 'moc3'] }],
      });
      if (selected) {
        const newPaths = Array.isArray(selected) ? selected : [selected];
        setInputPaths((prev) => Array.from(new Set([...prev, ...newPaths])));
      }
    } catch (e) {
      console.warn('File dialog skipped or unsupported in browser mode', e);
    }
  };

  const handleRemovePath = (idx: number) => {
    setInputPaths(inputPaths.filter((_, i) => i !== idx));
  };

  const handleScan = async () => {
    if (inputPaths.length === 0) {
      setErrorMessage('Please add at least one file or folder path to scan.');
      return;
    }
    setErrorMessage('');
    setIsScanning(true);
    setStatusMessage('Scanning inputs and identifying Live2D models...');

    try {
      const pairs = await invoke<MatchedPair[]>('scan_inputs', { paths: inputPaths });
      setDetectedPairs(pairs);
      // Auto-select valid pairs (Exact and High)
      const validIds = new Set(
        pairs
          .filter((p) => p.match_confidence === 'Exact' || p.match_confidence === 'High')
          .map((p) => p.id)
      );
      setSelectedPairIds(validIds);
      setStatusMessage(`Scan complete: found ${pairs.length} candidate model(s).`);
      setActiveTab('models');
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : String(err);
      setErrorMessage(`Scan failed: ${msg}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedPairIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedPairIds(next);
  };

  const handleBuild = async () => {
    const pairsToBuild = detectedPairs.filter((p) => selectedPairIds.has(p.id));
    if (pairsToBuild.length === 0) {
      setErrorMessage('No models selected to build.');
      return;
    }
    setErrorMessage('');
    setIsBuilding(true);
    setStatusMessage(`Building ${pairsToBuild.length} model package(s)...`);

    try {
      const report = await invoke<BatchBuildReport>('build_models', {
        pairs: pairsToBuild,
        outputDir,
        conflictPolicy,
      });
      setBuildReport(report);
      setActiveTab('results');
      setStatusMessage(
        `Build finished with overall status: ${report.overall_status}. (Passed: ${report.passed}, Warnings: ${report.passed_with_warnings}, Failed: ${report.failed})`
      );
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : String(err);
      setErrorMessage(`Build failed: ${msg}`);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleOpenFolder = async (folderPath: string) => {
    try {
      await openPath(folderPath);
    } catch (err) {
      alert(`Could not open folder automatically: ${folderPath}`);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand-title">
          <span>HoloDori Live2D Manager</span>
          <span className="brand-badge">v0.1.0</span>
        </div>
        <nav className="nav-tabs">
          <button
            className={`nav-tab-btn ${activeTab === 'input' ? 'active' : ''}`}
            onClick={() => setActiveTab('input')}
          >
            1. Input & Scan
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            2. Detected Models ({detectedPairs.length})
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            3. Build & Report {buildReport ? `(${buildReport.overall_status})` : ''}
          </button>
        </nav>
      </header>

      <main className="main-content">
        {statusMessage && (
          <div style={{ padding: '10px 14px', marginBottom: '16px', backgroundColor: '#1e3a8a', borderRadius: '6px', color: '#bfdbfe' }}>
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div style={{ padding: '10px 14px', marginBottom: '16px', backgroundColor: '#7f1d1d', borderRadius: '6px', color: '#fecaca' }}>
            {errorMessage}
          </div>
        )}

        {activeTab === 'input' && (
          <section className="card">
            <h2 className="card-title">Input Resources</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Select extracted game folders or files containing <code>_bytes</code> JSON models, raw MOC3 files, and PNG textures.
            </p>

            <div className="button-group" style={{ marginBottom: '16px' }}>
              <button className="btn btn-secondary" onClick={handlePickFolder}>
                📁 Add Folder...
              </button>
              <button className="btn btn-secondary" onClick={handlePickFiles}>
                📄 Add File(s)...
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Or paste directory or file path manually..."
                value={manualPathInput}
                onChange={(e) => setManualPathInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddManualPath()}
              />
              <button className="btn btn-secondary" onClick={handleAddManualPath}>
                Add Path
              </button>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Queued Target Path</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {inputPaths.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        No input paths added yet. Add a folder or files above.
                      </td>
                    </tr>
                  ) : (
                    inputPaths.map((p, idx) => (
                      <tr key={idx}>
                        <td style={{ fontFamily: 'monospace' }}>{p}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                            onClick={() => handleRemovePath(idx)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={handleScan}
                disabled={isScanning || inputPaths.length === 0}
              >
                {isScanning ? 'Scanning...' : 'Scan Resources →'}
              </button>
            </div>
          </section>
        )}

        {activeTab === 'models' && (
          <section className="card">
            <h2 className="card-title">Detected Models & Texture Association</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Verify model and texture associations before conversion. Ambiguous associations require manual check.
            </p>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={selectedPairIds.size === detectedPairs.length && detectedPairs.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPairIds(new Set(detectedPairs.map((p) => p.id)));
                          } else {
                            setSelectedPairIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th>Model Identifier</th>
                    <th>Character</th>
                    <th>Outfit</th>
                    <th>Style</th>
                    <th>Model Source</th>
                    <th>Associated Textures</th>
                    <th>Match Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detectedPairs.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        No models detected yet. Scan inputs first.
                      </td>
                    </tr>
                  ) : (
                    detectedPairs.map((pair) => (
                      <tr key={pair.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedPairIds.has(pair.id)}
                            onChange={() => handleToggleSelect(pair.id)}
                          />
                        </td>
                        <td style={{ fontWeight: 600 }}>{pair.id}</td>
                        <td>{pair.identity.character_id || 'Unknown'}</td>
                        <td>{pair.identity.outfit_id || 'Unknown'}</td>
                        <td>{pair.identity.style_tag || '—'}</td>
                        <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                          {pair.model_source.split(/[/\\]/).pop()}
                        </td>
                        <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                          {pair.textures.length > 0
                            ? pair.textures.map((t) => t.split(/[/\\]/).pop()).join(', ')
                            : 'None'}
                        </td>
                        <td>
                          <span className={`badge badge-${pair.match_confidence.toLowerCase()}`}>
                            {pair.match_confidence}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Output Directory
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Conflict Policy
                </label>
                <select
                  className="form-select"
                  value={conflictPolicy}
                  onChange={(e) => setConflictPolicy(e.target.value as ConflictPolicy)}
                >
                  <option value="Skip">Skip if Exists</option>
                  <option value="UniqueSuffix">Create Unique Suffix (_1, _2)</option>
                  <option value="Overwrite">Overwrite Existing</option>
                </select>
              </div>

              <div style={{ alignSelf: 'flex-end' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleBuild}
                  disabled={isBuilding || selectedPairIds.size === 0}
                >
                  {isBuilding ? 'Building Packages...' : `Build Selected (${selectedPairIds.size}) →`}
                </button>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'results' && buildReport && (
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                Build Results & Validation Report
              </h2>
              <span className={`badge badge-${buildReport.overall_status.toLowerCase().replace(/_/g, '-')}`}>
                {buildReport.overall_status}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '20px', padding: '14px', backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '6px', marginBottom: '20px' }}>
              <div>Total: <strong>{buildReport.total_models}</strong></div>
              <div style={{ color: 'var(--accent-success)' }}>Passed: <strong>{buildReport.passed}</strong></div>
              <div style={{ color: 'var(--accent-warning)' }}>Passed with Warnings: <strong>{buildReport.passed_with_warnings}</strong></div>
              <div style={{ color: 'var(--accent-error)' }}>Failed: <strong>{buildReport.failed}</strong></div>
            </div>

            {buildReport.reports.map((r, idx) => (
              <div
                key={idx}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '16px',
                  marginBottom: '16px',
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    Model: {r.model_id}
                  </div>
                  <span className={`badge badge-${r.status.toLowerCase().replace(/_/g, '-')}`}>
                    {r.status}
                  </span>
                </div>

                {r.output_directory && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Destination:</span>
                    <code style={{ fontSize: '0.85rem', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                      {r.output_directory}
                    </code>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                      onClick={() => handleOpenFolder(r.output_directory!)}
                    >
                      Open Output Folder
                    </button>
                  </div>
                )}

                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  10-Stage Validation Verification:
                </div>
                <div className="validation-grid">
                  {r.validation_stages.map((stage, sIdx) => (
                    <div key={sIdx} className="validation-item">
                      <span className={`status-icon ${stage.passed ? 'pass' : 'fail'}`}>
                        {stage.passed ? '✓' : '✗'}
                      </span>
                      <div>
                        <div>{stage.stage_name}</div>
                        <div style={{ fontSize: '0.75rem', color: stage.passed ? 'var(--text-muted)' : 'var(--accent-error)' }}>
                          {stage.message}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {r.errors.length > 0 && (
                  <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: 'rgba(127, 29, 29, 0.3)', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 600, color: '#fca5a5', fontSize: '0.85rem' }}>Errors:</div>
                    {r.errors.map((err, eIdx) => (
                      <div key={eIdx} style={{ fontSize: '0.8rem', color: '#fecaca' }}>• {err}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
};
export default App;
