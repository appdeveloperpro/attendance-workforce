'use client';

import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';
import { useEffect } from 'react';

export type MapRoutePoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  segmentDistanceMeters: number;
};

type RouteLocation = { latitude: number; longitude: number; accuracy: number | null } | null;

type RouteMapProps = {
  points: MapRoutePoint[];
  startLocation: RouteLocation;
  endLocation: RouteLocation;
};

function FitRouteBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }, [bounds, map]);
  return null;
}

function splitRoute(points: MapRoutePoint[]): LatLngExpression[][] {
  const segments: LatLngExpression[][] = [];
  let segment: LatLngExpression[] = [];
  for (const [index, point] of points.entries()) {
    if (index > 0) {
      const gapMs = new Date(point.capturedAt).getTime() -
        new Date(points[index - 1].capturedAt).getTime();
      if ((gapMs > 10 * 60 * 1000 || point.segmentDistanceMeters === 0) && segment.length > 1) {
        segments.push(segment);
        segment = [];
      }
      if (point.segmentDistanceMeters === 0) segment = [];
    }
    segment.push([point.latitude, point.longitude]);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

export default function RouteMap({ points, startLocation, endLocation }: RouteMapProps) {
  const coordinates = [
    ...points.map(({ latitude, longitude }) => [latitude, longitude] as LatLngExpression),
    ...(startLocation ? [[startLocation.latitude, startLocation.longitude] as LatLngExpression] : []),
    ...(endLocation ? [[endLocation.latitude, endLocation.longitude] as LatLngExpression] : []),
  ];
  if (coordinates.length === 0) return null;
  const bounds = coordinates as LatLngBoundsExpression;
  const center = coordinates[0] as LatLngExpression;
  const segments = splitRoute(points);

  return (
    <div className="route-map" role="region" aria-label="Recorded shift route map">
      <MapContainer center={center} zoom={14} scrollWheelZoom>
        <FitRouteBounds bounds={bounds} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {segments.map((segment, index) => (
          <Polyline key={`segment-${index}`} positions={segment} pathOptions={{ color: '#18764d', weight: 4 }} />
        ))}
        {points.map((point, index) => (
          <CircleMarker
            key={`${point.capturedAt}-${index}`}
            center={[point.latitude, point.longitude]}
            radius={5}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#18764d', fillOpacity: 1 }}
          >
            <Popup>
              <strong>GPS point {index + 1}</strong>
              <br />{new Date(point.capturedAt).toLocaleString()}
              <br />Accuracy: ±{Math.round(point.accuracy)} m
            </Popup>
          </CircleMarker>
        ))}
        {startLocation && (
          <CircleMarker
            center={[startLocation.latitude, startLocation.longitude]}
            radius={8}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#16803e', fillOpacity: 1 }}
          >
            <Popup>Check-in location</Popup>
          </CircleMarker>
        )}
        {endLocation && (
          <CircleMarker
            center={[endLocation.latitude, endLocation.longitude]}
            radius={8}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#c34436', fillOpacity: 1 }}
          >
            <Popup>Check-out location</Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
