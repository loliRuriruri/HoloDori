# Development & Build Guide

This document describes how to set up the development environment, build the project from source, and run the automated test suite for **HoloDori Live2D Manager (HDM)**.

---

## 1. Prerequisites

- **Windows 10 / 11 (64-bit)**
- **Rust Toolchain**: 1.78+ (recommended: latest stable `rustup default stable`)
- **Node.js**: 20.x or later (recommended: LTS)
- **Tauri Prerequisites**: C++ Build Tools (via Visual Studio Build Tools or Community edition)
- **WebView2 Runtime**: Installed by default on Windows 10/11.

---

## 2. Repository Layout

```
holodori/
├── .github/workflows/          # GitHub Actions CI workflow
├── docs/                       # Technical documentation and guides
├── public/                     # Static assets (shaders, icons)
│   ├── live2d/                 # Local Cubism Core destination (gitignored)
│   └── shaders/                # WebGL vertex/fragment shaders
├── src/                        # React + TypeScript frontend
│   ├── components/             # Reusable UI components
│   ├── desktop/                # Desktop mascot & wallpaper UI
│   ├── types/                  # Shared TypeScript interfaces
│   └── viewer/                 # Cubism WebGL runtime & player logic
├── src-tauri/                  # Rust backend & native plugins
│   ├── examples/               # Verification & live inspection tools
│   ├── src/                    # Rust source modules (commands, importer, desktop)
│   ├── tests/                  # Integration test suites
│   ├── Cargo.toml              # Rust crate manifest
│   └── tauri.conf.json         # Tauri configuration
├── tests/                      # Frontend unit test suites
├── package.json                # Node.js project manifest
├── tsconfig.json               # TypeScript compiler configuration
└── vite.config.ts              # Vite bundler configuration
```

---

## 3. Setup & Development Workflow

### Step 1: Install Dependencies
```powershell
npm install
```

### Step 2: Configure Cubism Core
Copy `live2dcubismcore.min.js` to `public/live2d/live2dcubismcore.min.js`.

### Step 3: Run Development Server
```powershell
npm run tauri dev
```
This runs Vite with hot-module replacement (HMR) and compiles the Rust backend with debug assertions enabled.

---

## 4. Building Production Artifacts

To compile the optimized release binary with embedded assets:

```powershell
# 1. Typecheck and build frontend distribution
npm run build

# 2. Build standalone release binary
npx tauri build --no-bundle
```

The resulting executable is located at:
```
target/release/holodori-live2d-manager.exe
```

---

## 5. Running Automated Tests

### Rust Backend Tests (84 Tests)
```powershell
# Run all unit and integration tests
cargo test --workspace -- --test-threads=1

# Run Clippy static analysis
cargo clippy --workspace --all-targets -- -D warnings
```

### Frontend Unit Tests (17 Tests)
```powershell
npm run test:unit
```

### Browser WebGL Runtime Acceptance Tests (14 Tests)
Requires Edge/Chrome with WebGL support and local packages:
```powershell
npm run test:runtime
```

### Full Win32 Live Wallpaper Acceptance Suite (11 Gates)
Executes all native WorkerW, Progman, 20-cycle stress, and watchdog tests against your live Windows desktop:
```powershell
cargo run --release --example verify_wallpaper_live
```
