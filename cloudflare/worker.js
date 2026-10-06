import configHandler from '../api/config.js';
import manifestHandler from '../api/manifest.js';
import brandingHandler from '../api/branding.js';
import productHandler from '../api/product/[id].js';
import serverConfig from '../lib/server-config.cjs';

const handlers = {
  '/api/config': configHandler,
  '/api/manifest': manifestHandler,
  '/manifest.webmanifest': manifestHandler,
  '/api/branding': brandingHandler
};

// Adapt the existing HTTP handlers without sharing mutable settings between requests.
export async function invoke(handler, request, installation, query = {}) {
  const headers = new Headers();
  let status = 200, body = null;
  const res = {
    get statusCode() { return status; },
    set statusCode(value) { status = value; },
    setHeader(name, value) { headers.set(name, String(value)); },
    status(value) { status = value; return this; },
    end(value = '') { body = value; },
    send(value = '') { body = value; },
    redirect(code, target) { status = code; headers.set('Location', target); body = ''; }
  };
  await handler({ query, headers: Object.fromEntries(request.headers) }, res, installation);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const installation = { ...serverConfig.configFor(env), publicOrigin: url.origin };
    const query = Object.fromEntries(url.searchParams);
    const product = url.pathname.match(/^\/(?:api\/)?product\/([1-9]\d*)$/);
    const handler = product ? productHandler : handlers[url.pathname];
    if (handler) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      if (product) query.id = product[1];
      try { return await invoke(handler, request, installation, query); }
      catch (_) { return new Response('Service temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
