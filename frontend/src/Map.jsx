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
    // find waypoints from ids
    const waypoints = ids.map(id=>{
      const a = attractions.find(x=>x.id==id)
      if(!a) return null
      if(a.lat && a.lon) return { location: { lat: Number(a.lat), lng: Number(a.lon) }, stopover: true }
      return null
    }).filter(Boolean)

    const origin = s || (waypoints.length? waypoints[0].location : null)
    const destination = e || (waypoints.length? waypoints[waypoints.length-1].location : null)
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
      waypoints: waypoints
    }

    directionsServiceRef.current.route(req, (result, status)=>{
      if(status === maps.DirectionsStatus.OK){
        directionsRendererRef.current.setDirections(result)
      } else {
        console.error('Directions request failed:', status)
        alert('Directions failed: ' + status)
      }
      onRouteRendered && onRouteRendered()
    })
  },[routeRequest, attractions, onRouteRendered])

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
