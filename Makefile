.PHONY: help backend frontend install test

PYTHONPATH := $(shell pwd)/backend
BACKEND_DIR := backend
FRONTEND_DIR := frontend
PORT_BACKEND := 8000
PORT_FRONTEND := 5173

# ── Help ──────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

# ── Backend ──────────────────────────────────────────────────────────────────
backend: ## Start backend on :8000 (kills existing)
	@fuser -k $(PORT_BACKEND)/tcp 2>/dev/null || true
	@sleep 2
	@echo "Starting backend on :$(PORT_BACKEND)..."
	PYTHONPATH=$(shell pwd) uv run --directory $(BACKEND_DIR) uvicorn backend.main:app --port $(PORT_BACKEND) --host 0.0.0.0 &> /tmp/backend.log &
	@sleep 4
	@curl -s http://localhost:$(PORT_BACKEND)/health > /dev/null \
		&& echo "Backend healthy on :$(PORT_BACKEND)" \
		|| (echo "Backend NOT responding — see /tmp/backend.log" && tail -20 /tmp/backend.log)

backend-log: ## Tail backend log
	@tail -f /tmp/backend.log

# ── Frontend ─────────────────────────────────────────────────────────────────
frontend: ## Start frontend dev server on :5173
	@cd $(FRONTEND_DIR) && npm run dev

# ── Both ─────────────────────────────────────────────────────────────────────
up: backend frontend ## Start backend and frontend (background backend, foreground frontend)

# ── Seed ──────────────────────────────────────────────────────────────────────
seed: ## Seed demo data (creates OAuth2 + ZKP agents + 4 products)
	@curl -s -X POST http://localhost:$(PORT_BACKEND)/api/demo/seed | \
	  python3 -c "import sys,json; d=json.load(sys.stdin); print('Seeded:', d.get('data', d))"

# ── Tests ─────────────────────────────────────────────────────────────────────
test-backend: ## Run backend tests
	@cd $(BACKEND_DIR) && PYTHONPATH=.. uv run pytest -v

test-frontend: ## Run frontend build/lint
	@cd $(FRONTEND_DIR) && npm run build

# ── Install ──────────────────────────────────────────────────────────────────
install: ## Install frontend dependencies
	@cd $(FRONTEND_DIR) && npm install

# ── Kill ─────────────────────────────────────────────────────────────────────
kill: ## Stop all running servers
	@fuser -k $(PORT_BACKEND)/tcp 2>/dev/null && echo "Backend stopped" || echo "No backend running"
	@pkill -f "vite" 2>/dev/null && echo "Frontend stopped" || echo "No frontend running"