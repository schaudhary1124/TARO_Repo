#!/usr/bin/env bash
set -e

# --- CONFIG ---

PG_CONTAINER="postgres"
PG_IMAGE="postgis/postgis:15-3.4"
PG_USER="postgis"
PG_PASS="pass"
PG_DB="tourism_db"
PG_PORT="5432"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_PORT="5173"

# --- FUNCTIONS ---

function header() {
echo ""
echo "==============================="
echo "$1"
echo "==============================="
}

# --- POSTGRES / POSTGIS SETUP ---

header "Checking PostGIS Docker container"
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
if docker ps -a --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
echo "Existing container found. Starting..."
docker start "${PG_CONTAINER}"
else
echo "Creating new PostGIS container..."
docker run --platform linux/amd64 --name "${PG_CONTAINER}" 
-e POSTGRES_USER="${PG_USER}" 
-e POSTGRES_PASSWORD="${PG_PASS}" 
-e POSTGRES_DB="${PG_DB}" 
-p ${PG_PORT}:5432 -d "${PG_IMAGE}"
fi
else
echo "PostGIS container already running."
fi

# --- PYTHON BACKEND SETUP ---

header "Setting up Python backend"

if [ ! -d ".venv" ]; then
echo "Creating virtual environment..."
python3.12 -m venv .venv
fi

source .venv/bin/activate

echo "Installing Python dependencies..."
pip install -r requirements.txt -q
pip install geopandas pyogrio fastapi uvicorn requests databases aiosqlite -q

echo "Loading data... (temporarily disabled to avoid long startup)"
# Temporarily skip the heavy data load during development startup to avoid long Uvicorn hangs.
# To re-enable data loading, uncomment the following line.
python load_data.py || echo "Skipping data load if already loaded."

# --- FRONTEND SETUP ---

header "Setting up frontend"

cd frontend
if [ ! -d "node_modules" ]; then
echo "Installing Node dependencies..."
npm install
fi
cd ..

# --- RUN SERVERS ---

header "Starting backend and frontend servers"

# Kill any previous processes on same ports

lsof -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null || true
lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true

# Start backend

source .venv/bin/activate
uvicorn main:app --host ${BACKEND_HOST} --port ${BACKEND_PORT} &

# Start frontend

cd frontend
npm run dev -- --port ${FRONTEND_PORT} &
cd ..

sleep 3
header "✅ All systems running"
echo "Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "Frontend: [http://localhost:${FRONTEND_PORT}](http://localhost:${FRONTEND_PORT})"
echo ""
echo "To stop everything: pkill -f uvicorn && pkill -f vite"
