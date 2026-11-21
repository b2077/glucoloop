# GlucoLoop — one-command deployment
#
# Usage:
#   make up          Start ML + backend (the two services everything needs)
#   make demo        Start everything + stream simulator data (accel=60)
#   make stream      Just the simulator stream (assumes backend is up)
#   make dashboard   Open the ops dashboard in the browser
#   make app         Open the web app (mobile backup) in the browser
#   make test        Run backend unit tests
#   make e2e         Run the full end-to-end integration test
#   make down        Stop all GlucoLoop processes
#   make status      Show what's running
#   make clean       Stop + remove logs

# ---- Config (override on CLI: make demo ACCEL=3600) ----
PORT_BACKEND ?= 8100
PORT_ML      ?= 8101
ML_URL       ?= http://localhost:$(PORT_ML)
BACKEND_URL  ?= http://localhost:$(PORT_BACKEND)
PATIENT      ?= demo-001
ACCEL        ?= 60
DURATION     ?= 2880
BROWSER      ?= open   # use 'xdg-open' on Linux

ML_DIR    := services/ml
BE_DIR    := services/backend
SIM_DIR   := services/simulator
LOG_DIR   := .logs

.PHONY: up down demo stream dashboard app test e2e status clean ml backend help

# ---- Default ----
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ---- Start services ----
up: ml backend ## Start ML service + backend
	@echo ""
	@echo "  ✅ ML      → $(ML_URL)/health"
	@echo "  ✅ Backend → $(BACKEND_URL)/health"
	@echo "  🖥️  Dashboard → $(BACKEND_URL)/dashboard"
	@echo "  📱 Web app   → $(BACKEND_URL)/app"
	@echo "  ▶  Next: make demo   (stream data)"

ml: ## Start ML prediction service
	@mkdir -p $(LOG_DIR)
	@cd $(ML_DIR) && PORT=$(PORT_ML) nohup python3 predict_api.py > ../../$(LOG_DIR)/ml.log 2>&1 &
	@echo "  ML starting on :$(PORT_ML) (log: $(LOG_DIR)/ml.log)"
	@sleep 2

backend: ## Start backend (depends on nothing; ML optional)
	@mkdir -p $(LOG_DIR)
	@cd $(BE_DIR) && PORT=$(PORT_BACKEND) ML_URL=$(ML_URL) nohup node src/server.js > ../../$(LOG_DIR)/backend.log 2>&1 &
	@echo "  Backend starting on :$(PORT_BACKEND) (log: $(LOG_DIR)/backend.log)"
	@sleep 1

stream: ## Stream simulator data into the backend
	@cd $(SIM_DIR) && python3 live_stream.py --backend $(BACKEND_URL) --patient $(PATIENT) --accel $(ACCEL) --duration $(DURATION)

demo: up ## Start everything + stream simulator data, then open dashboard
	@$(MAKE) --no-print-directory stream ACCEL=$(ACCEL) PATIENT=$(PATIENT) &
	@sleep 3
	@$(BROWSER) $(BACKEND_URL)/dashboard 2>/dev/null || echo "  Open $(BACKEND_URL)/dashboard"

# ---- Open UIs ----
dashboard: ## Open ops dashboard in browser
	@$(BROWSER) $(BACKEND_URL)/dashboard 2>/dev/null || echo "  Open $(BACKEND_URL)/dashboard"

app: ## Open web app (mobile backup) in browser
	@$(BROWSER) $(BACKEND_URL)/app 2>/dev/null || echo "  Open $(BACKEND_URL)/app"

# ---- Tests ----
test: ## Run backend unit + integration tests
	@cd $(BE_DIR) && node --test

e2e: ## Run e2e pipeline test if scripts/e2e.mjs exists (from PR #4)
	@if [ -f scripts/e2e.mjs ]; then node scripts/e2e.mjs; else echo "  scripts/e2e.mjs not on this branch — skipped"; fi

test-sim: ## Run simulator tests
	@cd $(SIM_DIR) && python3 -m pytest -q

# ---- Status / teardown ----
status: ## Show running GlucoLoop processes and health
	@echo "  Processes:"
	@pgrep -af "predict_api.py|node src/server.js|live_stream.py" || echo "    (none running)"
	@echo ""
	@echo "  Health checks:"
	@curl -s $(ML_URL)/health 2>/dev/null | head -c 120 && echo " ← ML" || echo "  ML: down"
	@curl -s $(BACKEND_URL)/health 2>/dev/null | head -c 120 && echo " ← Backend" || echo "  Backend: down"

down: ## Stop all GlucoLoop processes
	@pkill -f "predict_api.py" 2>/dev/null || true; pkill -f "node src/server.js" 2>/dev/null || true; pkill -f "live_stream.py" 2>/dev/null || true
	@echo "  Stopped ML, backend, simulator."

clean: down ## Stop everything and remove logs
	@rm -rf $(LOG_DIR)
	@echo "  Logs cleaned."
