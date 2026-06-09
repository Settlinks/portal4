/* ================================================================
   PORTAL 4 — api.js  v3.0
   Central API gateway + UI utilities
   ================================================================

   ► HOW TO SET YOUR GAS URL (do this every new deployment):
   ─────────────────────────────────────────────────────────
   1. Deploy Code.gs → New deployment → Web App
      Execute as: Me | Who has access: Anyone
   2. Copy the /exec URL
   3. Open browser DevTools → Console and run:

        var url = "PASTE_YOUR_EXEC_URL_HERE";
        var k = [80,79,82,84,65,76,52,50,48,50,53];
        var enc = Array.from(url).map(function(c,i){
          return c.charCodeAt(0) ^ k[i % k.length];
        });
        console.log(JSON.stringify(enc));

   4. Copy the printed array and replace _EU below.
   5. Save and upload api.js. Done.
   ================================================================ */

var _k = [80,79,82,84,65,76,52,50,48,50,53];
function _d(b) { return b.map(function(v,i){ return String.fromCharCode(v ^ _k[i % _k.length]); }).join(''); }

// ▼▼▼ REPLACE THIS ARRAY WITH YOUR ENCODED URL ▼▼▼
var _EU = [56,59,38,36,50,118,27,29,67,81,71,57,63,38,122,38,35,91,85,92,87,27,51,32,63,123,44,45,87,64,95,65,26,35,96,19,31,39,53,87,80,71,10,100,5,29,26,26,49,41,81,89,120,127,92,53,125,13,28,12,7,12,97,98,103,84,15,12,20,45,14,14,126,74,101,120,96,22,40,0,108,52,117,64,68,86,6,77,4,43,51,23,49,126,119,89,119,90,82,98,36,39,61,12,46,118,126,31,87,77,53,44];
// ▲▲▲ REPLACE THIS ARRAY WITH YOUR ENCODED URL ▲▲▲

var API_URL = (function(){ try { return _d(_EU); } catch(e){ return ''; } })();

/* ── Config ─────────────────────────────────────────────────── */
var API_TIMEOUT_MS = 35000;   // 35 s — GAS cold start can be 20-25 s
var API_MAX_RETRY  = 1;       // retry once on network/timeout errors

/* ── Session (3-hour expiry) ─────────────────────────────────── */
var Session = {
  KEY: 'portal4_session',
  get: function() {
    try {
      var d = JSON.parse(localStorage.getItem(this.KEY));
      return (d && Date.now() < d.expires) ? d : null;
    } catch(e) { return null; }
  },
  set: function(d) {
    localStorage.setItem(this.KEY,
      JSON.stringify(Object.assign({}, d, { expires: Date.now() + 10800000 })));
  },
  clear: function() { localStorage.removeItem(this.KEY); },
  hasRole: function(r) {
    var s = this.get();
    if (!s) return false;
    var roles = Array.isArray(r) ? r : [r];
    return roles.indexOf(s.role) !== -1;
  }
};

/* ── Core API call ───────────────────────────────────────────── */
/*
   WHY text/plain?
   Google Apps Script Web Apps reject cross-origin POST with
   Content-Type: application/json at the CORS preflight level.
   Using text/plain skips the preflight entirely and GAS accepts
   the body fine because we parse it manually in doPost().
*/
function apiPost(accion, datos, authOverride, _retryCount) {
  datos = datos || {};
  _retryCount = _retryCount || 0;

  // Check URL is configured
  if (!API_URL || API_URL.length < 30 || API_URL.indexOf('script.google.com') === -1) {
    return Promise.reject(new Error(
      'API no configurada. Sigue las instrucciones en api.js para codificar tu URL de GAS y actualizar _EU.'
    ));
  }

  var body = { accion: accion, datos: datos };
  var session = authOverride || Session.get();
  if (session) body.auth = session;

  // AbortController for timeout
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, API_TIMEOUT_MS);

  return fetch(API_URL, {
    method:   'POST',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },  // ← CRITICAL
    body:     JSON.stringify(body),
    signal:   controller.signal,
    redirect: 'follow'
  })
  .then(function(resp) {
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' — ' + resp.statusText);
    return resp.text();
  })
  .then(function(text) {
    var json;
    try { json = JSON.parse(text); }
    catch(e) {
      // GAS sometimes returns an HTML error page — surface it clearly
      var snippet = text.substring(0, 200);
      throw new Error('Respuesta inválida del servidor. Verifica que tu GAS esté desplegado. Detalle: ' + snippet);
    }
    if (json.error) throw new Error(json.error);
    return json;
  })
  .catch(function(err) {
    clearTimeout(timer);
    // Retry once on network/abort (GAS cold start)
    if (_retryCount < API_MAX_RETRY &&
        (err.name === 'AbortError' || err.message.indexOf('Failed to fetch') !== -1 || err.message.indexOf('NetworkError') !== -1)) {
      console.warn('[Portal 4] Reintentando ' + accion + ' (intento ' + (_retryCount + 1) + ')…');
      return new Promise(function(res){ setTimeout(res, 2000); })
        .then(function(){ return apiPost(accion, datos, authOverride, _retryCount + 1); });
    }
    if (err.name === 'AbortError') throw new Error('La solicitud tardó demasiado (' + (API_TIMEOUT_MS/1000) + 's). GAS puede estar iniciando en frío. Intenta de nuevo en 30 segundos.');
    throw err;
  });
}

/* ── Toast notification ──────────────────────────────────────── */
var _TOAST_ICONS = {
  success: 'fa-check-circle',
  error:   'fa-times-circle',
  info:    'fa-info-circle',
  warning: 'fa-exclamation-triangle'
};

function _ensureToastContainer() {
  if (!document.getElementById('toast-container')) {
    var c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _ensureToastContainer);
} else {
  _ensureToastContainer();
}

function showToast(msg, type, duration) {
  type = type || 'info';
  duration = duration || 4500;
  _ensureToastContainer();
  var c = document.getElementById('toast-container');
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<i class="toast-icon fas ' + (_TOAST_ICONS[type] || _TOAST_ICONS.info) + '"></i><span>' + msg + '</span>';
  c.appendChild(t);
  setTimeout(function(){
    t.classList.add('hide');
    setTimeout(function(){ if(t.parentNode) t.remove(); }, 350);
  }, duration);
}

/* ── Offline banner ──────────────────────────────────────────── */
function _initOffline() {
  if (!document.getElementById('offline-banner')) {
    var b = document.createElement('div');
    b.id = 'offline-banner';
    b.innerHTML = '<i class="fas fa-wifi-slash" style="margin-right:8px"></i>Sin conexión — Los cambios no se enviarán hasta reconectarte.';
    document.body.prepend(b);
  }
  function upd() {
    var el = document.getElementById('offline-banner');
    if (el) el.style.display = navigator.onLine ? 'none' : 'block';
  }
  window.addEventListener('online',  function(){ upd(); showToast('Conexión restaurada ✓', 'success'); });
  window.addEventListener('offline', function(){ upd(); showToast('Sin conexión a internet', 'error', 6000); });
  upd();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initOffline);
} else {
  _initOffline();
}

/* ── Form validation ─────────────────────────────────────────── */
function validateField(input, rules) {
  rules = rules || {};
  var val = input.value.trim();
  var err = '';
  if      (rules.required && !val)                                           err = 'Campo obligatorio.';
  else if (rules.email && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))  err = 'Correo no válido.';
  else if (rules.minLen && val.length < rules.minLen)                        err = 'Mínimo ' + rules.minLen + ' caracteres.';
  else if (rules.phone && val && !/^[\d\s\-\+\(\)]{7,}$/.test(val))        err = 'Teléfono no válido.';

  var prev = input.nextElementSibling;
  if (prev && prev.classList && prev.classList.contains('field-error-msg')) prev.remove();
  input.classList.remove('error', 'valid');

  if (err) {
    input.classList.add('error');
    var p = document.createElement('p');
    p.className = 'field-error-msg';
    p.textContent = err;
    input.after(p);
    return false;
  }
  if (val) input.classList.add('valid');
  return true;
}

/* ── Skeleton loader ─────────────────────────────────────────── */
function skeletonCard() {
  return '<div class="card" style="padding:1.25rem;pointer-events:none">'
    + '<div class="skeleton" style="height:16px;width:35%;margin-bottom:16px"></div>'
    + '<div class="skeleton" style="height:13px;width:80%;margin-bottom:10px"></div>'
    + '<div class="skeleton" style="height:13px;width:55%;margin-bottom:10px"></div>'
    + '<div class="skeleton" style="height:13px;width:40%;margin-bottom:18px"></div>'
    + '<div style="display:flex;gap:8px"><div class="skeleton" style="height:36px;flex:1"></div>'
    + '<div class="skeleton" style="height:36px;flex:1"></div></div></div>';
}
function showSkeletons(containerId, n) {
  n = n || 6;
  var c = document.getElementById(containerId);
  if (c) { var h = ''; for (var i=0;i<n;i++) h += skeletonCard(); c.innerHTML = h; }
}

/* ── Clipboard ───────────────────────────────────────────────── */
function copyToClipboard(text, btn) {
  var p = navigator.clipboard
    ? navigator.clipboard.writeText(text)
    : Promise.resolve().then(function(){
        var t = document.createElement('textarea');
        t.value = text; document.body.appendChild(t); t.select();
        document.execCommand('copy'); t.remove();
      });
  return p.then(function(){
    if (btn) {
      var orig = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(function(){ btn.innerHTML = orig; }, 2000);
    }
  });
}

/* ── File → Base64 ───────────────────────────────────────────── */
function fileToBase64(file) {
  return new Promise(function(res, rej) {
    var r = new FileReader();
    r.onload  = function(){ res(r.result.split(',')[1]); };
    r.onerror = function(){ rej(new Error('Error al leer archivo')); };
    r.readAsDataURL(file);
  });
}

/* ── Helpers ─────────────────────────────────────────────────── */
function fmtMXN(n) {
  return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(Number(n) || 0);
}
function fmtDate(str) {
  if (!str) return '—';
  var d = new Date(str);
  return isNaN(d.getTime()) ? String(str) : d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function qrUrl(text, size) {
  size = size || 150;
  return 'https://chart.googleapis.com/chart?cht=qr&chs=' + size + 'x' + size + '&chl=' + encodeURIComponent(text) + '&choe=UTF-8';
}
function debounce(fn, ms) {
  ms = ms || 300;
  var t;
  return function() {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function(){ fn.apply(null, args); }, ms);
  };
}
function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  if (!Session.hasRole(roles)) {
    showToast('Acceso denegado: permisos insuficientes', 'error');
    return false;
  }
  return true;
}
