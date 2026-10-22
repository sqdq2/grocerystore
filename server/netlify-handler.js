import { Readable } from 'node:stream';
import { createRequestHandler } from './index.js';

const requestHandler = createRequestHandler();
const functionPrefix = '/.netlify/functions/api';

function requestPath(event) {
  const rawUrl = event.rawUrl || event.path || '/api';
  const url = new URL(rawUrl, 'https://netlify.local');
  let pathname = url.pathname;
  if (pathname === functionPrefix || pathname.startsWith(`${functionPrefix}/`)) {
    pathname = pathname.slice(functionPrefix.length) || '/api';
  }
  if (!pathname.startsWith('/api')) pathname = pathname === '/' ? '/api' : `/api${pathname}`;
  return `${pathname}${url.search}`;
}

function toNodeRequest(event) {
  const rawBody = event.body || '';
  const body = event.isBase64Encoded ? Buffer.from(rawBody, 'base64') : Buffer.from(rawBody);
  const request = Readable.from(body.length ? [body] : []);
  request.method = event.httpMethod || event.method || 'GET';
  request.url = requestPath(event);
  request.headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  request.headers.host ||= 'netlify.local';
  return request;
}

function createNodeResponse() {
  const state = { statusCode: 200, headers: {}, body: '', writableEnded: false, headersSent: false };
  const response = {
    get statusCode() { return state.statusCode; },
    get writableEnded() { return state.writableEnded; },
    get headersSent() { return state.headersSent; },
    setHeader(name, value) { state.headers[name] = value; return response; },
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      Object.assign(state.headers, headers);
      state.headersSent = true;
      return response;
    },
    end(body = '') {
      state.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      state.writableEnded = true;
      return response;
    },
  };
  return { response, state };
}

export async function handler(event) {
  const { response, state } = createNodeResponse();
  try {
    await requestHandler(toNodeRequest(event), response);
    return {
      statusCode: state.statusCode,
      headers: state.headers,
      body: state.body,
      isBase64Encoded: false,
    };
  } catch (error) {
    console.error('[netlify] API initialization/request failed:', error);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'The API could not initialize. Check the Netlify database and BGS_SECRET environment variables.' }),
    };
  }
}
