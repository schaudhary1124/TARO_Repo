import geopandas as gpd
import sqlite3
import os
import logging
from pathlib import Path
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_representative_point(geom):
    """Safely get a representative point (lat, lon) from a geometry."""
    if geom is None or not geom.is_valid:
        return None, None
    
    try:
        point = geom.representative_point()
        return point.y, point.x  # lat, lon
    except Exception:
        return None, None

def clean_url(u: str) -> str:
    if not u: return None
    u = u.strip()
    if u.startswith('http://'): u = 'https://' + u[len('http://'):]
    return u

def normalize_wikipedia(w):
    if not w: return None
    return w.strip()

def normalize_category(row):
    for key in ('tourism', 'historic', 'leisure', 'amenity', 'category'):
        if key in row and row[key]:
            return str(row[key])
    return None

def load_data(geojson_file='attractions.geojson', db_file='data.sqlite'):
    """Load GeoJSON data into a SQLite database with Geopandas."""
    
    script_dir = Path(__file__).parent.resolve()
    db_path = script_dir / db_file
    geojson_path = script_dir / geojson_file

    if not geojson_path.exists():
        logging.error(f"GeoJSON file not found at: {geojson_path}")
        return

    try:
        logging.info(f"Loading GeoJSON data from {geojson_path}...")
        gdf = gpd.read_file(geojson_path)
        logging.info(f"Loaded {len(gdf)} features.")
        
        # --- Add rating columns ---
        gdf['total_rating'] = 0
        gdf['rating_count'] = 0

        # --- Process Geometries ---
        gdf['wkt'] = gdf['geometry'].apply(lambda x: x.wkt if x and x.is_valid else None)
        lat_lon_pairs = gdf['geometry'].apply(get_representative_point)
        gdf['lat'] = lat_lon_pairs.apply(lambda x: x[0])
        gdf['lon'] = lat_lon_pairs.apply(lambda x: x[1])

        # --- Clean auxiliary fields (website, wikipedia) ---
        if 'website' in gdf.columns:
            gdf['website_url'] = gdf['website'].apply(clean_url)
        elif 'website_url' not in gdf.columns:
            gdf['website_url'] = None

        if 'wikipedia' in gdf.columns:
            gdf['wikipedia'] = gdf['wikipedia'].apply(normalize_wikipedia)

        # Create a single 'category' column if it doesn't exist
        if 'category' not in gdf.columns:
            gdf['category'] = gdf.apply(normalize_category, axis=1)

        # --- Define all columns we care about ---
        # Add common address fields to ensure they are written to DB
        final_columns = [
            'id', 'name', 'lat', 'lon', 'wkt', 
            'website', 'website_url', 'wikipedia', 'tourism', 
            'historic', 'leisure', 'amenity', 'shop', 'sport', 
            'opening_hours', 'category', 'total_rating', 'rating_count',
            # ✅ ADDED ADDRESS FIELDS
            'address', 'addr:street', 'road', 'city', 'town', 'village', 'state', 'country', 'postcode' 
        ]

        # Standardize OpenStreetMap address tags to simpler field names
        # Assuming most OSM data uses addr:street/addr:city, we'll map them
        if 'addr:street' in gdf.columns and 'road' not in gdf.columns:
            gdf['road'] = gdf['addr:street']
        if 'addr:city' in gdf.columns and 'city' not in gdf.columns:
            gdf['city'] = gdf['addr:city']
        if 'addr:postcode' in gdf.columns and 'postcode' not in gdf.columns:
            gdf['postcode'] = gdf['addr:postcode']


        # Filter GeoDataFrame to only include columns that exist
        existing_columns = [col for col in final_columns if col in gdf.columns]
        gdf_filtered = gdf[existing_columns].copy()  # Don't warn about chained assignment

        # Replace string "None" with np.nan for cleaner DB records
        gdf_filtered.replace('None', np.nan, inplace=True)

        # Drop any rows missing id or valid lat/lon
        gdf_filtered.dropna(subset=['id', 'lat', 'lon'], inplace=True)

        # Connect to SQLite
        logging.info(f"Connecting to database: {db_path}")
        conn = sqlite3.connect(db_path)
        
        # Write to SQL
        logging.info("Writing data to 'attractions' table...")
        gdf_filtered.to_sql('attractions', conn, if_exists='replace', index=False, dtype={
            'total_rating': 'INTEGER',
            'rating_count': 'INTEGER',
            'lat': 'REAL',
            'lon': 'REAL',
        })
        
        logging.info(f"Successfully created and populated 'attractions' table with {len(gdf_filtered)} rows.")
        
    except Exception as e:
        logging.error(f"An error occurred during data loading: {e}")
        logging.exception(e)
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            logging.info("Database connection closed.")

if __name__ == "__main__":
    load_data()
