export interface GpsTrackPoint {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
}

// Consecutive points more than this many ms apart start a new track segment.
const GAP_THRESHOLD_MS = 5 * 60 * 1000;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface GpsBbox {
  north: string;
  south: string;
  east: string;
  west: string;
}

// Accepts GpsTrackPoint or any object with lat/lng — the bbox is independent
// of timestamp/accuracy, and callers (e.g. GeoMap) may not carry those fields.
export function trackToBbox<P extends { lat: number; lng: number }>(
  points: P[],
): GpsBbox | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const pt of points) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }
  return {
    north: String(maxLat),
    south: String(minLat),
    east: String(maxLng),
    west: String(minLng),
  };
}

// Regex-based instead of a full XML parser to keep the client bundle small —
// we only read lat/lon/time off a known shape. Misses self-closing trkpts,
// single-quoted attrs, and namespace prefixes; reach for a parser if/when we
// accept foreign GPX uploads or need richer fields (ele, extensions, etc.).
export function parseGpx(text: string): GpsTrackPoint[] {
  const points: GpsTrackPoint[] = [];
  for (const match of text.matchAll(/<trkpt\s+([^>]+)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = match[1];
    const body = match[2];
    const latMatch = /\blat\s*=\s*"([^"]+)"/.exec(attrs);
    const lonMatch = /\blon\s*=\s*"([^"]+)"/.exec(attrs);
    if (!latMatch || !lonMatch) continue;
    const lat = Number(latMatch[1]);
    const lng = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const timeMatch = /<time>([^<]+)<\/time>/.exec(body);
    const parsedTime = timeMatch ? Date.parse(timeMatch[1]) : NaN;
    points.push({
      lat,
      lng,
      timestamp: Number.isFinite(parsedTime) ? parsedTime : 0,
    });
  }
  return points;
}

export function generateGpx(name: string, points: GpsTrackPoint[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="cuanto.bio" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <trk>`,
    `    <name>${escapeXml(name)}</name>`,
  ];

  if (points.length > 0) {
    lines.push('    <trkseg>');
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (i > 0 && pt.timestamp - points[i - 1].timestamp >= GAP_THRESHOLD_MS) {
        lines.push('    </trkseg>');
        lines.push('    <trkseg>');
      }
      const time = new Date(pt.timestamp).toISOString();
      lines.push(`      <trkpt lat="${pt.lat}" lon="${pt.lng}">`);
      lines.push(`        <time>${time}</time>`);
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
  }

  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}
