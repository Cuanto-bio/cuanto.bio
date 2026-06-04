import { describe, expect, test } from 'vitest';
import type { GpsTrackPoint } from './gpx';
import { generateGpx, parseGpx, trackToBbox } from './gpx';

const t0 = new Date('2026-05-27T10:00:00.000Z').getTime();

describe('generateGpx', () => {
  test('returns a valid GPX header for an empty track', () => {
    const gpx = generateGpx('My Survey', []);
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('creator="cuanto.bio"');
    expect(gpx).toContain('</gpx>');
    expect(gpx).not.toContain('<trkpt');
  });

  test('encodes the survey name in the track', () => {
    const gpx = generateGpx('Riparian Survey', []);
    expect(gpx).toContain('<name>Riparian Survey</name>');
  });

  test('escapes XML special characters in the name', () => {
    const gpx = generateGpx('Survey <A> & "B"', []);
    expect(gpx).toContain('&lt;A&gt; &amp; &quot;B&quot;');
  });

  test('writes a single track point with lat, lon, and time', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.7749, lng: -122.4194, timestamp: t0 },
    ];
    const gpx = generateGpx('Test', pts);
    expect(gpx).toContain('<trkpt lat="37.7749" lon="-122.4194">');
    expect(gpx).toContain('<time>2026-05-27T10:00:00.000Z</time>');
    expect(gpx).toContain('</trkpt>');
  });

  test('writes multiple points in a single segment when closely spaced', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.0, lng: -122.0, timestamp: t0 },
      { lat: 37.1, lng: -122.1, timestamp: t0 + 10_000 },
      { lat: 37.2, lng: -122.2, timestamp: t0 + 20_000 },
    ];
    const gpx = generateGpx('Test', pts);
    const segCount = (gpx.match(/<trkseg>/g) ?? []).length;
    const ptCount = (gpx.match(/<trkpt/g) ?? []).length;
    expect(segCount).toBe(1);
    expect(ptCount).toBe(3);
  });

  test('splits into two segments when there is a large time gap', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.0, lng: -122.0, timestamp: t0 },
      { lat: 37.1, lng: -122.1, timestamp: t0 + 10_000 },
      // 5 minute gap
      { lat: 37.5, lng: -122.5, timestamp: t0 + 310_000 },
      { lat: 37.6, lng: -122.6, timestamp: t0 + 320_000 },
    ];
    const gpx = generateGpx('Test', pts);
    const segCount = (gpx.match(/<trkseg>/g) ?? []).length;
    expect(segCount).toBe(2);
  });

  test('does not split for a gap just under 5 minutes', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.0, lng: -122.0, timestamp: t0 },
      { lat: 37.1, lng: -122.1, timestamp: t0 + 299_000 },
    ];
    const gpx = generateGpx('Test', pts);
    const segCount = (gpx.match(/<trkseg>/g) ?? []).length;
    expect(segCount).toBe(1);
  });

  test('single point produces one segment', () => {
    const pts: GpsTrackPoint[] = [{ lat: 37.0, lng: -122.0, timestamp: t0 }];
    const gpx = generateGpx('Test', pts);
    expect(gpx).toContain('<trkseg>');
    expect(gpx).toContain('</trkseg>');
  });
});

describe('parseGpx', () => {
  test('returns [] for a GPX file with no track points', () => {
    expect(parseGpx(generateGpx('Empty', []))).toEqual([]);
  });

  test('round-trips a multi-point track through generateGpx', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.0, lng: -122.0, timestamp: t0 },
      { lat: 37.1, lng: -122.1, timestamp: t0 + 10_000 },
      { lat: 37.5, lng: -122.5, timestamp: t0 + 320_000 },
    ];
    const parsed = parseGpx(generateGpx('Round-trip', pts));
    expect(parsed).toEqual(pts);
  });

  test('handles a foreign GPX with extra namespaces and elevation', () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxx="http://x.example.com">
  <trk><trkseg>
    <trkpt lat="40.0" lon="-100.0"><ele>1234</ele><time>2026-06-01T00:00:00Z</time></trkpt>
    <trkpt lon="-100.5" lat="40.5"><time>2026-06-01T00:01:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
    const parsed = parseGpx(gpx);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].lat).toBe(40.0);
    expect(parsed[0].lng).toBe(-100.0);
    expect(parsed[1].lat).toBe(40.5);
    expect(parsed[1].lng).toBe(-100.5);
  });

  test('falls back to timestamp 0 when <time> is missing', () => {
    const gpx = '<trkpt lat="1" lon="2"></trkpt>';
    const parsed = parseGpx(gpx);
    expect(parsed[0].timestamp).toBe(0);
  });

  test('skips trkpts with missing or invalid lat/lon', () => {
    const gpx = `
      <trkpt lon="-100"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="not-a-number" lon="-100"></trkpt>
      <trkpt lat="40" lon="-100"></trkpt>
    `;
    expect(parseGpx(gpx)).toEqual([{ lat: 40, lng: -100, timestamp: 0 }]);
  });
});

describe('trackToBbox', () => {
  test('returns null for empty track', () => {
    expect(trackToBbox([])).toBeNull();
  });

  test('single point yields bbox where all edges equal the point', () => {
    const bbox = trackToBbox([{ lat: 37.5, lng: -122.0, timestamp: t0 }]);
    expect(bbox).toEqual({
      north: '37.5',
      south: '37.5',
      east: '-122',
      west: '-122',
    });
  });

  test('derives correct min/max from multiple points', () => {
    const pts: GpsTrackPoint[] = [
      { lat: 37.0, lng: -122.5, timestamp: t0 },
      { lat: 38.0, lng: -121.0, timestamp: t0 + 10_000 },
      { lat: 37.5, lng: -122.0, timestamp: t0 + 20_000 },
    ];
    const bbox = trackToBbox(pts);
    expect(bbox).toEqual({
      north: '38',
      south: '37',
      east: '-121',
      west: '-122.5',
    });
  });
});
