# Contributing to Crawlix

Thank you for your interest in contributing! Here's how to get started.

---

## Development Setup

```bash
git clone https://github.com/Tejas3479/crawlix.git
cd crawlix

python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/Mac

pip install -r requirements.txt
playwright install chromium

# Run with SSRF disabled for local testing
$env:DISABLE_SSRF_CHECK = "true"
$env:API_KEYS = "devkey"
uvicorn app:app --reload

# (In a separate terminal) Start Redis and the background worker:
arq worker.WorkerSettings
```

---

## Project Structure

```
crawlix/
├── app.py              # FastAPI lifespan and server setup
├── database.py         # SQLAlchemy models (Postgres/SQLite)
├── models.py           # Pydantic validation schemas
├── worker.py           # ARQ background worker for crawls
├── routers/            # API endpoints (/fetch, /api/crawl, etc.)
├── services/           # Core fetch engine logic
├── requirements.txt    # Python dependencies
├── Dockerfile          # Container build
├── docker-compose.yml  # Local stack
├── verify.py           # Integrity check script
├── static/
│   ├── index.html      # Dashboard HTML
│   ├── style.css       # Dashboard styles
│   └── app.js          # Dashboard logic
└── docs/
    ├── API.md          # Full API reference
    └── SELF_HOSTING.md # Deployment guide
```

---

## Code Style

- **Python**: Follow PEP 8. Use `async/await` for all I/O. No blocking calls in async context.
- **JavaScript**: Vanilla ES2022+. No frameworks. Keep functions small and focused.
- **CSS**: CSS variables for all colors/spacing. No inline styles in HTML (except dynamic values).

---

## Pull Request Guidelines

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Keep commits atomic — one logical change per commit
3. Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
4. Test your change manually before submitting
5. Update `CHANGELOG.md` under `[Unreleased]`
6. Open a PR with a clear description of what and why

---

## Reporting Issues

Please include:
- OS and Python version
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs (from `docker logs crawlix_server` or terminal output)
