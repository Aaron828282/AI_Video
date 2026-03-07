# AI Analysis Setup

## Environment

1. Copy `server/.env.example` to `server/.env`.
2. Set `CLAUDE_AUTH_TOKEN` in `server/.env` (or `ANTHROPIC_AUTH_TOKEN` as compatibility alias).
3. Optional: set `CLAUDE_BASE_URL` (or `ANTHROPIC_BASE_URL`) for custom gateway endpoint.
4. Optional: if your gateway requires a fixed `x-api-key` (for example `fox`), set `CLAUDE_PRIMARY_API_KEY` (or `ANTHROPIC_PRIMARY_API_KEY`).
5. Optional: set `ANALYSIS_CONCURRENCY` (default `4`) to control parallel AI analysis jobs.
6. Restart backend service.

## Behavior

- If `CLAUDE_AUTH_TOKEN` and `ANTHROPIC_AUTH_TOKEN` are both missing, calling `POST /api/products/:recordId/analyze` returns `503`.
- White-background image files are written to `server/data/analysis-images`.
- Public white-image URL uses `PUBLIC_API_BASE_URL` if configured.
