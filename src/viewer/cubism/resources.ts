import { invoke } from '@tauri-apps/api/core';

export interface Model3JsonFileReferences {
  Moc: string;
  Textures: string[];
  Physics?: string;
  Pose?: string;
  DisplayInfo?: string;
  Expressions?: { Name: string; File: string }[];
  Motions?: Record<string, { File: string }[]>;
}

export interface Model3Json {
  Version: number;
  FileReferences: Model3JsonFileReferences;
}

export interface LoadedModelPackage {
  packageDir: string;
  model3Json: Model3Json;
  mocBuffer: ArrayBuffer;
  textureImages: HTMLImageElement[];
  textureUrls: string[];
  physicsBuffer?: ArrayBuffer;
  dispose: () => void;
}

async function readPackageBytes(
  packageDir: string,
  relativePath: string
): Promise<Uint8Array> {
  const win =
    typeof window !== 'undefined'
      ? (window as unknown as {
          __HDM_MOCK_READ_PACKAGE_FILE__?: (
            dir: string,
            rel: string
          ) => Promise<Uint8Array | number[]>;
        })
      : {};

  if (typeof win.__HDM_MOCK_READ_PACKAGE_FILE__ === 'function') {
    const res = await win.__HDM_MOCK_READ_PACKAGE_FILE__(packageDir, relativePath);
    return res instanceof Uint8Array ? res : new Uint8Array(res);
  }

  const raw = await invoke<number[]>('read_package_file', {
    packageDir,
    relativePath,
  });
  return new Uint8Array(raw);
}

/**
 * Loads a Live2D model package safely via Tauri IPC commands.
 * Handles binary conversion, HTML Image instantiation, and Blob URL lifecycle management.
 */
export async function loadModelPackageFromDisk(
  packageDir: string,
  modelJsonFileName?: string
): Promise<LoadedModelPackage> {
  const jsonName = modelJsonFileName || findModelJsonName(packageDir);

  // 1. Read and parse model3.json
  const jsonBytes = await readPackageBytes(packageDir, jsonName);
  const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
  const model3Json: Model3Json = JSON.parse(jsonText);

  if (!model3Json.FileReferences || !model3Json.FileReferences.Moc) {
    throw new Error(`Invalid model3.json in ${packageDir}: Missing FileReferences.Moc`);
  }

  // 2. Read MOC3 binary data
  const mocRelative = model3Json.FileReferences.Moc;
  const mocUint8 = await readPackageBytes(packageDir, mocRelative);
  const mocBuffer: ArrayBuffer = (mocUint8.buffer as ArrayBuffer).slice(
    mocUint8.byteOffset,
    mocUint8.byteOffset + mocUint8.byteLength
  ) as ArrayBuffer;

  // 3. Read and construct textures
  const textureFiles = model3Json.FileReferences.Textures || [];
  const createdUrls: string[] = [];
  const textureImages: HTMLImageElement[] = [];

  try {
    for (let i = 0; i < textureFiles.length; i++) {
      const texRelPath = textureFiles[i];
      const texBytes = await readPackageBytes(packageDir, texRelPath);

      const blob = new Blob([texBytes as unknown as BlobPart], { type: 'image/png' });
      const objectUrl = URL.createObjectURL(blob);
      createdUrls.push(objectUrl);

      const img = await loadImageElement(objectUrl);
      textureImages.push(img);
    }
  } catch (err) {
    // If any texture fails to load, clean up previously created object URLs
    for (const url of createdUrls) {
      URL.revokeObjectURL(url);
    }
    throw err;
  }

  // 4. Optional: Read physics binary data if referenced
  let physicsBuffer: ArrayBuffer | undefined;
  if (model3Json.FileReferences && model3Json.FileReferences.Physics) {
    try {
      const physBytes = await readPackageBytes(packageDir, model3Json.FileReferences.Physics);
      physicsBuffer = (physBytes.buffer as ArrayBuffer).slice(
        physBytes.byteOffset,
        physBytes.byteOffset + physBytes.byteLength
      ) as ArrayBuffer;
    } catch {
      // Physics file missing or unreadable - non-fatal
    }
  }

  const dispose = () => {
    for (const url of createdUrls) {
      URL.revokeObjectURL(url);
    }
  };

  return {
    packageDir,
    model3Json,
    mocBuffer,
    textureImages,
    textureUrls: createdUrls,
    physicsBuffer,
    dispose,
  };
}

function findModelJsonName(packageDir: string): string {
  // Derive default model3.json file name from directory stem
  const clean = packageDir.replace(/[\\/]+$/, '');
  const base = clean.split(/[\\/]/).pop() || 'model';
  return `${base}.model3.json`;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load texture image from ${url}: ${e}`));
    img.src = url;
  });
}
