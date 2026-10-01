export type FileClassification =
  | 'ModelResourceJson'
  | 'TextureImage'
  | 'RawMoc'
  | 'OtherJson'
  | 'Ignored';

export type MatchConfidence = 'NoMatch' | 'Ambiguous' | 'High' | 'Exact';

export type ModelSourceType = 'JsonBytes' | 'RawMoc';

export type ConflictPolicy = 'Skip' | 'UniqueSuffix' | 'Overwrite';

export type BuildStatus = 'Pass' | 'PassWithWarnings' | 'Fail';

export type MocVersion =
  | { Known: { raw: number; version_label: string } }
  | { Unknown: number }
  | 'Invalid';

export type RuntimeValidationStatus = 'NotTested' | 'Pass' | 'Fail';

export interface ParsedIdentity {
  character_id: string;
  outfit_id: string;
  style_tag: string | null;
  confidence: MatchConfidence;
  evidence: string[];
  source_stem: string;
}

export interface MatchedPair {
  id: string;
  model_source: string;
  model_type: ModelSourceType;
  identity: ParsedIdentity;
  textures: string[];
  match_confidence: MatchConfidence;
  evidence: string[];
  warnings: string[];
}

export interface ValidationStageResult {
  stage_name: string;
  passed: boolean;
  message: string;
}

export interface ModelBuildReport {
  model_id: string;
  status: BuildStatus;
  moc_version: MocVersion;
  runtime_validation: RuntimeValidationStatus;
  runtime_details: string | null;
  input_files: string[];
  output_files: string[];
  output_directory: string | null;
  validation_stages: ValidationStageResult[];
  warnings: string[];
  errors: string[];
}

export interface BatchBuildReport {
  total_models: number;
  passed: number;
  passed_with_warnings: number;
  failed: number;
  reports: ModelBuildReport[];
  overall_status: BuildStatus;
}

export type LibraryFilter =
  | 'All'
  | 'Buildable'
  | 'Built'
  | 'Warnings'
  | 'Ambiguous'
  | 'Failed';

export type StyleFilter = 'All' | 'Nrml' | 'Uniq' | 'Cmmn' | 'Unknown';

export interface OutfitEntry {
  id: string;
  character_id: string;
  outfit_id: string;
  style_token: string | null;
  model_source: string;
  model_type: ModelSourceType;
  textures: string[];
  match_status: MatchConfidence;
  validation_status: BuildStatus | null;
  build_status: BuildStatus | null;
  thumbnail_source: string | null;
  evidence: string[];
  warnings: string[];
  matched_pair: MatchedPair;
}

export interface CharacterEntry {
  character_id: string;
  display_name: string | null;
  outfits: OutfitEntry[];
  warnings: string[];
  buildable_count: number;
}

export interface LibraryScanReport {
  scanned_files: number;
  model_resources_found: number;
  textures_found: number;
  matched_outfits: number;
  ambiguous_outfits: number;
  scan_duration_ms: number;
  cache_hit_count: number;
  cache_miss_count: number;
}

export interface CharacterLibrary {
  root_paths: string[];
  characters: CharacterEntry[];
  total_models: number;
  buildable_models: number;
  scan_report: LibraryScanReport;
}

export interface BatchProgress {
  current_index: number;
  total_models: number;
  current_model_id: string;
  stage: string;
  status: string;
}

export type SteamDetectionSource =
  | 'registry'
  | 'library_folders'
  | 'common_default'
  | 'manual_fallback';

export interface SteamDetectionResult {
  found: boolean;
  install_path: string | null;
  octocache_path: string | null;
  source: SteamDetectionSource | null;
  message: string;
}

export interface ModelCatalogEntry {
  asset_name: string;
  object_name: string;
  character_id: string;
  style: string;
  outfit_token: string;
  size_bytes: number;
  md5: string;
  is_cached: boolean;
}

export type ImportPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'building_manifest'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ImportProgress {
  total_models: number;
  current_model_index: number;
  current_model_name: string;
  phase: ImportPhase;
  bytes_received: number;
  bytes_total: number;
  overall_percentage: number;
  error_message: string | null;
}

export interface ImportedModelSummary {
  asset_name: string;
  character_id: string;
  outfit_id: string;
  moc3_file: string;
  textures: string[];
  manifest_file: string;
  output_dir: string;
}

export interface FailedModelSummary {
  asset_name: string;
  error: string;
}

export interface ImportExecutionResult {
  succeeded: ImportedModelSummary[];
  failed: FailedModelSummary[];
  total_processed: number;
  cancelled: boolean;
}

export interface CacheStats {
  cached_bundles_count: number;
  total_bytes: number;
  cache_directory: string;
}

export interface MotionCatalogEntry {
  asset_name: string;
  object_name: string;
  name: string;
  category: string;
  size_bytes: number;
  md5: string;
  is_cached: boolean;
}

export interface ExpressionCatalogEntry {
  asset_name: string;
  object_name: string;
  name: string;
  character_id: string;
  outfit_token: string;
  size_bytes: number;
  md5: string;
  is_cached: boolean;
}

export interface ModelAnimationMetadata {
  character_id: string;
  expressions: ExpressionCatalogEntry[];
  motions: MotionCatalogEntry[];
}

export type WallpaperHostKind = 'worker_w' | 'progman' | 'desktop_overlay';

export type WallpaperState =
  | 'disabled'
  | 'discovering_host'
  | 'attaching'
  | 'active_worker_w'
  | 'active_progman'
  | 'fallback_overlay'
  | 'recovering'
  | 'error';

export type WallpaperHostPreference = 'auto' | 'worker_w' | 'progman' | 'desktop_overlay';

export interface WallpaperStatus {
  state: WallpaperState;
  active_host: WallpaperHostKind;
  host_hwnd: string | null;
  is_wallpaper_active: boolean;
  is_fallback: boolean;
  error_message: string | null;
  timestamp_utc: string;
}

export interface WallpaperDiagnostics {
  os_caption: string;
  os_version: string;
  build_number: string;
  display_version: string;
  explorer_version: string;
  topology: string;
  status: WallpaperStatus;
  host_info?: {
    host_kind: WallpaperHostKind;
    host_hwnd: number;
    host_hwnd_hex: string;
    progman_hwnd: number;
    defview_hwnd: number;
    workerw_hwnd?: number;
    topology: string;
    explorer_pid: number;
  };
  supported_hosts: WallpaperHostKind[];
}

