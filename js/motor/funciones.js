'use strict';
// Funciones de MySQL que SQLite no tiene, registradas en cada base de datos
// de sql.js con create_function.
(function (global) {
  const M = global.MotorMySQL;
  const T = M.tipos;

  const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  const dos = (n) => String(n).padStart(2, '0');

  // Fecha de MySQL en texto a Date (UTC) o null
  function aFecha(v) {
    if (v === null || v === undefined) return null;
    const f = T.leerFechaHora(String(typeof v === 'number' ? Math.trunc(v) : v));
    if (!f || !T.fechaValida(f.y, f.m, f.d)) return null;
    const d = new Date(Date.UTC(f.y, f.m - 1, f.d, f.h, f.mi, f.s));
    if (f.y < 100) d.setUTCFullYear(f.y);
    return d;
  }

  // Normaliza una fecha de MySQL al formato que entiende SQLite
  function fecha(v) {
    if (v === null || v === undefined) return null;
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2}(\.\d+)?)?$/.test(s)) return s;
    const f = T.leerFechaHora(typeof v === 'number' ? String(Math.trunc(v)) : s);
    if (!f || !T.fechaValida(f.y, f.m, f.d)) return null;
    const base = String(f.y).padStart(4, '0') + '-' + dos(f.m) + '-' + dos(f.d);
    return f.conHora ? base + ' ' + dos(f.h) + ':' + dos(f.mi) + ':' + dos(f.s) : base;
  }

  function formatoFecha(v, formato) {
    const d = aFecha(v);
    if (!d || formato === null) return null;
    const y = d.getUTCFullYear();
    const mes = d.getUTCMonth();
    const dia = d.getUTCDate();
    const h = d.getUTCHours();
    const inicioAnio = Date.UTC(y, 0, 1);
    const diaAnio = Math.floor((d - inicioAnio) / 86400000) + 1;
    const sufijo = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
    const mapa = {
      Y: String(y).padStart(4, '0'), y: String(y).slice(-2), m: dos(mes + 1), c: String(mes + 1), d: dos(dia),
      e: String(dia), H: dos(h), k: String(h), h: dos(h % 12 || 12), I: dos(h % 12 || 12), l: String(h % 12 || 12),
      i: dos(d.getUTCMinutes()), s: dos(d.getUTCSeconds()), S: dos(d.getUTCSeconds()), p: h < 12 ? 'AM' : 'PM',
      W: DIAS[d.getUTCDay()], a: DIAS[d.getUTCDay()].slice(0, 3), M: MESES[mes], b: MESES[mes].slice(0, 3),
      j: String(diaAnio).padStart(3, '0'), w: String(d.getUTCDay()), D: dia + sufijo(dia), f: '000000',
      T: dos(h) + ':' + dos(d.getUTCMinutes()) + ':' + dos(d.getUTCSeconds()),
      r: dos(h % 12 || 12) + ':' + dos(d.getUTCMinutes()) + ':' + dos(d.getUTCSeconds()) + ' ' + (h < 12 ? 'AM' : 'PM'),
      '%': '%',
    };
    return String(formato).replace(/%(.)/g, (_, c) => (mapa[c] !== undefined ? mapa[c] : c));
  }

  function diferencia(unidad, a, b) {
    const x = aFecha(a);
    const y = aFecha(b);
    if (!x || !y) return null;
    const ms = y - x;
    switch (unidad) {
      case 'SECOND': return Math.trunc(ms / 1000);
      case 'MINUTE': return Math.trunc(ms / 60000);
      case 'HOUR': return Math.trunc(ms / 3600000);
      case 'DAY': return Math.trunc(ms / 86400000);
      case 'WEEK': return Math.trunc(ms / 604800000);
      case 'MONTH': case 'QUARTER': case 'YEAR': {
        let meses = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
        const resto = (d) => ((d.getUTCDate() * 24 + d.getUTCHours()) * 60 + d.getUTCMinutes()) * 60 + d.getUTCSeconds();
        if (meses > 0 && resto(y) < resto(x)) meses--;
        if (meses < 0 && resto(y) > resto(x)) meses++;
        return unidad === 'MONTH' ? meses : unidad === 'QUARTER' ? Math.trunc(meses / 3) : Math.trunc(meses / 12);
      }
      default: return null;
    }
  }

  const nulo = (...v) => v.some((x) => x === null || x === undefined);
  const caracteres = (s) => Array.from(String(s));

  function registrar(db) {
    const f = (nombre, fn) => db.create_function(nombre, fn);
    // Forma de comparación de las colaciones que no distinguen mayúsculas ni
    // acentos; las españolas distinguen la eñe
    const sinAcentos = (v, enye) => {
      if (nulo(v)) return null;
      let t = String(v).toLowerCase();
      if (enye) t = t.replace(/ñ/g, '\u0000');
      t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return enye ? t.replace(/\u0000/g, 'ñ') : t;
    };
    f('mysql_ai', (v) => sinAcentos(v, false));
    f('mysql_upper', (v) => (nulo(v) ? null : String(v).toUpperCase()));
    f('mysql_lower', (v) => (nulo(v) ? null : String(v).toLowerCase()));
    // MOD de MySQL: el signo es el del dividendo y MOD(x, 0) es NULL
    f('mysql_mod', (a, b) => {
      if (nulo(a, b)) return null;
      const x = Number(a);
      const y = Number(b);
      if (y === 0) return null;
      return x % y;
    });
    f('mysql_ai_es', (v) => sinAcentos(v, true));
    // LIKE que distingue mayúsculas (colaciones _bin y _cs)
    f('mysql_like_bin', (s, p, esc) => {
      if (nulo(s, p)) return null;
      const e = esc === null || esc === undefined ? '\\' : String(esc);
      const literal = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let re = '';
      const patron = String(p);
      for (let i = 0; i < patron.length; i++) {
        const c = patron[i];
        if (c === e && i + 1 < patron.length) { re += literal(patron[++i]); continue; }
        re += c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : literal(c);
      }
      return new RegExp('^' + re + '$').test(String(s)) ? 1 : 0;
    });
    f('mysql_regexp', (p, t) => (nulo(p, t) ? null : new RegExp(String(p), 'i').test(String(t)) ? 1 : 0));
    f('mysql_substr', (s, pos, len) => {
      if (nulo(s, pos)) return null;
      const c = caracteres(s);
      let p = Math.round(Number(pos));
      if (p === 0) return '';
      if (p < 0) p = c.length + p + 1;
      if (p < 1) return '';
      const l = len === undefined ? c.length : Math.round(Number(len));
      if (len === null) return null;
      if (l <= 0) return '';
      return c.slice(p - 1, p - 1 + l).join('');
    });
    f('mysql_right', (s, n) => {
      if (nulo(s, n)) return null;
      const k = Math.round(Number(n));
      return k <= 0 ? '' : caracteres(s).slice(-k).join('');
    });
    const quitar = (s, q, inicio, fin) => {
      if (nulo(s, q)) return null;
      let r = String(s);
      const x = String(q);
      if (!x) return r;
      if (inicio) while (r.startsWith(x)) r = r.slice(x.length);
      if (fin) while (r.endsWith(x)) r = r.slice(0, -x.length);
      return r;
    };
    f('mysql_trim_cadena', (s, q) => quitar(s, q, true, true));
    f('mysql_ltrim_cadena', (s, q) => quitar(s, q, true, false));
    f('mysql_rtrim_cadena', (s, q) => quitar(s, q, false, true));
    f('mysql_reverse', (s) => (nulo(s) ? null : caracteres(s).reverse().join('')));
    f('mysql_repeat', (s, n) => (nulo(s, n) ? null : Number(n) > 0 ? String(s).repeat(Math.min(Number(n), 100000)) : ''));
    const relleno = (s, n, r, izquierda) => {
      if (nulo(s, n, r)) return null;
      const c = caracteres(s);
      const k = Math.round(Number(n));
      if (k < 0) return null;
      if (c.length >= k) return c.slice(0, k).join('');
      const pad = caracteres(r);
      if (!pad.length) return null;
      const faltan = [];
      while (faltan.length < k - c.length) faltan.push(pad[faltan.length % pad.length]);
      return izquierda ? faltan.join('') + c.join('') : c.join('') + faltan.join('');
    };
    f('mysql_lpad', (s, n, r) => relleno(s, n, r, true));
    f('mysql_rpad', (s, n, r) => relleno(s, n, r, false));
    f('mysql_locate', (sub, s, pos) => {
      if (nulo(sub, s)) return null;
      const c = String(s).toLowerCase();
      const p = pos === undefined ? 1 : Math.round(Number(pos));
      if (p < 1) return 0;
      const i = caracteres(c).slice(p - 1).join('').indexOf(String(sub).toLowerCase());
      return i < 0 ? 0 : caracteres(caracteres(c).slice(p - 1).join('').slice(0, i)).length + p;
    });
    f('mysql_round', (x, d) => {
      if (nulo(x, d)) return null;
      const n = Number(x);
      const k = Math.trunc(Number(d));
      if (k >= 0) return T.redondearTexto(String(n), k);
      const f10 = 10 ** -k;
      return Math.sign(n) * Math.round(Math.abs(n) / f10) * f10;
    });
    f('mysql_truncate', (x, d) => {
      if (nulo(x, d)) return null;
      const f10 = 10 ** Math.trunc(Number(d));
      return Math.trunc(Number(x) * f10) / f10;
    });
    f('mysql_entero', (x) => {
      if (nulo(x)) return null;
      if (typeof x === 'number') return Math.sign(x) * Math.round(Math.abs(x));
      const m = /^\s*[+-]?\d+/.exec(String(x));
      return m ? Number(m[0]) : 0;
    });
    f('mysql_fecha', (v) => fecha(v));
    f('mysql_fecha_resultado', (v) => v);
    f('mysql_date_format', (v, formato) => formatoFecha(v, formato));
    f('mysql_dayname', (v) => { const d = aFecha(v); return d ? DIAS[d.getUTCDay()] : null; });
    f('mysql_monthname', (v) => { const d = aFecha(v); return d ? MESES[d.getUTCMonth()] : null; });
    f('mysql_timestampdiff', (u, a, b) => diferencia(String(u), a, b));
  }

  M.funciones = { registrar, formatoFecha, fecha };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
