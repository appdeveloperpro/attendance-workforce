export type RoutePoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: Date;
};

export function routeDistance(points: RoutePoint[]) {
  let distance = 0;
  let previous: RoutePoint | undefined;
  for (const point of points) {
    if (point.accuracy > 100) {
      previous = undefined;
      continue;
    }
    if (previous) {
      const segment = haversineMeters(previous, point);
      const elapsedHours = Math.max(
        0.0001,
        (point.capturedAt.getTime() - previous.capturedAt.getTime()) / 3600000,
      );
      if (segment / elapsedHours <= 250000) distance += segment;
    }
    previous = point;
  }
  return Math.round(distance);
}

function haversineMeters(
  first: Pick<RoutePoint, 'latitude' | 'longitude'>,
  second: Pick<RoutePoint, 'latitude' | 'longitude'>,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
