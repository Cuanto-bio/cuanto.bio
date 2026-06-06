// Basic ping endpoint for connectivity checks
export function GET() {
  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
