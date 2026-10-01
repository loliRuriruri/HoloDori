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

