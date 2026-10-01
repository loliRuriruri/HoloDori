import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_WALLPAPER_SETTINGS,
  PlayerFavorites,
  RecentModel,
  ViewerSettings,
} from './types';

const STORAGE_KEY_SETTINGS = 'hdm_viewer_settings';
const STORAGE_KEY_FAVORITES = 'hdm_player_favorites';
const STORAGE_KEY_RECENT = 'hdm_recent_models';

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  mode: 'player',
  background: 'neutral',
  enableBlink: true,
  enableBreath: true,
  enablePhysics: true,
  autoMotion: false,
  autoMotionDelaySec: 3.0,
  zoom: 1.0,
  desktop: { ...DEFAULT_DESKTOP_SETTINGS },
  wallpaper: { ...DEFAULT_WALLPAPER_SETTINGS },
};

export const DEFAULT_FAVORITES: PlayerFavorites = {
  characters: [],
  outfits: [],
  motions: [],
  expressions: [],
};

export interface PersistedPlayerState {
  settings: ViewerSettings;
  favorites: PlayerFavorites;
  recentModels: RecentModel[];
}

/**
 * Loads persisted player settings, favorites, and recent models from Tauri IPC or localStorage.
 */
export async function loadPlayerState(): Promise<PersistedPlayerState> {
  try {
    const raw = await invoke<Partial<PersistedPlayerState>>('load_player_settings');
    if (raw && typeof raw === 'object') {
      const mergedDesktop = {
        ...DEFAULT_DESKTOP_SETTINGS,
        ...((raw.settings && raw.settings.desktop) || {}),
      };
      const mergedWallpaper = {
        ...DEFAULT_WALLPAPER_SETTINGS,
        ...((raw.settings && raw.settings.wallpaper) || {}),
      };
      return {
        settings: {
          ...DEFAULT_VIEWER_SETTINGS,
          ...(raw.settings || {}),
          desktop: mergedDesktop,
          wallpaper: mergedWallpaper,
        },
        favorites: {
          characters: raw.favorites?.characters || [],
          outfits: raw.favorites?.outfits || [],
          motions: raw.favorites?.motions || [],
          expressions: raw.favorites?.expressions || [],
        },
        recentModels: Array.isArray(raw.recentModels) ? raw.recentModels.slice(0, 10) : [],
      };
    }
  } catch {
    // Fall back to localStorage (e.g. running in mock/browser environment)
  }

  // LocalStorage fallback
  let settings = { ...DEFAULT_VIEWER_SETTINGS };
  let favorites = { ...DEFAULT_FAVORITES };
  let recentModels: RecentModel[] = [];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const s = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (s) {
        const parsed = JSON.parse(s);
        settings = {
          ...settings,
          ...parsed,
          desktop: {
            ...DEFAULT_DESKTOP_SETTINGS,
            ...(parsed.desktop || {}),
          },
          wallpaper: {
            ...DEFAULT_WALLPAPER_SETTINGS,
            ...(parsed.wallpaper || {}),
          },
        };
      }
      const f = localStorage.getItem(STORAGE_KEY_FAVORITES);
      if (f) favorites = { ...favorites, ...JSON.parse(f) };
      const r = localStorage.getItem(STORAGE_KEY_RECENT);
      if (r) recentModels = JSON.parse(r).slice(0, 10);
    } catch {
      // Ignore parse errors
    }
  }

  return { settings, favorites, recentModels };
}

/**
 * Persists player state to Tauri IPC and localStorage.
 */
export async function savePlayerState(state: PersistedPlayerState): Promise<void> {
  // Sync to localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
      localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(state.favorites));
      localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(state.recentModels.slice(0, 10)));
    } catch {
      // Ignore local storage write errors
    }
  }

  // Sync to Tauri file storage
  try {
    await invoke('save_player_settings', {
      settings: {
        settings: state.settings,
        favorites: state.favorites,
        recentModels: state.recentModels.slice(0, 10),
      },
    });
  } catch {
    // Ignore in non-Tauri test environments
  }
}

/**
 * Adds or updates a recent model in the list, ensuring it's at the front and capped at 10.
 */
export function pushRecentModel(list: RecentModel[], entry: Omit<RecentModel, 'timestamp'>): RecentModel[] {
  const filtered = list.filter((m) => m.modelId !== entry.modelId);
  const updated: RecentModel = {
    ...entry,
    timestamp: Date.now(),
  };
  return [updated, ...filtered].slice(0, 10);
}

/**
 * Toggles a favorite item ID within a category.
 */
export function toggleFavoriteItem(
  favorites: PlayerFavorites,
  category: keyof PlayerFavorites,
  id: string
): PlayerFavorites {
  const current = favorites[category];
  const exists = current.includes(id);
  const updated = exists ? current.filter((x) => x !== id) : [...current, id];
  return {
    ...favorites,
    [category]: updated,
  };
}
