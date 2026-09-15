# Mimora Phase 2 Windows Packaging

## Packaging Target

Mimora Phase 2 ships as a Windows NSIS installer.

- Artifact: `release/Mimora-0.2.0-Setup.exe`
- Architecture: Windows x64
- Installer mode: per-user install, configurable install directory
- Electron output: `dist/`, `dist-electron/`
- Python worker resource: `resources/python/mimora_worker.py`
- Runtime data: Windows user data directory managed by Electron

## Distribution Boundary

Mimora installer includes:

- Electron application
- React renderer bundle
- Electron main/preload bundle
- Python worker source
- Python dependency manifest: `python/requirements.txt`

Mimora installer does not include:

- Ollama
- Local chat model, for example `qwen3:4b-instruct`
- Local embedding model, `bge-m3`
- GPU drivers
- User vaults, RAG data, schedule files, or generated reports

## Python Runtime Strategy

Production builds must use a bundled Python runtime. System Python is only a
development fallback and is not a product prerequisite.

The application resolves Python runtime candidates in this order:

1. `MIMORA_PYTHON_PATH`
2. Packaged resource: `<app resources>\python\python.exe`
3. Dev bundled paths:
   - `resources/python/python.exe`
   - `runtime/python/python.exe`
   - `buildResources/python/python.exe`
4. Dev fallback:
   - Windows: `py -3`, `python`
   - macOS/Linux: `python3`, `python`

If no candidate is available, Mimora reports `runtime_not_found` and shows:

```text
Mimora Python runtime을 찾을 수 없습니다.
```

The bundled runtime must include these packages:

```text
faiss-cpu
numpy
openpyxl
pymupdf
pypdf
python-docx
```

Development-only verification can use:

```powershell
$env:MIMORA_PYTHON_PATH = "C:\path\to\python.exe"
npm run build
```

Packaging TODO:

- Add the actual Windows Python runtime under `buildResources/python/` or
  another resolver-supported bundled path before creating a production
  installer.
- Include the bundled runtime directory in Electron `extraResources` so the
  packaged app contains `<resources>\python\python.exe`.
- Keep `mimora_worker.py` and `requirements.txt` in the packaged Python
  resource directory.
- Do not require users to install system Python.

## Ollama And Model Strategy

Ollama and models remain external prerequisites.

Recommended setup:

```powershell
ollama pull qwen3:4b-instruct
ollama pull bge-m3
ollama list
```

Mimora expects Ollama at:

```text
http://127.0.0.1:11434
```

The app should verify these items after installation:

- Ollama is reachable
- Chat model is installed
- `bge-m3` is installed
- RAG embedding check succeeds

## Build Commands

From the repository root:

```powershell
npm ci
npm run build
npm run package:win
```

Before packaging, verify that the repository is clean or that the pending changes are intentionally part of the release.

## New PC Verification Checklist

- Install Mimora with `Mimora-0.2.0-Setup.exe`.
- Launch Mimora from the Start menu or desktop shortcut.
- Confirm Settings opens without errors.
- Confirm Python status is available.
- Install Python packages from `resources/python/requirements.txt` if Python status or RAG runtime checks fail.
- Install and start Ollama.
- Pull `qwen3:4b-instruct`.
- Pull `bge-m3`.
- Confirm `ollama list` shows both models.
- Configure Local AI endpoint as `http://127.0.0.1:11434`.
- Test Local AI connection.
- Register Registry Home Vault.
- Confirm Workspace Registry, Knowledge Domain Registry, and Knowledge Type Registry are normal.
- Open Vault Browser and confirm documents are visible.
- Open RAG 문서 and import a `.pdf`, `.docx`, `.md`, or `.txt` file.
- Reindex the imported RAG document.
- Run RAG Search Test and confirm sources are returned.
- Register a Workspace schedule `.xlsx` or `.xlsm` file.
- Refresh Schedule Intelligence and confirm WBS, leaf task, delay, and progress metrics.
- Ask a Workspace Chat question that uses Vault context.
- Ask a Workspace Chat question that uses RAG context.
- Ask a Workspace Chat question that uses Schedule context.
- Generate an AI Wiki draft and confirm frontmatter metadata is written correctly.
- Generate a weekly report DOCX and open the result.
- Restart Mimora and confirm settings, chat history, RAG library, and schedule registration persist.

## Release Notes

Phase 2 final packaging separates runtime responsibilities:

- Mimora owns the desktop app and Python worker.
- Python owns local document parsing, FAISS indexing, Excel parsing, and DOCX report rendering.
- Ollama owns local model serving.
- Models remain outside the installer because they are large and hardware-dependent.
