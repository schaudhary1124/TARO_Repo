import sqlite3
from pathlib import Path
import logging
import os


def ensure_columns_exist(db_path: str):
    """Check if 'website_url' and 'category' columns exist in attractions table and add them if missing.
    This function does NOT run automatically; call it manually after backing up the DB.
    Returns a dict with the actions taken.
    """
    p = Path(db_path)
    if not p.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(p))
    try:
        cols_info = conn.execute("PRAGMA table_info(attractions)").fetchall()
        existing = {c[1] for c in cols_info}
        actions = []
        if 'website_url' not in existing:
            conn.execute("ALTER TABLE attractions ADD COLUMN website_url TEXT")
            actions.append('added website_url')
        if 'category' not in existing:
            conn.execute("ALTER TABLE attractions ADD COLUMN category TEXT")
            actions.append('added category')
        conn.commit()
        return { 'actions': actions }
    except Exception:
        logging.getLogger('app.maintenance').exception('ensure_columns_exist failed')
        raise
    finally:
        conn.close()


def backfill_categories(db_path: str):
    """Populate the `category` column using simple heuristics based on existing columns.
    This will only set category where it is NULL.
    Returns a dict with counts of rows updated per category.
    """
    p = Path(db_path)
    if not p.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    # Ensure category column exists
    ensure_columns_exist(db_path)
    conn = sqlite3.connect(str(p))
    try:
        cur = conn.cursor()
        cols = [c[1] for c in cur.execute("PRAGMA table_info(attractions)").fetchall()]
        if 'category' not in cols:
            return {'error': 'category column missing after ensure_columns_exist'}

        updates = {}

        # Priority order updates. Each update only affects rows where category is NULL or empty.
        stmts = [
            ("Museum", "UPDATE attractions SET category = 'Museum' WHERE (category IS NULL OR category = '') AND (tourism='museum' OR (museum IS NOT NULL AND museum != ''))"),
            ("Amusement Park", "UPDATE attractions SET category = 'Amusement Park' WHERE (category IS NULL OR category = '') AND (tourism IN ('theme_park','amusement_park') OR (roller_coaster IS NOT NULL AND roller_coaster != ''))"),
            ("Historical Site", "UPDATE attractions SET category = 'Historical Site' WHERE (category IS NULL OR category = '') AND ((historic IS NOT NULL AND historic != '') OR (heritage IS NOT NULL AND heritage != ''))"),
            ("Dog Park", "UPDATE attractions SET category = 'Dog Park' WHERE (category IS NULL OR category = '') AND (leisure='dog_park')"),
            ("Zoo/Aquarium", "UPDATE attractions SET category = 'Zoo/Aquarium' WHERE (category IS NULL OR category = '') AND (tourism='zoo' OR (zoo IS NOT NULL AND zoo != ''))"),
            ("Park/Garden", "UPDATE attractions SET category = 'Park/Garden' WHERE (category IS NULL OR category = '') AND ((leisure='park' OR leisure='garden') OR (amenity='fountain'))"),
            ("General Attraction", "UPDATE attractions SET category = 'General Attraction' WHERE (category IS NULL OR category = '') AND (tourism='attraction')"),
            # Final catch-all: mark remaining nulls as Uncategorized
            ("Uncategorized", "UPDATE attractions SET category = 'Uncategorized' WHERE (category IS NULL OR category = '')"),
        ]

        for label, stmt in stmts:
            try:
                cur.execute(stmt)
                updates[label] = cur.rowcount
            except Exception:
                updates[label] = 0

        conn.commit()
        return updates
    finally:
        conn.close()
