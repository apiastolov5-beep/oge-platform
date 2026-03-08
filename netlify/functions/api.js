// netlify/functions/api.js
// Все запросы к Supabase идут ОТСЮДА — с серверов Netlify, не из браузера пользователя
// Браузер в РФ обращается только к *.netlify.app — это работает

const SB_URL = 'https://vumpkvjmkgdzleltvwks.supabase.co';
const SB_KEY = 'sb_publishable_rNoVZMRI6CkPJWOYgOEjgQ_V7nh1b2x';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const body = event.body ? JSON.parse(event.body) : {};
  const { action, payload } = body;

  try {
    let result;

    // ── AUTH ──
    if (action === 'login') {
      result = await sbFetch('/auth/v1/token?grant_type=password', 'POST', payload);
    }
    else if (action === 'register') {
      result = await sbFetch('/auth/v1/signup', 'POST', payload);
      // Create profile
      if (result.id || (result.user && result.user.id)) {
        const uid = result.id || result.user.id;
        await sbFetch('/rest/v1/profiles', 'POST',
          [{ id: uid, name: payload.data?.name || '', email: payload.email, role: 'student' }],
          { 'Prefer': 'return=minimal' }
        );
      }
    }
    else if (action === 'logout') {
      result = await sbFetch('/auth/v1/logout', 'POST', {}, {
        'Authorization': 'Bearer ' + payload.access_token
      });
      result = { ok: true };
    }
    else if (action === 'refresh') {
      result = await sbFetch('/auth/v1/token?grant_type=refresh_token', 'POST', {
        refresh_token: payload.refresh_token
      });
    }

    // ── DATABASE ──
    else if (action === 'select') {
      // payload: { table, filters, order, limit, select }
      let url = `/rest/v1/${payload.table}?select=${payload.select || '*'}`;
      if (payload.filters) {
        payload.filters.forEach(f => { url += '&' + f; });
      }
      if (payload.order) url += '&order=' + payload.order;
      if (payload.limit) url += '&limit=' + payload.limit;
      result = await sbFetch(url, 'GET', null, authHeader(payload.token));
    }
    else if (action === 'insert') {
      result = await sbFetch(`/rest/v1/${payload.table}`, 'POST',
        Array.isArray(payload.rows) ? payload.rows : [payload.rows],
        { ...authHeader(payload.token), 'Prefer': 'return=representation' }
      );
    }
    else if (action === 'upsert') {
      result = await sbFetch(`/rest/v1/${payload.table}`, 'POST',
        Array.isArray(payload.rows) ? payload.rows : [payload.rows],
        { ...authHeader(payload.token), 'Prefer': 'return=representation,resolution=merge-duplicates' }
      );
    }
    else if (action === 'update') {
      let url = `/rest/v1/${payload.table}?`;
      if (payload.filters) payload.filters.forEach((f, i) => { url += (i?'&':'') + f; });
      result = await sbFetch(url, 'PATCH', payload.values,
        { ...authHeader(payload.token), 'Prefer': 'return=representation' }
      );
    }
    else if (action === 'delete') {
      let url = `/rest/v1/${payload.table}?`;
      if (payload.filters) payload.filters.forEach((f, i) => { url += (i?'&':'') + f; });
      result = await sbFetch(url, 'DELETE', null, authHeader(payload.token));
      result = { ok: true };
    }
    else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function authHeader(token) {
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

async function sbFetch(path, method, body, extraHeaders = {}) {
  const res = await fetch(SB_URL + path, {
    method,
    headers: {
      'apikey': SB_KEY,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch(e) { return { raw: text }; }
}
