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
