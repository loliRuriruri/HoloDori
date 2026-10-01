export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ViewerMode = 'player' | 'advanced';

export type ViewerBackground = 'neutral' | 'checkerboard' | 'transparent';

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
  enablePhysics: boolean;
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

export interface DesktopWindowSettings {
  x?: number;
  y?: number;
  width: number;
  height: number;
  scale: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  editMode: boolean;
  fps: number;
  performanceMode: 'quality' | 'balanced' | 'low_power';
  hideDuringFullscreen: boolean;
  paused: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopWindowSettings = {
  width: 500,
  height: 700,
  scale: 1.0,
  alwaysOnTop: true,
  clickThrough: false,
  editMode: false,
  fps: 60,
  performanceMode: 'balanced',
  hideDuringFullscreen: false,
  paused: false,
};

export type WallpaperHostPreference = 'auto' | 'worker_w' | 'progman' | 'desktop_overlay';

export interface WallpaperSettings {
  enabled: boolean;
  preference: WallpaperHostPreference;
  fallbackEnabled: boolean;
  autoRecover: boolean;
  monitorMode: 'primary' | 'all' | 'custom';
  selectedMonitor?: string;
  targetFps: 30 | 60;
}

export const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  enabled: false,
  preference: 'auto',
  fallbackEnabled: true,
  autoRecover: true,
  monitorMode: 'primary',
  targetFps: 60,
};

export interface ViewerSettings {
  mode: ViewerMode;
  background: ViewerBackground;
  enableBlink: boolean;
  enableBreath: boolean;
  enablePhysics: boolean;
  autoMotion: boolean;
  autoMotionDelaySec: number;
  zoom: number;
  lastCharacterId?: string;
  lastOutfitId?: string;
  desktop?: DesktopWindowSettings;
  wallpaper?: WallpaperSettings;
}

export interface PlayerFavorites {
  characters: string[];
  outfits: string[];
  motions: string[];
  expressions: string[];
}

export interface RecentModel {
  modelId: string;
  characterId: string;
  outfitId: string;
  displayName: string;
  packageDir: string;
  timestamp: number;
}

export interface ModelDiagnostics {
  fps: number;
  modelId: string;
  mocVersion: string;
  paramCount: number;
  playingMotion: string | null;
  activeExpression: string | null;
  physicsLoaded: boolean;
  physicsSettingsCount: number;
  webglVendor: string;
  webglRenderer: string;
  coreVersion: string;
}
