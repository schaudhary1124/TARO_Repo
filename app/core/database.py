#

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base
from typing import AsyncGenerator
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

# Use SQLite file set by load_data.py / environment
SQLITE_FILE = os.getenv('SQLITE_FILE', 'data.sqlite')

# Resolve to an absolute path so the engine can find the file in Docker or locally
db_path = Path(SQLITE_FILE)
if not db_path.is_absolute():
    db_path = Path.cwd() / db_path

# Async SQLite (aiosqlite) URL
DATABASE_URL = f"sqlite+aiosqlite:///{db_path}"

# --- Setup ---
async_engine = create_async_engine(
    DATABASE_URL,
    echo=os.getenv('DB_ECHO', 'False').lower() == 'true',
    connect_args={"check_same_thread": False},
)

Base = declarative_base()


# --- Dependency Injection ---
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Provides a database session for FastAPI endpoints.

    Uses an async SQLite engine (aiosqlite). Matches `SQLITE_FILE` used by
    `load_data.py` so both data loading and the API hit the same DB file.
    """
    async with AsyncSession(bind=async_engine, expire_on_commit=False) as session:
        yield session