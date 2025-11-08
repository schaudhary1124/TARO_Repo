from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class Attraction:
    id: Optional[str]
    name: Optional[str]
    wkt: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    website_url: Optional[str]
    extra: Optional[Dict[str, Any]] = None

    @classmethod
    def from_row(cls, row: Dict[str, Any]):
        # row is a mapping from sqlite3.Row or SQLAlchemy row proxy
        
        # --- MODIFIED: Simplified ID lookup ---
        # The database only has the 'id' column for the primary identifier
        primary_id = row.get('id')
        # --- END MODIFICATION ---
        
        return cls(
            id=primary_id,
            name=row.get('name'),
            wkt=row.get('wkt'),
            lat=row.get('lat'),
            lon=row.get('lon'),
            website_url=row.get('website_url') or row.get('website') or row.get('url'),
            extra={k: v for k, v in row.items() if k not in ('id', 'name', 'wkt', 'lat', 'lon')}
        )

    def to_coord(self):
        if self.lat is None or self.lon is None:
            return None
        return (self.lat, self.lon)