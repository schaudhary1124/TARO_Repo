import asyncio
import sys

# Ensure project root is on sys.path so imports work when running the script
from pathlib import Path
proj_root = Path(__file__).resolve().parents[1]
if str(proj_root) not in sys.path:
    sys.path.insert(0, str(proj_root))

from app.core import database
from sqlalchemy import text

async def main():
    print(f"Using DATABASE_URL={database.DATABASE_URL}")
    try:
        async with database.async_engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            val = result.scalar()
            print("Query result:", val)
    except Exception as e:
        print("Connection or query failed:", repr(e))

if __name__ == '__main__':
    asyncio.run(main())
