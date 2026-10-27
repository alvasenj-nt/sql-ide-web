'use strict';
// Tipos de datos de MySQL 8.0: normalización de la definición de cada
// columna, texto con que la muestra MySQL y conversión de valores en modo
// estricto (STRICT_TRANS_TABLES), con los mismos errores que el servidor.
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;

  const CHARSETS = {
    utf8mb4: { defecto: 'utf8mb4_0900_ai_ci', bytes: 4 },
    utf8mb3: { defecto: 'utf8mb3_general_ci', bytes: 3 },
    latin1: { defecto: 'latin1_swedish_ci', bytes: 1 },
    ascii: { defecto: 'ascii_general_ci', bytes: 1 },
    binary: { defecto: 'binary', bytes: 1 },
  };
  const COLACIONES = {};
  [['utf8mb4', ['utf8mb4_0900_ai_ci', 'utf8mb4_0900_as_ci', 'utf8mb4_0900_as_cs', 'utf8mb4_0900_bin',
    'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_unicode_520_ci', 'utf8mb4_bin', 'utf8mb4_spanish_ci',
    'utf8mb4_spanish2_ci', 'utf8mb4_es_0900_ai_ci', 'utf8mb4_es_0900_as_cs', 'utf8mb4_es_trad_0900_ai_ci']],
  ['utf8mb3', ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin', 'utf8mb3_spanish_ci', 'utf8mb3_spanish2_ci']],
  ['latin1', ['latin1_swedish_ci', 'latin1_spanish_ci', 'latin1_general_ci', 'latin1_general_cs', 'latin1_bin']],
  ['ascii', ['ascii_general_ci', 'ascii_bin']],
  ['binary', ['binary']]].forEach(([cs, lista]) => lista.forEach((c) => { COLACIONES[c] = cs; }));

  const ENTEROS = {
    tinyint: { min: -128n, max: 127n, umax: 255n, ancho: 4, uancho: 3 },
    smallint: { min: -32768n, max: 32767n, umax: 65535n, ancho: 6, uancho: 5 },
    mediumint: { min: -8388608n, max: 8388607n, umax: 16777215n, ancho: 9, uancho: 8 },
    int: { min: -2147483648n, max: 2147483647n, umax: 4294967295n, ancho: 11, uancho: 10 },
    bigint: { min: -9223372036854775808n, max: 9223372036854775807n, umax: 18446744073709551615n, ancho: 20, uancho: 20 },
  };
  const TEXTOS = { tinytext: 255, text: 65535, mediumtext: 16777215, longtext: 4294967295 };
  const BLOBS = { tinyblob: 255, blob: 65535, mediumblob: 16777215, longblob: 4294967295 };

  const esEntero = (t) => !!ENTEROS[t.base] || t.base === 'year' || t.base === 'bit';
  const esNumerico = (t) => esEntero(t) || ['decimal', 'float', 'double'].includes(t.base);
  const esCadena = (t) => ['char', 'varchar', 'enum', 'set'].includes(t.base) || !!TEXTOS[t.base];
  const esBinario = (t) => ['binary', 'varbinary'].includes(t.base) || !!BLOBS[t.base];
  const esTemporal = (t) => ['date', 'datetime', 'timestamp', 'time'].includes(t.base);
  const tieneCharset = (t) => esCadena(t);

  // Resuelve juego de caracteres y colación de la columna a partir de los
  // de la tabla. Devuelve [charset, collation] y añade avisos.
  function resolverCharset(charset, collation, defectoCharset, defectoCollation, avisos) {
    let cs = charset ? normalizarCharset(charset, avisos) : null;
    let col = collation ? normalizarColacion(collation) : null;
    if (cs && col && COLACIONES[col] !== cs) {
      throw new ErrorSQL(1253, '42000', "COLLATION '" + col + "' is not valid for CHARACTER SET '" + cs + "'");
    }
    if (!cs && col) cs = COLACIONES[col];
    if (cs && !col) col = cs === defectoCharset && defectoCollation ? defectoCollation : CHARSETS[cs].defecto;
    if (!cs) { cs = defectoCharset; col = defectoCollation; }
    return [cs, col];
  }

  function normalizarCharset(nombre, avisos) {
    let cs = nombre.toLowerCase();
    if (cs === 'utf8') {
      if (avisos) avisos.push(['Warning', 3719, "'utf8' is currently an alias for the character set UTF8MB3, but will be an alias for UTF8MB4 in a future release. Please consider using UTF8MB4 in order to be unambiguous."]);
      cs = 'utf8mb3';
    } else if (cs === 'utf8mb3') {
      if (avisos) avisos.push(['Warning', 1287, "'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"]);
    }
    if (!CHARSETS[cs]) {
      if (['ucs2', 'utf16', 'utf32', 'cp1252', 'latin2', 'gbk', 'big5', 'sjis'].includes(cs)) throw new NoDisponible('juego de caracteres ' + cs);
      throw new ErrorSQL(1115, '42000', "Unknown character set: '" + nombre + "'");
    }
    return cs;
  }

  function normalizarColacion(nombre) {
    let c = nombre.toLowerCase();
    if (c.startsWith('utf8_')) c = 'utf8mb3_' + c.slice(5);
    if (!COLACIONES[c]) throw new ErrorSQL(1273, 'HY000', "Unknown collation: '" + nombre + "'");
    return c;
  }

  const distingueMayusculas = (col) => !col || /_(cs|bin)$/.test(col) || col === 'binary';

  // Normaliza el tipo analizado de una columna. Lanza los errores que MySQL
  // da al crear la tabla y añade sus avisos.
  function normalizarTipo(tipo, nombreCol, tabla, avisos) {
    const t = Object.assign({}, tipo);
    if (ENTEROS[t.base]) {
      if (t.zerofill) {
        avisos.push(['Warning', 1681, 'The ZEROFILL attribute is deprecated and will be removed in a future release. Use the LPAD function to zero-pad numbers, or store the formatted numbers in a CHAR column.']);
      }
      if (t.ancho !== null && t.ancho !== undefined && !(t.base === 'tinyint' && t.ancho === 1)) {
        avisos.push(['Warning', 1681, 'Integer display width is deprecated and will be removed in a future release.']);
      }
      if (t.zerofill && (t.ancho === null || t.ancho === undefined)) t.ancho = ENTEROS[t.base].uancho;
      if (!(t.base === 'tinyint' && t.ancho === 1) && !t.zerofill) t.ancho = null;
      if (t.ancho === 1 && t.base === 'tinyint' && t.sinSigno) t.ancho = null;
    }
    if (t.base === 'decimal') {
      if (t.p > 65) throw new ErrorSQL(1426, '42000', 'Too-big precision ' + t.p + " specified for '" + nombreCol + "'. Maximum is 65.");
      if (t.s > 30) throw new ErrorSQL(1425, '42000', 'Too big scale ' + t.s + " specified for column '" + nombreCol + "'. Maximum is 30.");
      if (t.s > t.p) throw new ErrorSQL(1427, '42000', "For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column '" + nombreCol + "').");
      if (t.p === 0) t.p = 10;
      if (t.sinSigno) avisos.push(['Warning', 1681, 'UNSIGNED for decimal and floating point data types is deprecated and support for it will be removed in a future release.']);
    }
    if (t.base === 'float' || t.base === 'double') {
      if (t.p !== undefined) {
        avisos.push(['Warning', 1681, 'Specifying number of digits for floating point data types is deprecated and will be removed in a future release.']);
        if (t.s > t.p) throw new ErrorSQL(1427, '42000', "For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column '" + nombreCol + "').");
      }
      if (t.sinSigno) avisos.push(['Warning', 1681, 'UNSIGNED for decimal and floating point data types is deprecated and support for it will be removed in a future release.']);
    }
    if (tieneCharset(t)) {
      if (t.charset || t.collation || t.binario) t.charsetExplicito = true;
      const [cs, col] = resolverCharset(t.charset, t.collation, tabla.charset, tabla.collation, avisos);
      t.charset = cs;
      t.collation = t.binario ? cs + '_bin' : col;
      if (t.binario && !COLACIONES[t.collation]) t.collation = col;
      delete t.binario;
      const porCaracter = CHARSETS[cs].bytes;
      if (t.base === 'char' && t.longitud > 255) {
        throw new ErrorSQL(1074, '42000', "Column length too big for column '" + nombreCol + "' (max = 255); use BLOB or TEXT instead");
      }
      if (t.base === 'varchar') {
        const max = Math.floor(65535 / porCaracter);
        if (t.longitud > max) throw new ErrorSQL(1074, '42000', "Column length too big for column '" + nombreCol + "' (max = " + max + '); use BLOB or TEXT instead');
      }
      if (t.base === 'enum' || t.base === 'set') {
        t.valores = t.valores.map((v) => v.replace(/ +$/, ''));
        const vistos = new Map();
        t.valores.forEach((v) => {
          const k = distingueMayusculas(t.collation) ? v : v.toLowerCase();
          if (vistos.has(k)) {
            throw new ErrorSQL(1291, 'HY000', "Column '" + nombreCol + "' has duplicated value '" + vistos.get(k) + "' in " + t.base.toUpperCase());
          }
          vistos.set(k, v);
        });
      }
    } else {
      delete t.charset;
      delete t.collation;
    }
    if (t.base === 'binary' && t.longitud > 255) {
      throw new ErrorSQL(1074, '42000', "Column length too big for column '" + nombreCol + "' (max = 255); use BLOB or TEXT instead");
    }
    if ((t.base === 'datetime' || t.base === 'timestamp' || t.base === 'time') && t.fsp > 6) {
      throw new ErrorSQL(1426, '42000', 'Too-big precision ' + t.fsp + " specified for '" + nombreCol + "'. Maximum is 6.");
    }
    return t;
  }

  const comillas = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

  // Texto del tipo como lo muestran SHOW CREATE TABLE y DESCRIBE
  function textoTipo(t) {
    let s;
    if (ENTEROS[t.base]) {
      s = t.base + (t.ancho ? '(' + t.ancho + ')' : '');
      if (t.sinSigno) s += ' unsigned';
      if (t.zerofill) s += ' zerofill';
      return s;
    }
    switch (t.base) {
      case 'decimal': s = 'decimal(' + t.p + ',' + t.s + ')'; break;
      case 'float': case 'double': s = t.base + (t.p !== undefined ? '(' + t.p + ',' + t.s + ')' : ''); break;
      case 'char': case 'varchar': case 'binary': case 'varbinary': s = t.base + '(' + t.longitud + ')'; break;
      case 'enum': case 'set': s = t.base + '(' + t.valores.map(comillas).join(',') + ')'; break;
      case 'datetime': case 'timestamp': case 'time': s = t.base + (t.fsp ? '(' + t.fsp + ')' : ''); break;
      case 'bit': s = 'bit(' + t.longitud + ')'; break;
      default: s = t.base;
    }
    if ((t.base === 'decimal' || t.base === 'float' || t.base === 'double') && t.sinSigno) s += ' unsigned';
    return s;
  }

  // Afinidad de la columna en SQLite
  function tipoSQLite(t) {
    if (esEntero(t)) return 'INTEGER';
    if (['decimal', 'float', 'double'].includes(t.base)) return 'REAL';
    if (esBinario(t)) return 'BLOB';
    return 'TEXT';
  }

  // ---------- conversión de valores ----------

  // Número en texto según MySQL: espacios iniciales, signo, dígitos, punto
  // y exponente. Devuelve { numero, completo, vacio } o null si no empieza
  // por un número.
  function leerNumero(s) {
    const m = /^[ \t\n\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(s);
    if (!m) return null;
    const resto = s.slice(m[0].length);
    return { texto: m[1], completo: /^[ \t\n\r]*$/.test(resto) };
  }

  // Redondeo de un número decimal escrito en texto a 'escala' decimales,
  // alejándose del cero en el empate (como MySQL con valores exactos)
  function redondearTexto(texto, escala) {
    let n = Number(texto);
    if (!/[eE]/.test(texto)) {
      const neg = texto.startsWith('-');
      let [ent, dec = ''] = texto.replace(/^[+-]/, '').split('.');
      ent = ent || '0';
      if (dec.length <= escala) return (neg ? -1 : 1) * Number(ent + '.' + dec.padEnd(escala, '0'));
      const corte = dec.slice(0, escala);
      const sube = dec[escala] >= '5';
      let entero = BigInt(ent + corte);
      if (sube) entero += 1n;
      const str = entero.toString().padStart(escala + 1, '0');
      const res = Number(str.slice(0, str.length - escala) + (escala ? '.' + str.slice(str.length - escala) : ''));
      return neg ? -res : res;
    }
    const f = 10 ** escala;
    return Math.sign(n) * Math.round(Math.abs(n) * f) / f;
  }

  const enFila = (col, fila) => " for column '" + col.nombre + "' at row " + fila;

  function bytesTexto(cadena) {
    const b = new TextEncoder().encode(cadena);
    return Array.from(b).map((x) => '\\x' + x.toString(16).toUpperCase().padStart(2, '0')).join('');
  }

  // Convierte un valor JavaScript (número, cadena, booleano, null o bytes)
  // al valor que se guarda en una columna. 'valor' viene de un literal o del
  // resultado de una expresión; 'literal' conserva el texto de un número
  // escrito en la sentencia, para no perder decimales.
  function convertir(valor, col, fila, avisos, literal) {
    const t = col.tipo;
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'boolean') valor = valor ? 1 : 0;
    if (ENTEROS[t.base] || t.base === 'year' || t.base === 'bit') return convertirEntero(valor, col, fila, avisos, literal);
    if (t.base === 'decimal') return convertirDecimal(valor, col, fila, avisos, literal);
    if (t.base === 'float' || t.base === 'double') return convertirReal(valor, col, fila, avisos, literal);
    if (t.base === 'date' || t.base === 'datetime' || t.base === 'timestamp') return convertirFecha(valor, col, fila, avisos);
    if (t.base === 'time') return convertirHora(valor, col, fila);
    if (t.base === 'enum' || t.base === 'set') return convertirEnum(valor, col, fila);
    if (esBinario(t)) return convertirBinario(valor, col, fila);
    if (t.base === 'json') return convertirJSON(valor, col, fila);
    return convertirTexto(valor, col, fila, avisos, literal);
  }

  function textoDeValor(valor, literal) {
    if (literal !== undefined && literal !== null) return literal;
    if (valor instanceof Uint8Array) return new TextDecoder().decode(valor);
    if (typeof valor === 'number') return formatoNumero(valor);
    return String(valor);
  }

  function formatoNumero(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toString();
    return String(n);
  }

  function convertirEntero(valor, col, fila, avisos, literal) {
    const t = col.tipo;
    let numeroTexto;
    if (typeof valor === 'number' || typeof valor === 'bigint') {
      numeroTexto = literal || (typeof valor === 'bigint' ? valor.toString() : formatoNumero(valor));
    } else {
      const s = textoDeValor(valor);
      const n = leerNumero(s);
      if (!n) throw new ErrorSQL(1366, 'HY000', "Incorrect integer value: '" + s + "'" + enFila(col, fila));
      if (!n.completo) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      numeroTexto = n.texto;
    }
    let entero;
    if (/^[+-]?\d+$/.test(numeroTexto)) entero = BigInt(numeroTexto);
    else entero = BigInt(Math.sign(Number(numeroTexto)) * Math.round(Math.abs(Number(numeroTexto))));
    if (t.base === 'year') {
      let y = Number(entero);
      if (typeof valor === 'string' && /^\s*\d{1,2}\s*$/.test(valor)) y = y < 70 ? 2000 + y : 1900 + y;
      else if (y > 0 && y < 70) y += 2000;
      else if (y >= 70 && y < 100) y += 1900;
      if (y !== 0 && (y < 1901 || y > 2155)) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
      return y;
    }
    if (t.base === 'bit') {
      const max = (1n << BigInt(t.longitud)) - 1n;
      if (entero < 0n || entero > max) throw new ErrorSQL(1406, '22001', 'Data too long' + enFila(col, fila));
      return Number(entero);
    }
    const r = ENTEROS[t.base];
    const min = t.sinSigno ? 0n : r.min;
    const max = t.sinSigno ? r.umax : r.max;
    if (entero < min || entero > max) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
    return entero > BigInt(Number.MAX_SAFE_INTEGER) || entero < BigInt(Number.MIN_SAFE_INTEGER) ? entero : Number(entero);
  }

  function convertirDecimal(valor, col, fila, avisos, literal) {
    const t = col.tipo;
    let texto;
    if (typeof valor === 'number') texto = literal || formatoNumero(valor);
    else if (typeof valor === 'bigint') texto = valor.toString();
    else {
      const s = textoDeValor(valor);
      const n = leerNumero(s);
      if (!n) throw new ErrorSQL(1366, 'HY000', "Incorrect decimal value: '" + s + "'" + enFila(col, fila));
      if (!n.completo) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      texto = n.texto;
    }
    const exacto = Number(texto);
    const v = redondearTexto(texto, t.s);
    if (v !== exacto && avisos) avisos.push(['Note', 1265, 'Data truncated' + enFila(col, fila)]);
    const limite = 10 ** (t.p - t.s);
    if (Math.abs(v) >= limite || (t.sinSigno && v < 0)) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
    return Object.is(v, -0) ? 0 : v;
  }

  function convertirReal(valor, col, fila, avisos, literal) {
    const t = col.tipo;
    let n;
    if (typeof valor === 'number') n = valor;
    else if (typeof valor === 'bigint') n = Number(valor);
    else {
      const s = textoDeValor(valor);
      const leido = leerNumero(s);
      if (!leido) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      if (!leido.completo) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      n = Number(leido.texto);
    }
    if (literal) n = Number(literal);
    if (!Number.isFinite(n)) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
    if (t.p !== undefined) {
      n = redondearTexto(String(n), t.s);
      if (Math.abs(n) >= 10 ** (t.p - t.s)) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
    }
    if (t.sinSigno && n < 0) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
    if (t.base === 'float') {
      if (Math.abs(n) > 3.402823466e38) throw new ErrorSQL(1264, '22003', 'Out of range value' + enFila(col, fila));
      n = Math.fround(n);
    }
    return n;
  }

  function convertirTexto(valor, col, fila, avisos, literal) {
    const t = col.tipo;
    let s = textoDeValor(valor, typeof valor === 'number' ? literal : null);
    // Caracteres que no caben en el juego de caracteres de la columna
    const limiteCodigo = t.charset === 'utf8mb3' ? 0xffff : t.charset === 'latin1' ? 0xff : t.charset === 'ascii' ? 0x7f : Infinity;
    if (limiteCodigo !== Infinity) {
      for (const ch of s) {
        if (ch.codePointAt(0) > limiteCodigo) {
          throw new ErrorSQL(1366, 'HY000', "Incorrect string value: '" + bytesTexto(ch) + "'" + enFila(col, fila));
        }
      }
    }
    const caracteres = Array.from(s);
    if (t.base === 'char' || t.base === 'varchar') {
      if (caracteres.length > t.longitud) {
        const sobra = caracteres.slice(t.longitud).join('');
        if (/^ +$/.test(sobra)) {
          if (avisos) avisos.push(['Note', 1265, 'Data truncated' + enFila(col, fila)]);
          s = caracteres.slice(0, t.longitud).join('');
        } else throw new ErrorSQL(1406, '22001', 'Data too long' + enFila(col, fila));
      }
      if (t.base === 'char') s = s.replace(/ +$/, '');
      return s;
    }
    if (TEXTOS[t.base]) {
      const bytes = new TextEncoder().encode(s).length;
      if (bytes > TEXTOS[t.base]) throw new ErrorSQL(1406, '22001', 'Data too long' + enFila(col, fila));
    }
    return s;
  }

  function convertirEnum(valor, col, fila) {
    const t = col.tipo;
    const ci = !distingueMayusculas(t.collation);
    const buscar = (v) => {
      const k = v.replace(/ +$/, '');
      return t.valores.find((x) => (ci ? x.toLowerCase() === k.toLowerCase() : x === k));
    };
    if (typeof valor === 'number' || typeof valor === 'bigint') {
      const n = Number(valor);
      if (t.base === 'enum') {
        if (Number.isInteger(n) && n >= 1 && n <= t.valores.length) return t.valores[n - 1];
        throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      }
      const elegidos = t.valores.filter((_, i) => (BigInt(n) >> BigInt(i)) & 1n);
      if (n < 0 || n >= 2 ** t.valores.length) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      return elegidos.join(',');
    }
    const s = textoDeValor(valor);
    if (t.base === 'enum') {
      const v = buscar(s);
      if (v === undefined) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      return v;
    }
    if (s === '') return '';
    const partes = s.split(',');
    const elegidos = new Set();
    for (const p of partes) {
      const v = buscar(p);
      if (v === undefined) throw new ErrorSQL(1265, '01000', 'Data truncated' + enFila(col, fila));
      elegidos.add(v);
    }
    return t.valores.filter((v) => elegidos.has(v)).join(',');
  }

  function convertirBinario(valor, col, fila) {
    const t = col.tipo;
    let bytes = valor instanceof Uint8Array ? valor : new TextEncoder().encode(textoDeValor(valor));
    const max = t.base === 'binary' || t.base === 'varbinary' ? t.longitud : BLOBS[t.base];
    if (bytes.length > max) throw new ErrorSQL(1406, '22001', 'Data too long' + enFila(col, fila));
    if (t.base === 'binary' && bytes.length < max) {
      const relleno = new Uint8Array(max);
      relleno.set(bytes);
      bytes = relleno;
    }
    return bytes;
  }

  function convertirJSON(valor, col, fila) {
    const s = textoDeValor(valor);
    try {
      return JSON.stringify(JSON.parse(s));
    } catch (e) {
      throw new ErrorSQL(3140, '22032', 'Invalid JSON text: "Invalid value." at position 0 in value for column \'' + col.tabla + '.' + col.nombre + "'.");
    }
  }

  const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const bisiesto = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const fechaValida = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= (m === 2 && bisiesto(y) ? 29 : DIAS_MES[m - 1]);
  const dos = (n) => String(n).padStart(2, '0');

  // Interpreta una fecha u hora como MySQL. Devuelve { y, m, d, h, mi, s,
  // frac, conHora } o null.
  function leerFechaHora(s) {
    s = s.trim();
    let m = /^(\d{2,4})[^0-9](\d{1,2})[^0-9](\d{1,2})(?:[T ]+(\d{1,2})[^0-9](\d{1,2})(?:[^0-9](\d{1,2})(?:\.(\d{1,6}))?)?)?$/.exec(s);
    if (!m) {
      m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?)?$/.exec(s);
      if (!m) {
        const c = /^(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(s);
        if (!c) return null;
        m = c;
      }
    }
    let y = Number(m[1]);
    if (m[1].length === 2) y += y < 70 ? 2000 : 1900;
    return { y, m: Number(m[2]), d: Number(m[3]), h: m[4] !== undefined ? Number(m[4]) : 0,
      mi: m[5] !== undefined ? Number(m[5]) : 0, s: m[6] !== undefined ? Number(m[6]) : 0, frac: m[7] || '',
      conHora: m[4] !== undefined };
  }

  function convertirFecha(valor, col, fila, avisos) {
    const t = col.tipo;
    const texto = typeof valor === 'number' ? formatoNumero(valor) : textoDeValor(valor);
    const nombre = t.base === 'date' ? 'date' : 'datetime';
    const error = () => new ErrorSQL(1292, '22007', 'Incorrect ' + nombre + " value: '" + texto + "'" + enFila(col, fila));
    const f = leerFechaHora(texto);
    if (!f) throw error();
    // MySQL 8 avisa de los separadores de fecha distintos de '-'
    const sep = /^\s*\d{2,4}([^0-9-])/.exec(texto);
    if (sep && typeof valor === 'string' && avisos) {
      avisos.push(['Warning', 4095, "Delimiter '" + sep[1] + "' in position " + (sep[0].length - 1) + ' in datetime value \'' + texto
        + "' at row " + fila + " is deprecated. Prefer the standard '-'."]);
    }
    if (f.y === 0 && f.m === 0 && f.d === 0) throw error();
    if (!fechaValida(f.y, f.m, f.d) || f.y < 1 || f.h > 23 || f.mi > 59 || f.s > 59) throw error();
    const fecha = String(f.y).padStart(4, '0') + '-' + dos(f.m) + '-' + dos(f.d);
    if (t.base === 'date') return fecha;
    let seg = f.s;
    let fraccion = '';
    if (t.fsp) fraccion = '.' + (f.frac + '000000').slice(0, t.fsp);
    else if (f.frac && f.frac[0] >= '5') seg += 1;
    let fh = new Date(Date.UTC(f.y, f.m - 1, f.d, f.h, f.mi, seg));
    if (f.y < 100) fh.setUTCFullYear(f.y);
    const res = String(fh.getUTCFullYear()).padStart(4, '0') + '-' + dos(fh.getUTCMonth() + 1) + '-' + dos(fh.getUTCDate())
      + ' ' + dos(fh.getUTCHours()) + ':' + dos(fh.getUTCMinutes()) + ':' + dos(fh.getUTCSeconds()) + fraccion;
    if (t.base === 'timestamp') {
      const utc = M.tipos.zona ? desplazarFecha(res, -M.tipos.zona) : res;
      if (utc < '1970-01-01 00:00:01' || utc > '2038-01-19 03:14:07' + (fraccion ? '.999999' : '')) throw error();
      return utc;
    }
    return res;
  }

  function convertirHora(valor, col, fila) {
    const texto = typeof valor === 'number' ? formatoNumero(valor) : textoDeValor(valor);
    const error = () => new ErrorSQL(1292, '22007', "Incorrect time value: '" + texto + "'" + enFila(col, fila));
    let m = /^\s*(-)?(?:(\d+) )?(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?\s*$/.exec(texto);
    let h, mi, s, neg;
    if (m) {
      neg = !!m[1];
      h = Number(m[3]) + (m[2] ? Number(m[2]) * 24 : 0);
      mi = Number(m[4]);
      s = m[5] ? Number(m[5]) : 0;
    } else {
      m = /^\s*(-)?(\d{1,7})(?:\.\d+)?\s*$/.exec(texto);
      if (!m) {
        const f = leerFechaHora(texto);
        if (!f || !f.conHora) throw error();
        return dos(f.h) + ':' + dos(f.mi) + ':' + dos(f.s);
      }
      neg = !!m[1];
      const n = m[2].padStart(6, '0');
      h = Number(n.slice(0, -4));
      mi = Number(n.slice(-4, -2));
      s = Number(n.slice(-2));
    }
    if (mi > 59 || s > 59) throw error();
    if (h > 838) throw error();
    return (neg ? '-' : '') + dos(h) + ':' + dos(mi) + ':' + dos(s);
  }

  // ---------- presentación ----------

  // Texto de un valor guardado tal como lo muestra el cliente de MySQL
  function mostrarValor(valor, t) {
    if (valor === null || valor === undefined) return null;
    if (valor instanceof Uint8Array) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(valor);
      } catch (e) {
        return '0x' + Array.from(valor).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
      }
    }
    if (!t) return typeof valor === 'number' ? formatoGeneral(valor) : String(valor);
    if (t.base === 'timestamp' && M.tipos.zona) return desplazarFecha(String(valor), M.tipos.zona);
    if (t.base === 'decimal') return formatoDecimal(Number(valor), t.s);
    if (t.base === 'float') return formatoFloat(Number(valor));
    if (t.base === 'double') return formatoGeneral(Number(valor));
    if (ENTEROS[t.base] && t.zerofill) return String(valor).padStart(t.ancho, '0');
    return typeof valor === 'number' ? formatoGeneral(valor) : String(valor);
  }

  // Suma minutos a una fecha y hora 'YYYY-MM-DD HH:MM:SS[.ffffff]'
  function desplazarFecha(s, minutos) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?$/.exec(s);
    if (!m) return s;
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + minutos * 60000);
    const dos = (n) => String(n).padStart(2, '0');
    return String(d.getUTCFullYear()).padStart(4, '0') + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()) + ' '
      + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes()) + ':' + dos(d.getUTCSeconds()) + (m[7] || '');
  }

  function formatoDecimal(n, escala) {
    if (!Number.isFinite(n)) return String(n);
    let s = (Math.round(n * 10 ** escala) / 10 ** escala).toFixed(escala);
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    return s;
  }

  function formatoFloat(n) {
    if (n === 0) return '0';
    const s = Number(n.toPrecision(6));
    return formatoGeneral(s);
  }

  // Doble: la representación más corta, como %.17g sin ceros sobrantes
  function formatoGeneral(n) {
    if (typeof n === 'bigint') return n.toString();
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toString();
    let s = String(n);
    if (/e/.test(s)) {
      const [man, exp] = s.split('e');
      s = man + 'e' + (exp.startsWith('-') ? exp : exp.replace('+', ''));
    }
    return s;
  }

  // Literal de SQLite para un valor guardado
  function literalSQLite(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'NULL';
      return Number.isInteger(v) ? String(v) : v.toPrecision(17).replace(/\.?0+$/, '').replace(/\.?0+e/, 'e');
    }
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return "X'" + Array.from(v).map((b) => b.toString(16).padStart(2, '0')).join('') + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  M.tipos = {
    CHARSETS, COLACIONES, ENTEROS, TEXTOS, BLOBS,
    esEntero, esNumerico, esCadena, esBinario, esTemporal, tieneCharset,
    resolverCharset, normalizarCharset, normalizarColacion, distingueMayusculas,
    normalizarTipo, textoTipo, tipoSQLite,
    convertir, mostrarValor, formatoDecimal, formatoGeneral, formatoFloat, literalSQLite, leerNumero, redondearTexto,
    leerFechaHora, fechaValida, bytesTexto, desplazarFecha, zona: 0,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
