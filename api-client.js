// api-client.js — встроить inline в каждую страницу
// Все запросы идут на /api/api (Netlify Function), НЕ на supabase.co напрямую

var API_URL = '/api/api';
var SESSION_KEY = 'oge_session';

// ── Сессия ──
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e) { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e) {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
}

async function apiCall(action, payload) {
  try {
    var s = getSession();
    if (payload && s && s.access_token) payload.token = s.access_token;
    var r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {} })
    });
    return await r.json();
  } catch(e) {
    return { error: e.message };
  }
}

// ── AUTH ──
var auth = {
  getSession: function() {
    var s = getSession();
    return Promise.resolve({ data: { session: s }, error: null });
  },

  onAuthStateChange: function(cb) {
    var s = getSession();
    if (s) setTimeout(function(){ cb('SIGNED_IN', s); }, 0);
    return { data: { subscription: { unsubscribe: function(){} } } };
  },

  signInWithPassword: async function(opts) {
    var d = await apiCall('login', { email: opts.email, password: opts.password });
    if (d.error || d.error_description) {
      var msg = d.error_description || d.error || 'Неверный email или пароль';
      if (msg.includes('Invalid login')) msg = 'Invalid login credentials';
      return { data: null, error: { message: msg } };
    }
    var s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now()/1000) + (d.expires_in || 3600),
      user: d.user
    };
    saveSession(s);
    return { data: { session: s, user: d.user }, error: null };
  },

  signUp: async function(opts) {
    var d = await apiCall('register', {
      email: opts.email,
      password: opts.password,
      data: (opts.options && opts.options.data) || {}
    });
    if (d.error || d.error_description) {
      return { data: null, error: { message: d.error_description || d.error } };
    }
    var user = d.user || d;
    var s = null;
    if (d.access_token) {
      s = {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_at: Math.floor(Date.now()/1000) + (d.expires_in || 3600),
        user: user
      };
      saveSession(s);
    }
    return { data: { session: s, user: user }, error: null };
  },

  signOut: async function() {
    var s = getSession();
    if (s) await apiCall('logout', { access_token: s.access_token });
    clearSession();
    return { error: null };
  }
};

// ── DATABASE ──
function db(table) {
  var _filters = [];
  var _order = null;
  var _limit = null;
  var _select = '*';

  var q = {
    select: function(cols) { _select = cols || '*'; return q; },
    eq:     function(col, val) { _filters.push(col + '=eq.' + encodeURIComponent(val)); return q; },
    neq:    function(col, val) { _filters.push(col + '=neq.' + encodeURIComponent(val)); return q; },
    or:     function(expr) { _filters.push('or=(' + expr + ')'); return q; },
    order:  function(col, opts) {
      _order = col + (opts && opts.ascending === false ? '.desc' : '.asc');
      return q;
    },
    limit:  function(n) { _limit = n; return q; },
    filter: function(col, op, val) { _filters.push(col + '=' + op + '.' + encodeURIComponent(val)); return q; },

    then: function(resolve) {
      apiCall('select', { table: table, filters: _filters, order: _order, limit: _limit, select: _select })
        .then(function(d) {
          if (d.error) resolve({ data: null, error: { message: d.error } });
          else resolve({ data: Array.isArray(d) ? d : [], error: null });
        });
    },

    insert: function(rows) {
      return apiCall('insert', { table: table, rows: rows }).then(function(d) {
        if (d.error) return { data: null, error: { message: d.error } };
        return { data: d, error: null };
      });
    },

    upsert: function(rows) {
      return apiCall('upsert', { table: table, rows: rows }).then(function(d) {
        if (d.error) return { data: null, error: { message: d.error } };
        return { data: d, error: null };
      });
    },

    update: function(vals) {
      return apiCall('update', { table: table, filters: _filters, values: vals }).then(function(d) {
        if (d.error) return { data: null, error: { message: d.error } };
        return { data: d, error: null };
      });
    },

    delete: function() {
      return apiCall('delete', { table: table, filters: _filters }).then(function(d) {
        return { data: null, error: d.error ? { message: d.error } : null };
      });
    }
  };
  return q;
}

// Совместимый интерфейс — заменяет window.supabase.createClient
window.supabase = {
  createClient: function() {
    return { auth: auth, from: db };
  }
};
