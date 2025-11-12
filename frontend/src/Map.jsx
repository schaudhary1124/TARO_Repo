import React, { useEffect, useRef, useState } from 'react';

// Lightweight loader for Google Maps script
function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.google && window.google.maps) return resolve(window.google.maps);

    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google.maps));
      existingScript.addEventListener('error', () => reject(new Error('google maps load error')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.defer = true;
    script.async = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('google maps load error'));
    document.head.appendChild(script);
  });
}

export default function Map({
  attractions = [],
  selectedIds = [],
  start,
  end,
  routeRequest = null,
  onRouteRendered
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const directionsRendererRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const polylineRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  // Load the map + always create renderer/service (do NOT depend on routeRequest here)
  useEffect(() => {
    const rawKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
    const key = (rawKey || '').replace(/^"(.*)"$/, '$1').trim();
    if (!key) {
      console.warn('VITE_GOOGLE_MAPS_KEY not set; map will not display client-side routes');
      return;
    }

    let cancelled = false;
    loadGoogleMaps(key)
      .then((maps) => {
        if (cancelled) return;

        mapInstance.current = new maps.Map(mapRef.current, {
          center: { lat: 40, lng: -80 },
          zoom: 8,
        });

        // Always create renderer/service now. Route will be drawn in a separate effect.
        directionsRendererRef.current = new maps.DirectionsRenderer({
          map: mapInstance.current,
          suppressMarkers: true,
        });
        directionsServiceRef.current = new maps.DirectionsService();

        setLoaded(true);
      })
      .catch((err) => {
        console.error('Google Maps failed to load:', err);
        alert('Failed to load Google Maps. Check your API key.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Update attraction markers: only show markers for selectedIds
  useEffect(() => {
    if (!mapInstance.current || !window.google) return;

    const maps = window.google.maps;

    // Clear existing markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const toShow = attractions.filter((a) => selectedIds.includes(a.id));
    toShow.forEach((a) => {
      const coord = (a.lat != null && (a.lon != null || a.lng != null))
        ? { lat: Number(a.lat), lng: Number(a.lon ?? a.lng) }
        : null;
      if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng)) {
        const marker = new maps.Marker({
          position: coord,
          map: mapInstance.current,
          title: a.name || a.id,
          icon: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
        });
        markersRef.current.push(marker);
      }
    });
  }, [attractions, selectedIds]);

  // Manage start/end markers (geocode if necessary)
  useEffect(() => {
    if (!mapInstance.current || !window.google) return;

    const maps = window.google.maps;
    const geocoder = new maps.Geocoder();

    const placeMarker = (input, ref, label) => {
      if (!input) {
        if (ref.current) {
          ref.current.setMap(null);
          ref.current = null;
        }
        return;
      }

      const setPos = (latlng) => {
        if (ref.current) {
          ref.current.setPosition(latlng);
          ref.current.setMap(mapInstance.current);
        } else {
          ref.current = new maps.Marker({
            position: latlng,
            map: mapInstance.current,
            title: label,
            icon: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
          });
        }
      };

      if (typeof input === 'object' && input.lat !== undefined && input.lng !== undefined) {
        setPos(input);
        return;
      }

      geocoder.geocode({ address: input }, (results, status) => {
        if (status === maps.GeocoderStatus.OK && results[0]) {
          const loc = results[0].geometry.location;
          setPos({ lat: loc.lat(), lng: loc.lng() });
        } else if (ref.current) {
          ref.current.setMap(null);
          ref.current = null;
        }
      });
    };

    placeMarker(start, startMarkerRef, 'Start');
    placeMarker(end, endMarkerRef, 'End');
  }, [start, end, loaded]);

  // Compute optimized route whenever routeRequest changes
useEffect(() => {
  if (!loaded || !window.google || !mapInstance.current) return;
  if (!routeRequest) return;

  const maps = window.google.maps;

  // Clear any previous overlay
  if (polylineRef.current) {
    polylineRef.current.setMap(null);
    polylineRef.current = null;
  }
  if (directionsRendererRef.current) {
    directionsRendererRef.current.set('directions', null);
  }

  // Use ids from the request; if absent, fall back to selectedIds prop
  const ids =
    Array.isArray(routeRequest.ids) && routeRequest.ids.length > 0
      ? routeRequest.ids
      : selectedIds;

  const selected = (attractions || []).filter(a => ids.includes(a.id));

  // Build coordinate list for Google (needs lat/lng)
  const pts = selected
    .map(a => {
      const lat = Number(a.lat);
      const lng = Number(a.lon ?? a.lng); // accept lon OR lng
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter(Boolean);

  if (pts.length < 2) {
    onRouteRendered?.();
    return;
  }

  // Start/end can be addresses or LatLng-literals
  const origin =
    routeRequest.start && String(routeRequest.start).trim()
      ? routeRequest.start
      : pts[0];

  const destination =
    routeRequest.end && String(routeRequest.end).trim()
      ? routeRequest.end
      : pts[pts.length - 1];

  // Waypoints (Google limit: origin + destination + 23 waypoints)
  const waypoints = pts.slice(1, -1).slice(0, 23).map(p => ({
    location: p,
    stopover: true,
  }));

  // If DirectionsService isn’t ready yet, bail safely
  if (!directionsServiceRef.current || !directionsRendererRef.current) return;

  directionsServiceRef.current.route(
    {
      origin,
      destination,
      waypoints,
      optimizeWaypoints: true,
      travelMode: maps.TravelMode.DRIVING,
    },
    (res, status) => {
      if (status !== 'OK' || !res) {
        // Fallback: show a straight polyline
        polylineRef.current = new maps.Polyline({
          map: mapInstance.current,
          path: pts,
          strokeOpacity: 0.9,
          strokeWeight: 4,
        });
        const fb = new maps.LatLngBounds();
        pts.forEach(p => fb.extend(p));
        mapInstance.current.fitBounds(fb);

        // Normalize for caller
        const orderedAttractions = selected.map(s => ({
          lat: Number(s.lat),
          lon: Number(s.lon ?? s.lng),
          name: s.name || s.title || s.id,
        }));
        onRouteRendered?.({ orderedAttractions });
        return;
      }

      // Draw the Google route
      directionsRendererRef.current.setDirections(res);

      // Fit the route
      const b = new maps.LatLngBounds();
      res.routes[0].legs.forEach(leg => {
        b.extend(leg.start_location);
        b.extend(leg.end_location);
      });
      mapInstance.current.fitBounds(b);

      // Build a normalized ordered list using the actual snapped route
      const legs = res.routes?.[0]?.legs || [];
      const orderedAttractions = [];

      // Start
      if (legs.length > 0 && legs[0].start_location) {
        const sl = legs[0].start_location;
        orderedAttractions.push({
          lat: sl.lat(),
          lon: sl.lng(), // normalize to lon
          name: 'Start',
        });
      }

      // Intermediate stops: each leg's end is the next stop
      for (let i = 0; i < legs.length - 1; i++) {
        const p = legs[i].end_location;
        if (p) {
          orderedAttractions.push({
            lat: p.lat(),
            lon: p.lng(),
            name: `Stop ${i + 1}`,
          });
        }
      }

      // Final destination
      const last = legs[legs.length - 1];
      if (last?.end_location) {
        orderedAttractions.push({
          lat: last.end_location.lat(),
          lon: last.end_location.lng(),
          name: 'End',
        });
      }

      onRouteRendered?.({ orderedAttractions });
    }
  );
}, [routeRequest, attractions, selectedIds, loaded, onRouteRendered]);


  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {!import.meta.env.VITE_GOOGLE_MAPS_KEY && (
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'white', padding: 6 }}>
          ⚠️ Add VITE_GOOGLE_MAPS_KEY in frontend/.env
        </div>
      )}
    </div>
  );
}
