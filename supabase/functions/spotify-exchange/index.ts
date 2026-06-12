// Supabase Edge Function source: spotify-exchange
// Place this file under supabase/functions/spotify-exchange/index.ts when deploying with the Supabase CLI.
// This helper is provided here for convenience — deploy it as a Supabase Edge Function named `spotify-exchange`.

// Exchanges an authorization code for Spotify tokens using PKCE.
// This runs server-side to avoid browser CORS restrictions.

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const body = await req.json();
    const { code, redirect_uri, code_verifier, client_id } = body || {};

    if (!code || !redirect_uri || !code_verifier || !client_id) {
      return new Response(JSON.stringify({ error: 'missing_parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirect_uri);
    params.set('client_id', client_id);
    params.set('code_verifier', code_verifier);

    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }

    return new Response(JSON.stringify({ status: resp.status, body: json }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
