from dataclasses import dataclass
from typing import Optional, Dict, Any

def get_safe_string(row: Dict[str, Any], key: str) -> Optional[str]:
    """Safely get a string from a row, converting 'None' string to None."""
    val = row.get(key)
    if val is None or val == 'None':
        return None
    return str(val)

@dataclass
class Attraction:
    id: Optional[str]
    name: Optional[str]
    wkt: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    website_url: Optional[str]
    wikipedia: Optional[str]
    tourism: Optional[str]     # ✅ Added field
    historic: Optional[str]    # ✅ Added field
    amenity: Optional[str]     # ✅ Added field
    leisure: Optional[str]     # ✅ Added field
    total_rating: int
    rating_count: int
    extra: Optional[Dict[str, Any]] = None

    @classmethod
    def from_row(cls, row: Dict[str, Any]):
        
        website = get_safe_string(row, 'website') or get_safe_string(row, 'website_url')
        
        total_rating = row.get('total_rating', 0)
        rating_count = row.get('rating_count', 0)

        return cls(
            id=get_safe_string(row, 'id'),
            name=get_safe_string(row, 'name'),
            wkt=get_safe_string(row, 'wkt'),
            lat=row.get('lat'),
            lon=row.get('lon'),
            website_url=website,
            wikipedia=get_safe_string(row, 'wikipedia'),
            tourism=get_safe_string(row, 'tourism'),          # ✅ Map new fields here
            historic=get_safe_string(row, 'historic'),
            amenity=get_safe_string(row, 'amenity'),
            leisure=get_safe_string(row, 'leisure'),
            total_rating=int(total_rating) if total_rating is not None else 0,
            rating_count=int(rating_count) if rating_count is not None else 0,
            extra={k: v for k, v in row.items() if k not in (
                'id', 'name', 'wkt', 'lat', 'lon',
                'website_url', 'website', 'url',
                'wikipedia', 'tourism', 'historic', 'amenity', 'leisure',
                'total_rating', 'rating_count'
            )}
        )

    def to_coord(self):
        if self.lat is None or self.lon is None:
            return None
        return (self.lat, self.lon)
