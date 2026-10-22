import { handler as handleLegacyRequest } from '../../server/netlify-handler.js';

// Netlify's modern Functions API uses an ESM default export and web Request/Response.
// Bridge it to the existing API handler so domain routes and database behavior stay unchanged.
export default async function api(request) {
  const url = new URL(request.url);
  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  const result = await handleLegacyRequest({
    rawUrl: request.url,
    path: url.pathname,
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    isBase64Encoded: false,
  });

  return new Response(result.body ?? '', {
    status: result.statusCode ?? 200,
    headers: result.headers ?? {},
  });
}
