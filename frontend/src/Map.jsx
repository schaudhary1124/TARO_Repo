import React, {useEffect, useRef, useState} from 'react'

// Lightweight loader for Google Maps script
function loadGoogleMaps(key){
  return new Promise((resolve, reject)=>{
    if(typeof window === 'undefined') return reject(new Error('no window'))
    if(window.google && window.google.maps) return resolve(window.google.maps)
    const existing = document.getElementById('google-maps-script')
    if(existing){
      existing.addEventListener('load', ()=> resolve(window.google.maps))
      existing.addEventListener('error', ()=> reject(new Error('google maps load error')))
      return
    }
    const s = document.createElement('script')
    s.id = 'google-maps-script'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    s.defer = true
    s.async = true
    s.onload = ()=> resolve(window.google.maps)
    s.onerror = ()=> reject(new Error('google maps load error'))
    document.head.appendChild(s)
  })
}

export default function Map({ attractions=[], selectedIds=[], start, end, routeRequest, onRouteRendered }){
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])
  const directionsRendererRef = useRef(null)
  const directionsServiceRef = useRef(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(()=>{
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY
    if(!key){
      console.warn('VITE_GOOGLE_MAPS_KEY not set; map will not display directions client-side')
      return
    }
    let cancelled = false
    loadGoogleMaps(key).then((maps)=>{
      if(cancelled) return
      mapInstance.current = new maps.Map(mapRef.current, {center: {lat: 40, lng: -80}, zoom: 8})
      directionsRendererRef.current = new maps.DirectionsRenderer({map: mapInstance.current})
      directionsServiceRef.current = new maps.DirectionsService()
      setLoaded(true)
    }).catch(err=>{
      console.error('google maps load failed', err)
    })
    return ()=>{ cancelled = true }
  },[])

  // update attraction markers: only show markers for selectedIds
  useEffect(()=>{
    if(!mapInstance.current) return
    // clear existing attraction markers
    markersRef.current.forEach(m=>m.setMap(null))
    markersRef.current = []
    const maps = window.google.maps
    const toShow = attractions.filter(a => selectedIds && selectedIds.includes(a.id))
    toShow.forEach(a=>{
      const coord = a.lat && a.lon ? {lat: Number(a.lat), lng: Number(a.lon)} : null
      if(coord){
        const marker = new maps.Marker({position: coord, map: mapInstance.current, title: a.name || a.id})
        markersRef.current.push(marker)
      }
    })
  },[attractions, selectedIds])

  // no-op: markers only contain selected attractions; we still set their icon to green
  useEffect(()=>{
    if(!mapInstance.current) return
    const maps = window.google.maps
    markersRef.current.forEach(m=> m.setIcon('http://maps.google.com/mapfiles/ms/icons/green-dot.png'))
  },[markersRef.current.length])

  // manage start/end markers (geocode if necessary)
  const startMarkerRef = useRef(null)
  const endMarkerRef = useRef(null)
  useEffect(()=>{
    if(!mapInstance.current) return
    const maps = window.google.maps
    const geocoder = new maps.Geocoder()

    // helper to place marker for address or coord
    const placeMarker = (input, ref, label) => {
      if(!input){
        if(ref.current){ ref.current.setMap(null); ref.current = null }
        return
      }
      const setPos = (latlng)=>{
        if(ref.current){
          ref.current.setPosition(latlng)
          ref.current.setMap(mapInstance.current)
        } else {
          ref.current = new maps.Marker({position: latlng, map: mapInstance.current, title: label, icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'})
        }
        mapInstance.current.panTo(latlng)
      }

      // if input looks like coords object
      if(typeof input === 'object' && input.lat !== undefined && input.lng !== undefined){
        setPos(input)
        return
      }
      // else assume address string and geocode
      geocoder.geocode({address: input}, (results, status)=>{
        if(status === maps.GeocoderStatus.OK && results[0]){
          const loc = results[0].geometry.location
          setPos({lat: loc.lat(), lng: loc.lng()})
        } else {
          // clear marker if geocode fails
          if(ref.current){ ref.current.setMap(null); ref.current = null }
        }
      })
    }

    placeMarker(start, startMarkerRef, 'Start')
    placeMarker(end, endMarkerRef, 'End')
  },[start, end, mapInstance.current, loaded])

  // when routeRequest is set, compute route client-side using DirectionsService
  useEffect(()=>{
    if(!routeRequest) return
    if(!directionsServiceRef.current || !directionsRendererRef.current) return

    const maps = window.google.maps
    const { start: s, end: e, ids } = routeRequest
    
    // 1. Get all selected attraction objects
    const selectedAttractions = ids.map(id => attractions.find(x => x.id === id)).filter(Boolean);
    
    // 2. Format attractions for the Directions API waypoints
    const attractionWaypoints = selectedAttractions.map(a=>{
      if(!a.lat || !a.lon) return null
      return { location: { lat: Number(a.lat), lng: Number(a.lon) }, stopover: true }
    }).filter(Boolean)

    const origin = s || (attractionWaypoints.length ? attractionWaypoints[0].location : null)
    const destination = e || (attractionWaypoints.length ? attractionWaypoints[attractionWaypoints.length-1].location : null)
    
    // Determine the intermediate waypoints array (excluding origin/destination if they are attractions)
    let intermediateWaypoints = attractionWaypoints;
    if (!s && intermediateWaypoints.length > 0) {
        intermediateWaypoints = intermediateWaypoints.slice(1);
    }
    if (!e && intermediateWaypoints.length > 0) {
        intermediateWaypoints = intermediateWaypoints.slice(0, -1);
    }
    
    // Safety check
    if(!origin || !destination){
      alert('Need start and end addresses (or attractions with coordinates) to compute route')
      onRouteRendered && onRouteRendered()
      return
    }

    const req = {
      origin,
      destination,
      travelMode: maps.TravelMode.DRIVING,
      optimizeWaypoints: true,
      waypoints: intermediateWaypoints
    }

    // --- REPLACE CALLBACK BODY HERE ---
    directionsServiceRef.current.route(req, (result, status) => {
      if (status === maps.DirectionsStatus.OK) {
        directionsRendererRef.current.setDirections(result);

        try {
          const route = result.routes[0];
          const legs = route.legs || [];

          // Start location from first leg
          const orderedAttractions = [];

          if (legs.length > 0 && legs[0].start_location) {
            orderedAttractions.push({
              lat: legs[0].start_location.lat(),
              lon: legs[0].start_location.lng(),
              name: 'Start'
            });
          }

          // route.waypoint_order gives new order of the intermediate waypoints array
          const wpOrder = route.waypoint_order || [];
          // req.waypoints is the array of waypoints we sent (in the original order)
          const originalWaypoints = req.waypoints || [];

          // Add waypoints in the order Google returned (this respects optimizeWaypoints)
          wpOrder.forEach(i => {
            const wp = originalWaypoints[i];
            if (wp && wp.location) {
              // wp.location might be a LatLng object from Geocoding or a {lat: <num>, lng: <num>} object
              const lat = wp.location.lat;
              const lon = wp.location.lng;
              
              orderedAttractions.push({
                // Ensure we get the numeric value if it's a LatLng object method
                lat: (typeof lat === 'function' ? lat() : lat),
                lon: (typeof lon === 'function' ? lon() : lon),
                // We use a generic name here as we don't have the original attraction object,
                // App.jsx will resolve the names using the coordinates.
                name: wp.name || `Stop ${orderedAttractions.length}`
              });
            }
          });

          // Add destination from last leg
          const lastLeg = legs[legs.length - 1];
          if (lastLeg && lastLeg.end_location) {
            orderedAttractions.push({
              lat: lastLeg.end_location.lat(),
              lon: lastLeg.end_location.lng(),
              name: 'End'
            });
          }

          // Send ordered coordinate list back to App.jsx
          // NOTE: We rely on App.jsx to match coordinates to the actual attraction names.
          onRouteRendered && onRouteRendered({ orderedAttractions });
        } catch (e) {
          console.error('Failed to extract ordered attractions from directions result', e);
          onRouteRendered && onRouteRendered();
        }
      } else {
        console.error('Directions request failed:', status);
        alert('Directions failed: ' + status);
        onRouteRendered && onRouteRendered();
      }
    });
  // --- END REPLACE CALLBACK BODY ---
  },[routeRequest, attractions, onRouteRendered, start, end]) // Added start/end to dependencies for stability

  return (
    <div style={{width:'100%', height:'100%'}}>
      <div ref={mapRef} style={{width:'100%', height:'100%'}} />
      {!import.meta.env.VITE_GOOGLE_MAPS_KEY && (
        <div style={{position:'absolute', left:8, top:8, background:'white', padding:6, borderRadius:4}}>
          Set VITE_GOOGLE_MAPS_KEY in frontend/.env to enable map rendering
        </div>
      )}
    </div>
  )
}