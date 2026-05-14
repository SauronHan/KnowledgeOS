# AGENTS.md

## Architecture

Monorepo with 4 independent packages (no workspace manager):

| Directory | Stack | Purpose |
|-----------|-------|---------|
| `server/` | Python 3.12, FastAPI, Celery, SQLAlchemy, LanceDB | Core API + async task workers |
| `client/` | Tauri v2, React 19, Vite 8, TypeScript, Tailwind 4 | Desktop app (macOS/Windows) |
| `server/admin-web/` | React 19, Vite, TypeScript | Admin dashboard SPA (served by FastAPI at `/admin`) |
| `website/` | React, Vite, Nginx | Marketing site with license backend |

## Server (Python backend)

### Layout
- `server/app/main.py` — FastAPI entrypoint, mounts all routers under `/api/v1/`
- `server/app/routers/` — REST endpoints (auth, ingest, audit, query, chat, graph, projects, etc.)
- `server/app/tasks.py` — Celery tasks dispatched by ingestion (Graphify + Wiki engine)
- `server/core/wiki_engine/` — 2-step Chain-of-Thought knowledge extraction via LLM
- `server/graphify/` — Static code/AST analysis engine (Tree-sitter based)
- `server/core/advanced_skills/parsers.py` — Office doc parsing (pdf, docx, pptx, xlsx)
- `server/data/models_config.yaml` — Runtime LLM model routing config (LiteLLM format)

### Commands
```bash
# Start all services (from server/)
docker compose up --build -d

# Initialize DB (destructive — drops all tables, first run only)
docker exec -it kos_api python init_db.py

# Restart after .env or models_config.yaml change (no rebuild needed)
docker compose restart api worker

# View worker logs
docker logs -f kos_celery_worker

# Reset vector DB
rm -rf server/data/lancedb/* && docker compose restart api
```

### Key details
- Docker exposes API on **port 8080** (maps to internal 8000)
- Redis exposed on **port 6380** (not default 6379)
- Celery broker + backend both use Redis; worker command: `celery -A app.tasks worker`
- DB migrations are manual (`migrate_db.py`, `migrate_visibility.sql`) — no Alembic
- `init_db.py` creates default users: `admin:1Qaz2Wsx` and `system-admin:SystemPass123!`
- Embedding model `all-MiniLM-L6-v2` is pre-downloaded in Docker image
- `server/.env` is gitignored; copy from `.env.example`

## Client (Tauri desktop app)

### Commands
```bash
# Dev (from client/)
npm install
npm run tauri dev       # launches Tauri + Vite dev server on :1420

# Typecheck only
npm run typecheck       # tsc --build

# Build (includes typecheck)
npm run build           # typecheck + vite build

# Tests — two tiers
npm run test:mocks      # unit tests (no network, fast)
npm run test:llm        # real LLM integration tests (serial, needs API keys)
npm test                # runs both sequentially
```

### Testing details
- Framework: Vitest 4
- Real-LLM tests (files matching `*.real-llm.test.ts`) require API keys in `client/.env.test.local`
- Property-based tests use `fast-check` (files matching `*.property.test.ts`)
- Test env setup: `src/test-helpers/load-test-env.ts` — hand-rolled dotenv loader (no `dotenv` dep)
- `npm run test:llm` runs with `--no-file-parallelism` to avoid rate limits

### Build details
- Vite defines `__APP_VERSION__` from package.json at build time
- Path alias: `@` → `./src`
- Tauri `beforeBuildCommand` uses `npm run build:ci` (skips typecheck for CI speed)
- Version is synced between `package.json` and `src-tauri/tauri.conf.json`

## Admin Web

```bash
# From server/admin-web/
npm run dev             # Vite dev server
npm run build           # tsc + vite build → dist/ served by FastAPI
npm run lint            # eslint
```

The built `dist/` is mounted by FastAPI at `/admin` — no separate deploy needed.

## Multi-tenant model

- Three-level hierarchy: Tenant → User → Project
- User roles: `system`, `admin`, `maker`, `checker`, `employee`
- Projects have `visibility`: `shared` (tenant-wide read) or private (owner-only)
- Data isolation is per-project (LanceDB vector stores, documents, graph nodes)
- Shared projects are read-only for non-system users

## CI

- GitHub Actions workflow `.github/workflows/build-client.yml` — builds Tauri on macOS + Windows on push/PR to `client/`
- Node 22, Rust stable
- No server CI exists

## Conventions

- Primary language in code comments and docs: Chinese (Simplified)
- API routes all prefixed `/api/v1/`
- SSE streaming for real-time task status via Redis pub/sub
- LLM routing through LiteLLM — model names use `provider/model` format in `models_config.yaml`
- No linter/formatter enforced on the Python side; client has ESLint (admin-web only)
