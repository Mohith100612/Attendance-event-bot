#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Face Attendance System — EC2 One-Shot Setup Script (No Domain / IP Only)
# Run this ONCE on a fresh Ubuntu 22.04 or 24.04 EC2 t2.medium instance
# Minimum 20 GB disk space required
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ══════════════════════════════════════════════════════════════════════════════
#  FILL IN THESE VALUES BEFORE RUNNING
# ══════════════════════════════════════════════════════════════════════════════
REPO_URL="https://github.com/Mohith100612/Attendance-event-bot.git"
DB_PASSWORD="FaceAuthDB123"
ADMIN_EMAIL="admin@gmail.com"
ADMIN_PASSWORD="admin@1234"

# Vector search (Pinecone) — leave blank to disable semantic/participants search
PINECONE_API_KEY=""
PINECONE_INDEX="attendees"
PINECONE_CLOUD="aws"
PINECONE_REGION="us-east-1"

# Groq (natural-language query parsing) — leave blank to disable query expansion
GROQ_API_KEY=""
GROQ_MODEL="llama-3.1-8b-instant"
# ══════════════════════════════════════════════════════════════════════════════

APP_DIR="/opt/face_auth"
WORK_DIR="$APP_DIR"
SECRET_KEY=$(openssl rand -hex 32)

# Detect public IP automatically
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)
echo "Detected public IP: $PUBLIC_IP"

echo "=============================="
echo " Face Auth EC2 Setup Starting"
echo "=============================="

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/7] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-venv python3-pip \
    nginx postgresql postgresql-contrib git \
    libgl1 libglib2.0-0 libpq-dev build-essential \
    openssl

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null
sudo apt-get install -y nodejs

# ── 2. Clone repo ─────────────────────────────────────────────────────────────
echo "[2/7] Cloning repository..."
sudo rm -rf "$APP_DIR"
sudo git clone "$REPO_URL" "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"

# ── 3. PostgreSQL ─────────────────────────────────────────────────────────────
echo "[3/7] Setting up PostgreSQL..."
sudo systemctl start postgresql
sudo systemctl enable postgresql
sudo -u postgres psql -c "DROP DATABASE IF EXISTS face_auth;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS face_auth_user;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER face_auth_user WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE face_auth OWNER face_auth_user;"

# Detect the actual port the apt-installed cluster is bound to (defaults to
# 5432, but moves to 5433+ if another postgres — e.g. a Docker container —
# already holds 5432). Without this, the app's DATABASE_URL would hit the
# wrong server and fail with "password authentication failed".
PG_PORT=$(pg_lsclusters --no-header 2>/dev/null | awk '$4=="online"{print $3; exit}')
PG_PORT=${PG_PORT:-5432}
echo "  PostgreSQL bound to port: $PG_PORT"

# ── 4. Python backend ─────────────────────────────────────────────────────────
echo "[4/7] Installing Python backend (this takes a few minutes)..."
cd "$WORK_DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
deactivate

# ── 5. Environment file ───────────────────────────────────────────────────────
echo "[5/7] Writing .env..."
cat > "$WORK_DIR/backend/.env" << EOF
DATABASE_URL=postgresql://face_auth_user:${DB_PASSWORD}@localhost:${PG_PORT}/face_auth
SECRET_KEY=${SECRET_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALLOW_ORIGINS=http://${PUBLIC_IP}
APP_BASE_URL=http://${PUBLIC_IP}
CONFIDENCE_THRESHOLD=0.55
MATCH_THRESHOLD=0.72
LIVENESS_CHECK=False

# Vector search (Pinecone)
PINECONE_API_KEY=${PINECONE_API_KEY}
PINECONE_INDEX=${PINECONE_INDEX}
PINECONE_CLOUD=${PINECONE_CLOUD}
PINECONE_REGION=${PINECONE_REGION}

# Groq query parsing
GROQ_API_KEY=${GROQ_API_KEY}
GROQ_MODEL=${GROQ_MODEL}
EOF
chmod 600 "$WORK_DIR/backend/.env"

# ── 6. Frontend build ─────────────────────────────────────────────────────────
echo "[6/7] Building frontend..."
cd "$WORK_DIR/frontend"
npm install --silent

# Point frontend API calls at the public IP
echo "VITE_API_URL=http://${PUBLIC_IP}" > .env.production

npm run build

# ── 7. systemd service + Nginx ────────────────────────────────────────────────
echo "[7/7] Creating systemd service and configuring Nginx..."
sudo tee /etc/systemd/system/face-auth.service > /dev/null << EOF
[Unit]
Description=Face Auth FastAPI Backend
After=network.target postgresql.service

[Service]
User=${USER}
WorkingDirectory=${WORK_DIR}/backend
EnvironmentFile=${WORK_DIR}/backend/.env
ExecStart=${WORK_DIR}/backend/venv/bin/gunicorn \
    main:app \
    --workers 2 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 127.0.0.1:8000 \
    --timeout 120
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable face-auth
sudo systemctl start face-auth

# Nginx — serve frontend on port 80, proxy /api to backend on 8000
sudo tee /etc/nginx/sites-available/face-auth > /dev/null << EOF
server {
    listen 80;
    server_name _;

    root ${WORK_DIR}/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 120s;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8000;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    client_max_body_size 10M;
}
EOF

sudo ln -sf /etc/nginx/sites-available/face-auth /etc/nginx/sites-enabled/face-auth
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Setup complete!"
echo "════════════════════════════════════════"
echo " App URL  : http://${PUBLIC_IP}"
echo " Health   : curl http://localhost:8000/health"
echo " Logs     : sudo journalctl -u face-auth -f"
echo " Nginx log: sudo tail -f /var/log/nginx/error.log"
echo ""
echo " NOTE: Open port 80 in your EC2 Security Group"
echo "       (Inbound rule: HTTP / port 80 / 0.0.0.0/0)"
echo "════════════════════════════════════════"
