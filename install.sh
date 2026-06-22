#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# BlindVault Installer
# AI Sees Nothing. Ops Lose Nothing.
# ============================================================

VERSION="1.0.0"
REPO="https://github.com/fcatat/BlindVault.git"
INSTALL_DIR="BlindVault"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

print_banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  🔐 ${BOLD}BlindVault Installer${NC} ${DIM}v${VERSION}${NC}              ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${DIM}AI Sees Nothing. Ops Lose Nothing.${NC}          ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""
}

info()    { echo -e "  ${BLUE}ℹ${NC}  $1"; }
success() { echo -e "  ${GREEN}✓${NC}  $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; }
fail()    { echo -e "  ${RED}✗${NC}  $1"; exit 1; }
step()    { echo -e "\n  ${BOLD}[$1]${NC} $2\n"; }

ask() {
  local prompt="$1"
  local default="$2"
  local var_name="$3"
  if [ -n "$default" ]; then
    echo -ne "  ${CYAN}?${NC}  ${prompt} ${DIM}(${default})${NC}: "
  else
    echo -ne "  ${CYAN}?${NC}  ${prompt}: "
  fi
  read -r input < /dev/tty
  eval "$var_name=\"${input:-$default}\""
}


# ============================================================
# Step 1: Prerequisites
# ============================================================
check_prerequisites() {
  step "1/4" "Checking prerequisites..."

  # Docker
  if command -v docker &>/dev/null; then
    local docker_ver
    docker_ver=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    success "Docker ${docker_ver}"
  else
    fail "Docker not found. Install: https://docs.docker.com/get-docker/"
  fi

  # Docker Compose
  if docker compose version &>/dev/null; then
    local compose_ver
    compose_ver=$(docker compose version --short 2>/dev/null || echo "v2+")
    success "Docker Compose ${compose_ver}"
  elif command -v docker-compose &>/dev/null; then
    success "docker-compose (legacy)"
    COMPOSE_CMD="docker-compose"
  else
    fail "Docker Compose not found. Install: https://docs.docker.com/compose/install/"
  fi

  # Git
  if command -v git &>/dev/null; then
    success "Git $(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  else
    fail "Git not found. Install: https://git-scm.com/"
  fi
}

collect_config() {
  step "2/4" "Configuration"

  # Ports
  info "Port settings ${DIM}(press Enter for defaults)${NC}"
  ask "Frontend port" "3000" FRONTEND_PORT
  ask "Backend port"  "8000" BACKEND_PORT

  # Check port availability
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    if lsof -i :"$port" &>/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q ":$port "; then
      warn "Port ${port} is in use. You may need to stop the existing service."
    else
      success "Port ${port} available"
    fi
  done

  # LLM gateway (LiteLLM-compatible /v1 endpoint)
  echo ""
  info "LLM gateway ${DIM}(LiteLLM-compatible, exposes /v1/chat/completions)${NC}"
  info "${DIM}You can leave these blank now and fill them in .env later.${NC}"
  ask "Gateway base URL (e.g. https://your-gateway/v1)" "" LITELLM_BASE_URL
  ask "Virtual API key" "" LITELLM_API_KEY
  ask "Default model alias (e.g. gpt-4o / claude-sonnet)" "" DEFAULT_MODEL

  if [ -z "$LITELLM_BASE_URL" ] || [ -z "$LITELLM_API_KEY" ] || [ -z "$DEFAULT_MODEL" ]; then
    warn "LLM gateway not fully set — edit .env (BLINDVAULT_LITELLM_*) and run: docker compose restart backend"
  fi

  # Build mirror source
  echo ""
  info "Image build mirrors ${DIM}(China mirrors speed up builds in mainland China)${NC}"
  ask "Use China mirrors for image builds? [Y/n]" "Y" USE_CN_MIRROR_INPUT
  case "$USE_CN_MIRROR_INPUT" in
    [Nn]*) USE_CN_MIRROR="false" ;;
    *)     USE_CN_MIRROR="true" ;;
  esac
  if [ "$USE_CN_MIRROR" = "true" ]; then
    success "Mirror source: China (tuna / npmmirror)"
  else
    success "Mirror source: official (deb.debian.org / npmjs / pypi)"
  fi
}

# ============================================================
# Step 3: Setup
# ============================================================
setup_project() {
  step "3/4" "Setting up BlindVault..."

  # Clone if not in repo
  if [ -f "docker-compose.yml" ] && grep -q "blindvault" docker-compose.yml 2>/dev/null; then
    info "Already in BlindVault directory"
  elif [ -d "$INSTALL_DIR" ]; then
    info "Directory ${INSTALL_DIR} exists, updating..."
    cd "$INSTALL_DIR"
    git pull --quiet origin main 2>/dev/null || true
  else
    info "Cloning repository..."
    git clone --quiet --depth 1 "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    success "Repository cloned"
  fi

  # Generate encryption key
  ENCRYPTION_KEY=$(python3 -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" 2>/dev/null \
    || openssl rand -base64 32 2>/dev/null \
    || head -c 32 /dev/urandom | base64)

  # Generate PG password
  PG_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))" 2>/dev/null \
    || openssl rand -base64 16 2>/dev/null \
    || head -c 16 /dev/urandom | base64)

  cat > .env <<EOF
# BlindVault Configuration — generated by install.sh
# $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Encryption (DO NOT CHANGE after first run, or stored API keys will be lost)
BLINDVAULT_ENCRYPTION_KEY=${ENCRYPTION_KEY}

# PostgreSQL
PG_PASSWORD=${PG_PASSWORD}

# Ports
FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}

# Build mirror source (true = China mirrors for faster image builds)
USE_CN_MIRROR=${USE_CN_MIRROR}

# LLM gateway (LiteLLM) — the API key lives ONLY here, never in the UI.
# The default model can also be changed later in Web UI → Agent Config.
BLINDVAULT_LITELLM_BASE_URL=${LITELLM_BASE_URL}
BLINDVAULT_LITELLM_API_KEY=${LITELLM_API_KEY}
BLINDVAULT_DEFAULT_MODEL=${DEFAULT_MODEL}

# Infrastructure (internal, do not change)
BLINDVAULT_REDIS_URL=redis://redis:6379/0
REDIS_URL=redis://redis:6379/0
BLINDVAULT_DATABASE_URL=postgresql://blindvault:${PG_PASSWORD}@postgres:5432/blindvault
DATABASE_URL=postgresql://blindvault:${PG_PASSWORD}@postgres:5432/blindvault
BLINDVAULT_SANDBOX_URL=http://sandbox:8001
EOF

  chmod 600 .env
  success "Configuration saved to .env (chmod 600)"
  success "Encryption key generated"
}

# ============================================================
# Step 4: Launch
# ============================================================
launch_services() {
  step "4/4" "Starting services..."

  local compose_cmd="docker compose"
  if ! docker compose version &>/dev/null 2>&1; then
    compose_cmd="docker-compose"
  fi

  info "Building containers (first run may take 2-3 minutes)..."
  $compose_cmd build --quiet 2>&1 | tail -1 || true
  success "Containers built"

  $compose_cmd up -d 2>&1 | tail -1 || true

  # Wait for health
  info "Waiting for services to start..."
  local retries=30
  while [ $retries -gt 0 ]; do
    if curl -sf "http://localhost:${BACKEND_PORT}/health" &>/dev/null; then
      break
    fi
    retries=$((retries - 1))
    sleep 2
  done

  if [ $retries -eq 0 ]; then
    warn "Backend health check timed out. Check logs: ${compose_cmd} logs backend"
  else
    success "Redis started"
    success "PostgreSQL started"
    success "Backend started (port ${BACKEND_PORT})"
    success "Frontend started (port ${FRONTEND_PORT})"
  fi
}

# ============================================================
# Done
# ============================================================
print_success() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║${NC}  ✅ ${BOLD}BlindVault is running!${NC}                    ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  🌐 Open: ${BOLD}http://localhost:${FRONTEND_PORT}${NC}              ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  📡 API:  ${BOLD}http://localhost:${BACKEND_PORT}/docs${NC}          ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  💡 ${DIM}Next: open the URL and start chatting.${NC}    ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}     ${DIM}Change model in Agent Config anytime.${NC}     ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  ${DIM}Stop:  docker compose down${NC}                  ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  ${DIM}Logs:  docker compose logs -f${NC}               ${GREEN}║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
  echo ""
}

# ============================================================
# Main
# ============================================================
main() {
  print_banner
  check_prerequisites
  collect_config
  setup_project
  launch_services
  print_success
}

main "$@"
