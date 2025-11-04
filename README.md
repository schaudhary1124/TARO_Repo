# Tourism Data Explorer

This project provides a FastAPI backend connected to a PostGIS/PostgreSQL database and a Vite-based frontend for interactive exploration of tourist attraction data.

---

## 🗄️ Local PostGIS/Postgres Setup (Recommended)

Use the PostGIS image (includes spatial extensions) with a persistent volume:

```bash
# Create and run PostGIS container (creates user 'postgis' and DB 'tourism_db')
docker run --platform linux/amd64 --name postgres \
  -e POSTGRES_USER=postgis \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=tourism_db \
  -p 5432:5432 -d postgis/postgis:15-3.4
```

If you need to recreate from scratch (destructive):

```bash
docker rm -f postgres
# Remove associated volume (replace <volume-name> with actual name from `docker inspect`)
docker volume rm <volume-name>
# Then rerun the container command above
```

**Alternative (no spatial extensions):**

```bash
docker run --platform linux/amd64 --name postgres \
  -e POSTGRES_USER=postgis \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=tourism_db \
  -p 5432:5432 -d postgres:15
```

---

## 🧩 DBeaver Connection Parameters

| Setting  | Value      |
| -------- | ---------- |
| Driver   | PostgreSQL |
| Host     | localhost  |
| Port     | 5432       |
| Database | tourism_db |
| Username | postgis    |
| Password | pass       |

**JDBC URL:**

```
jdbc:postgresql://localhost:5432/tourism_db
```

Click “Test Connection” in DBeaver and allow it to download the PostgreSQL driver if prompted.

**Notes**

* If you started a temporary container on port 5433, update the port and DB name accordingly.
* If you encounter missing role/database errors, recreate the container with the `POSTGRES_USER` and `POSTGRES_DB` env vars.

---

## 🔍 Quick Test (Verify PostGIS)

Run the following to confirm PostGIS is active:

```bash
docker exec -i postgres psql -U postgis -d tourism_db -c "SELECT PostGIS_Version();"
```

---

## ⚙️ Python Backend Setup

1. Navigate to the project root

   ```bash
   cd /path/to/repo
   ```
2. Create and activate a virtual environment

   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies

   ```bash
   pip install -r requirements.txt
   pip install geopandas pyogrio
   ```
4. Verify GeoPandas version

   ```bash
   python -c "import geopandas as gpd; print(gpd.__version__)"
   # Expected: 1.1.1
   ```
5. Load sample data into the database

   ```bash
   python load_data.py
   ```
6. Set environment variable for the SQLite fallback (optional)

   ```bash
   export SQLITE_FILE="$(pwd)/data.sqlite"
   ```
7. Start the backend server

   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```

Expected output:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

Backend API is now live at **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

---

## 💻 Frontend Setup (Vite + Node)

1. In a new terminal window (keep backend running):

   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Wait for output such as:

   ```
   VITE v4.x ready in 600 ms
   ➜  Local:   http://localhost:5173/
   ```
3. Open **[http://localhost:5173/](http://localhost:5173/)** in your browser.

---

## 🌐 Using the Web App

* **Start address** – your starting location
* **End address** – destination
* **Radius (km)** – additional travel distance
* **Limit** – number of tourist attractions to display

The frontend communicates automatically with the FastAPI backend.

---

## 🏗️ Optional: Production Build

```bash
cd frontend
npm run build
```

Serve the built assets in `frontend/dist/` via any static web server or mount in FastAPI.

---

## 🧹 Troubleshooting

* **Backend not responding:** ensure `.venv` is activated and PostGIS container is running.
* **Frontend fails to start:** delete `node_modules` and rerun `npm install`.
* **Port conflicts:**

  ```bash
  uvicorn main:app --port 8001
  npm run dev -- --port 5174
  ```

---

✅ Both backend and frontend running successfully → visit [http://localhost:5173](http://localhost:5173) to explore the web app.
