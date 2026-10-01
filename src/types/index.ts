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
