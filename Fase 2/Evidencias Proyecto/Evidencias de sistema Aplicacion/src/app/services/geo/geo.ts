const RADIO_TIERRA_M = 6371000;

const aRad = (grados: number): number => (grados * Math.PI) / 180;


export function haversineMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = aRad(lat2 - lat1);
  const dLng = aRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aRad(lat1)) *
      Math.cos(aRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * RADIO_TIERRA_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


export function esCoordenadaValida(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}
