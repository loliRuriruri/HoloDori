# Contributing to HoloDori Live2D Manager

Thank you for your interest in contributing to **HoloDori Live2D Manager (HDM)**!

---

## 1. Development Principles

1. **Clean-Room Policy**: Under no circumstances should any copyrighted game files, proprietary `.moc3` models, textures, or Live2D Cubism Core binaries be committed or uploaded.
2. **Deterministic & Pure**: The Rust backend must remain completely free of external scripting dependencies (zero Python dependency).
3. **Shell Safety**: Any changes touching Win32 Explorer integration (`WorkerW`, `Progman`, `SHELLDLL_DefView`) must strictly respect the invariant that desktop icons and Windows Explorer are never broken, hidden, or terminated.

---

## 2. Setting Up & Testing

Before submitting a Pull Request, please ensure all checks pass:

```powershell
# 1. Format and Clippy
cargo clippy --workspace --all-targets -- -D warnings

# 2. Rust test suite
cargo test --workspace -- --test-threads=1

# 3. Frontend typecheck and unit tests
npm run build
npm run test:unit
```

---

## 3. Pull Request Guidelines

- Describe the rationale and architectural impact of your changes.
- Ensure new features are covered by automated unit tests.
- Update technical documentation under `docs/` where appropriate.
