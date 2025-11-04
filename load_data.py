import geopandas as gpd
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from shapely.geometry import shape

load_dotenv()

# Configuration
FILE_NAME = 'attractions.geojson'
SQLITE_FILE = os.getenv('SQLITE_FILE', 'data.sqlite')
TABLE_NAME = os.getenv('SQLITE_TABLE', 'attractions')

def geom_to_wkt(gdf, geom_col='geometry'):
    if geom_col not in gdf.columns:
        raise ValueError('No geometry column found in GeoDataFrame')
    gdf = gdf.copy()
    # store wkt and representative lat/lon (centroid) to avoid native SpatiaLite deps
    def geom_to_wkt_latlon(geom):
        if geom is None:
            return None, None, None
        try:
            wkt = geom.wkt
            # centroid is a safe representative for polygons
            centroid = geom.centroid
            return wkt, centroid.y, centroid.x
        except Exception:
            return None, None, None

    vals = gdf.geometry.apply(geom_to_wkt_latlon).tolist()
    gdf['wkt'] = [v[0] for v in vals]
    gdf['lat'] = [v[1] for v in vals]
    gdf['lon'] = [v[2] for v in vals]
    gdf = gdf.drop(columns=[geom_col])
    return gdf

def main():
    try:
        gdf = gpd.read_file(FILE_NAME)
        print(f"Read {len(gdf)} features from {FILE_NAME}")
    except Exception as e:
        print(f"Failed to read GeoJSON: {e}")
        return

    try:
        df = geom_to_wkt(gdf)
    except Exception as e:
        print(f"Geometry conversion failed: {e}")
        return

    sqlite_url = f'sqlite:///{SQLITE_FILE}'
    engine = create_engine(sqlite_url)

    try:
        df.to_sql(TABLE_NAME, engine, if_exists='replace', index=False)
        print(f"Successfully wrote {len(df)} records to {SQLITE_FILE} table '{TABLE_NAME}'")
    except Exception as e:
        print(f"Failed to write to SQLite: {e}")

if __name__ == '__main__':
    main()