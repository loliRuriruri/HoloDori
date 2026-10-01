export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ParameterCategory =
  | 'Angle'
  | 'Eye'
  | 'Eyebrow'
  | 'Mouth'
  | 'Body'
  | 'Hair'
  | 'Other';

export interface ModelParameterInfo {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  currentValue: number;
  category: ParameterCategory;
}

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ViewerOptions {
  enableBreath: boolean;
  enableEyeBlink: boolean;
}

export interface ModelPackageTarget {
  packageDir: string;
  characterId: string;
  outfitId: string;
  modelJsonFile?: string;
  displayName?: string;
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

export type MotionPlaybackState = 'idle' | 'loading' | 'playing' | 'stopping' | 'error';

export interface MotionPlayInfo {
  assetName: string;
  name: string;
  duration: number;
}

export interface ExpressionPlayInfo {
  assetName: string;
  name: string;
}
