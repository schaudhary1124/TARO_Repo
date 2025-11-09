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
  routeRequest,
  onRouteRendered,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const directionsRendererRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  // Load the map
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
      const coord = a.lat && a.lon ? { lat: Number(a.lat), lng: Number(a.lon) } : null;
      if (coord) {
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
        mapInstance.current.panTo(latlng);
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

  // Compute optimized route based on routeRequest prop
  useEffect(() => {
    if (!routeRequest || !directionsServiceRef.current || !directionsRendererRef.current) return;

    const maps = window.google.maps;
    const { start: s, end: e, ids } = routeRequest;

    const selectedAttractions = ids
      .map((id) => attractions.find((x) => x.id === id))
      .filter(Boolean);

    const attractionWaypoints = selectedAttractions
      .map((a) =>
        a.lat && a.lon
          ? { location: { lat: Number(a.lat), lng: Number(a.lon) }, stopover: true }
          : null
      )
      .filter(Boolean);

    const origin = s || attractionWaypoints[0]?.location;
    const destination = e || attractionWaypoints[attractionWaypoints.length - 1]?.location;

    if (!origin || !destination) {
      alert('Need valid start/end or coordinates for routing.');
      onRouteRendered?.();
      return;
    }

    const req = {
      origin,
      destination,
      travelMode: maps.TravelMode.DRIVING,
      optimizeWaypoints: true,
      waypoints: attractionWaypoints.slice(1, -1),
    };

    directionsServiceRef.current.route(req, (result, status) => {
      if (status !== maps.DirectionsStatus.OK) {
        console.error('Directions failed:', status);
        alert('Directions failed: ' + status);
        onRouteRendered?.();
        return;
      }

      directionsRendererRef.current.setDirections(result);

      const orderedAttractions = [];
      const legs = result.routes?.[0]?.legs || [];

      if (legs.length > 0 && legs[0].start_location) {
        orderedAttractions.push({
          lat: legs[0].start_location.lat(),
          lon: legs[0].start_location.lng(),
          name: 'Start',
        });
      }

      const wpOrder = result.routes?.[0]?.waypoint_order || [];
      wpOrder.forEach((i) => {
        const wp = attractionWaypoints[i + 1];
        if (wp) {
          orderedAttractions.push({
            ...wp.location,
            name: `Stop ${i + 1}`,
          });
        }
      });

      const lastLeg = legs[legs.length - 1];
      if (lastLeg?.end_location) {
        orderedAttractions.push({
          lat: lastLeg.end_location.lat(),
          lon: lastLeg.end_location.lng(),
          name: 'End',
        });
      }

      onRouteRendered?.({ orderedAttractions });
    });
  }, [routeRequest, attractions, onRouteRendered]);

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
