import { CubismFramework, Option, LogLevel } from './framework/live2dcubismframework';

let isFrameworkInitialized = false;
let activeModelCount = 0;

/**
 * Checks whether the proprietary Live2D Cubism Core library has been loaded into window.
 */
export function isCubismCoreAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const core = (window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore;
  return typeof core !== 'undefined' && core !== null;
}

/**
 * Gets version string or information from the loaded Cubism Core if available.
 */
export function getCubismCoreVersion(): string | null {
  if (!isCubismCoreAvailable()) return null;
  try {
    const core = (window as unknown as { Live2DCubismCore: { Version?: { getVersion: () => number } } }).Live2DCubismCore;
    if (core && core.Version && typeof core.Version.getVersion === 'function') {
      const v = core.Version.getVersion();
      const major = (v >> 24) & 0xff;
      const minor = (v >> 16) & 0xff;
      const patch = v & 0xffff;
      return `${major}.${minor}.${patch}`;
    }
  } catch (e) {
    console.warn('Failed to retrieve Cubism Core version', e);
  }
  return 'Available';
}

/**
 * Initializes the Cubism Framework singleton.
 * Safe to call multiple times; uses reference counting.
 */
export function acquireCubismFramework(): boolean {
  if (!isCubismCoreAvailable()) {
    console.error('Cannot initialize CubismFramework: Live2DCubismCore is not available on window.');
    return false;
  }

  activeModelCount++;

  if (isFrameworkInitialized) {
    return true;
  }

  try {
    const option = new Option();
    option.logFunction = (msg: string) => {
      // Filter out excessive debug spam
      if (msg.includes('Error') || msg.includes('Warning')) {
        console.warn('[Live2D Cubism]', msg);
      }
    };
    option.loggingLevel = LogLevel.LogLevel_Warning;

    if (!CubismFramework.isStarted()) {
      CubismFramework.startUp(option);
    }

    if (!CubismFramework.isInitialized()) {
      CubismFramework.initialize();
    }

    isFrameworkInitialized = true;
    return true;
  } catch (err) {
    console.error('Failed to initialize CubismFramework:', err);
    activeModelCount = Math.max(0, activeModelCount - 1);
    return false;
  }
}

/**
 * Releases reference to Cubism Framework. When no active models remain,
 * cleans up resources if appropriate.
 */
export function releaseCubismFramework(): void {
  activeModelCount = Math.max(0, activeModelCount - 1);
  // Keep framework initialized across model transitions to avoid repeated heap allocation overhead
}

/**
 * Force disposals of the entire framework singleton (e.g. app shutdown).
 */
export function forceDisposeCubismFramework(): void {
  activeModelCount = 0;
  if (isFrameworkInitialized) {
    try {
      if (CubismFramework.isInitialized()) {
        CubismFramework.dispose();
      }
      if (CubismFramework.isStarted()) {
        CubismFramework.cleanUp();
      }
    } catch (e) {
      console.warn('Error during CubismFramework dispose', e);
    }
    isFrameworkInitialized = false;
  }
}
