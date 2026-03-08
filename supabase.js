// ╔══════════════════════════════════════════════════════╗
// ║  Минимальный Supabase клиент — без CDN, чистый fetch ║
// ║  Покрывает: auth + from().select/insert/update/delete║
// ╚══════════════════════════════════════════════════════╝
window.supabase = {
  createClient: function(url, key) {
    var base = url.replace(/\/$/, '');
    var headers = { 'apikey': key, 'Content-Type': 'application/json' };

    // ── Хранение сессии ──
    var SESSION_KEY = 'sb_session';
    var _session = null;
    var _authListeners = [];

    function saveSession(s) {
      _session = s;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e){}
      _authListeners.forEach(function(fn){ fn('SIGNED_IN', s); });
    }
    function clearSession() {
      _session = null;
      try { localStorage.removeItem(SESSION_KEY); } catch(e){}
      _authListeners.forEach(function(fn){ fn('SIGNED_OUT', null); });
    }
    function loadSession() {
      if (_session) return _session;
      try {
        var raw = localStorage.getItem(SESSION_KEY);
        if (raw) { _session = JSON.parse(raw); return _session; }
      } catch(e){}
      return null;
    }

    // ── AUTH ──
    var auth = {
      getSession: async function() {
        var s = loadSession();
        // Refresh if expired
        if (s && s.expires_at && Date.now() / 1000 > s.expires_at - 60) {
          try {
            var r = await fetch(base + '/auth/v1/token?grant_type=refresh_token', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({ refresh_token: s.refresh_token })
            });
            var d = await r.json();
            if (d.access_token) {
              s = { access_token: d.access_token, refresh_token: d.refresh_token,
                    expires_at: Math.floor(Date.now()/1000) + (d.expires_in||3600), user: d.user };
              saveSession(s);
            } else { clearSession(); return { data: { session: null }, error: null }; }
          } catch(e) { return { data: { session: loadSession() }, error: null }; }
        }
        return { data: { session: s }, error: null };
      },

      onAuthStateChange: function(callback) {
        _authListeners.push(callback);
        // Fire immediately with current state
        var s = loadSession();
        if (s) setTimeout(function(){ callback('SIGNED_IN', s); }, 0);
        return { data: { subscription: { unsubscribe: function(){
          _authListeners = _authListeners.filter(function(f){ return f !== callback; });
        }}}};
      },

      signInWithPassword: async function(opts) {
        try {
          var r = await fetch(base + '/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ email: opts.email, password: opts.password })
          });
          var d = await r.json();
          if (d.error || d.error_description || d.msg) {
            var msg = d.error_description || d.msg || d.error || 'Ошибка входа';
            if (msg.includes('Invalid login')) msg = 'Invalid login credentials';
            return { data: null, error: { message: msg } };
          }
          var s = { access_token: d.access_token, refresh_token: d.refresh_token,
                    expires_at: Math.floor(Date.now()/1000) + (d.expires_in||3600), user: d.user };
          saveSession(s);
          return { data: { session: s, user: d.user }, error: null };
        } catch(e) { return { data: null, error: { message: e.message } }; }
      },

      signUp: async function(opts) {
        try {
          var r = await fetch(base + '/auth/v1/signup', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ email: opts.email, password: opts.password,
                                   data: (opts.options && opts.options.data) || {} })
          });
          var d = await r.json();
          if (d.error || d.error_description) {
            return { data: null, error: { message: d.error_description || d.error } };
          }
          // Auto-login after signup
          var s = null;
          if (d.access_token) {
            s = { access_token: d.access_token, refresh_token: d.refresh_token,
                  expires_at: Math.floor(Date.now()/1000) + (d.expires_in||3600), user: d.user };
            saveSession(s);
          }
          return { data: { session: s, user: d.user || d }, error: null };
        } catch(e) { return { data: null, error: { message: e.message } }; }
      },

      signOut: async function() {
        var s = loadSession();
        if (s) {
          try {
            await fetch(base + '/auth/v1/logout', {
              method: 'POST',
              headers: Object.assign({}, headers, { 'Authorization': 'Bearer ' + s.access_token })
            });
          } catch(e){}
        }
        clearSession();
        return { error: null };
      }
    };

    // ── DATABASE (PostgREST) ──
    function from(table) {
      var _filters = [];
      var _select = '*';
      var _order = null;
      var _limit = null;

      function getAuthHeader() {
        var s = loadSession();
        if (s && s.access_token) return { 'Authorization': 'Bearer ' + s.access_token };
        return {};
      }

      function buildUrl() {
        var u = base + '/rest/v1/' + table + '?select=' + _select;
        _filters.forEach(function(f){ u += '&' + f; });
        if (_order) u += '&order=' + _order;
        if (_limit) u += '&limit=' + _limit;
        return u;
      }

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

        // Execute SELECT
        then: function(resolve, reject) {
          return fetch(buildUrl(), {
            headers: Object.assign({}, headers, getAuthHeader(),
                       { 'Prefer': 'return=representation' })
          })
          .then(function(r){ return r.json(); })
          .then(function(d){
            if (d && d.code && d.message) resolve({ data: null, error: { message: d.message } });
            else resolve({ data: Array.isArray(d) ? d : [], error: null });
          })
          .catch(function(e){ resolve({ data: null, error: { message: e.message } }); });
        },

        insert: async function(rows) {
          try {
            var body = Array.isArray(rows) ? rows : [rows];
            var r = await fetch(base + '/rest/v1/' + table, {
              method: 'POST',
              headers: Object.assign({}, headers, getAuthHeader(), { 'Prefer': 'return=representation' }),
              body: JSON.stringify(body)
            });
            var d = await r.json();
            if (d && d.code) return { data: null, error: { message: d.message || d.details } };
            return { data: Array.isArray(d) ? d : [d], error: null };
          } catch(e) { return { data: null, error: { message: e.message } }; }
        },

        upsert: async function(rows) {
          try {
            var body = Array.isArray(rows) ? rows : [rows];
            var r = await fetch(base + '/rest/v1/' + table, {
              method: 'POST',
              headers: Object.assign({}, headers, getAuthHeader(),
                         { 'Prefer': 'return=representation,resolution=merge-duplicates' }),
              body: JSON.stringify(body)
            });
            var d = await r.json();
            if (d && d.code) return { data: null, error: { message: d.message } };
            return { data: d, error: null };
          } catch(e) { return { data: null, error: { message: e.message } }; }
        },

        update: async function(vals) {
          try {
            var u = base + '/rest/v1/' + table + '?';
            _filters.forEach(function(f, i){ u += (i?'&':'') + f; });
            var r = await fetch(u, {
              method: 'PATCH',
              headers: Object.assign({}, headers, getAuthHeader(), { 'Prefer': 'return=representation' }),
              body: JSON.stringify(vals)
            });
            var d = await r.json();
            if (d && d.code) return { data: null, error: { message: d.message } };
            return { data: d, error: null };
          } catch(e) { return { data: null, error: { message: e.message } }; }
        },

        delete: async function() {
          try {
            var u = base + '/rest/v1/' + table + '?';
            _filters.forEach(function(f, i){ u += (i?'&':'') + f; });
            var r = await fetch(u, {
              method: 'DELETE',
              headers: Object.assign({}, headers, getAuthHeader())
            });
            return { data: null, error: r.ok ? null : { message: 'Delete failed' } };
          } catch(e) { return { data: null, error: { message: e.message } }; }
        },

        filter: function(col, op, val) { _filters.push(col + '=' + op + '.' + encodeURIComponent(val)); return q; }
      };
      return q;
    }

    return { auth: auth, from: from };
  }
};
