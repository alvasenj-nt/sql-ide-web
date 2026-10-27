'use strict';
// Traducción de expresiones y consultas de MySQL a SQLite. Resuelve los
// nombres contra el diccionario de datos (con los errores de MySQL) e
// infiere el tipo de cada resultado para mostrarlo como lo haría MySQL
// (escala de los decimales, enteros, fechas).
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const T = M.tipos;
  const C = M.catalogo;

  const TIPO_ENTERO = { base: 'bigint' };
  const TIPO_DOBLE = { base: 'double' };
  const TIPO_TEXTO = { base: 'varchar', longitud: 65535, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' };
  const TIPO_FECHA = { base: 'date' };
  const TIPO_FECHAHORA = { base: 'datetime', fsp: 0 };
  const TIPO_HORA = { base: 'time', fsp: 0 };
  const TIPO_NULO = { base: 'null' };
  const decimal = (s) => ({ base: 'decimal', p: 65, s: Math.min(s, 30) });

  const id = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const textoSQL = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const codificar = (s) => String(s).replace(/[\^]|\p{Lu}/gu, (c) => (c === '^' ? '^^' : '^' + c.toLowerCase()));
  const decodificar = (s) => s.replace(/\^(.)/gu, (_, c) => (c === '^' ? '^' : c.toUpperCase()));
  const nombreSQLite = (bd, nombre) => codificar(bd) + '.' + codificar(nombre);
  const nombreTablaSQL = (bd, nombre) => id(nombreSQLite(bd, nombre));
  // Base de datos y tabla a partir del nombre en SQLite
  function tablaDeSQLite(s) {
    const punto = s.indexOf('.');
    return { bd: decodificar(s.slice(0, punto)), nombre: decodificar(s.slice(punto + 1)) };
  }

  function clase(t) {
    if (!t || t.base === 'null') return 'nulo';
    if (T.esEntero(t)) return 'entero';
    if (t.base === 'decimal') return 'decimal';
    if (t.base === 'float' || t.base === 'double') return 'doble';
    if (T.esTemporal(t)) return 'fecha';
    return 'texto';
  }
  const escala = (t) => (clase(t) === 'decimal' ? t.s : 0);
  const esTexto = (t) => clase(t) === 'texto';
  const colacionTexto = (t) => (t && t.collation && T.distingueMayusculas(t.collation) ? 'BINARY' : 'NOCASE');

  // Funciones que MySQL no permite en CHECK
  const NO_DETERMINISTAS = new Set(['NOW', 'CURDATE', 'CURRENT_DATE', 'CURTIME', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
    'LOCALTIME', 'LOCALTIMESTAMP', 'SYSDATE', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'UNIX_TIMESTAMP', 'RAND', 'UUID',
    'UUID_SHORT', 'USER', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER', 'DATABASE', 'SCHEMA', 'VERSION',
    'CONNECTION_ID', 'LAST_INSERT_ID', 'ROW_COUNT', 'FOUND_ROWS', 'GET_LOCK', 'SLEEP', 'BENCHMARK']);

  const AGREGADOS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STD', 'STDDEV', 'STDDEV_POP',
    'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG']);

  // Funciones de MySQL que el laboratorio todavía no traduce: se avisa en
  // lugar de dar el error 1305 de función inexistente
  const CONOCIDAS = new Set(('ASCII BIN BIT_LENGTH CHAR ELT EXPORT_SET FIELD FIND_IN_SET FORMAT FROM_BASE64 HEX INSERT '
    + 'LOAD_FILE MAKE_SET MATCH OCT ORD QUOTE REGEXP_INSTR REGEXP_LIKE REGEXP_REPLACE REGEXP_SUBSTR SOUNDEX SPACE '
    + 'STRCMP SUBSTRING_INDEX TO_BASE64 UNHEX WEIGHT_STRING ACOS ASIN ATAN ATAN2 CONV COS COT CRC32 DEGREES EXP LN '
    + 'LOG LOG10 LOG2 RADIANS SIN TAN ADDTIME CONVERT_TZ DATE_FORMAT FROM_DAYS FROM_UNIXTIME GET_FORMAT MAKEDATE '
    + 'MAKETIME MICROSECOND PERIOD_ADD PERIOD_DIFF SEC_TO_TIME STR_TO_DATE SUBTIME TIME_FORMAT TIME_TO_SEC TIMEDIFF '
    + 'TIMESTAMP TIMESTAMPADD TO_DAYS TO_SECONDS UNIX_TIMESTAMP WEEK WEEKOFYEAR YEARWEEK JSON_EXTRACT JSON_OBJECT '
    + 'JSON_ARRAY JSON_CONTAINS JSON_UNQUOTE JSON_SET JSON_LENGTH JSON_KEYS JSON_VALID AES_ENCRYPT AES_DECRYPT MD5 '
    + 'SHA1 SHA2 SHA RANDOM_BYTES UUID UUID_SHORT BENCHMARK SLEEP GET_LOCK RELEASE_LOCK INET_ATON INET_NTOA '
    + 'ANY_VALUE GROUPING DEFAULT VALUES NAME_CONST FOUND_ROWS ICU_VERSION CHARSET COLLATION COERCIBILITY '
    + 'STD STDDEV STDDEV_POP STDDEV_SAMP VARIANCE VAR_POP VAR_SAMP BIT_AND BIT_OR BIT_XOR JSON_ARRAYAGG '
    + 'JSON_OBJECTAGG').split(' '));

  // ---------- resolución de nombres ----------

  // Un ámbito es el FROM de una consulta: { fuentes, padre, aliasSelect }
  // Cada fuente: { alias, bd, nombre, columnas: [{ nombre, tipo }], sql }
  function buscarColumna(fuente, nombre) {
    const n = nombre.toLowerCase();
    return fuente.columnas.find((c) => c.nombre.toLowerCase() === n) || null;
  }

  function resolverColumna(partes, ctx) {
    const nombre = partes[partes.length - 1];
    const textoCompleto = partes.join('.');
    const clausula = ctx.clausula || 'field list';
    for (let ambito = ctx.ambito; ambito; ambito = ambito.padre) {
      if (partes.length === 1) {
        const hallados = [];
        ambito.fuentes.forEach((f) => {
          const c = buscarColumna(f, nombre);
          if (c && !f.ocultas?.has(nombre.toLowerCase())) hallados.push({ f, c });
        });
        if (hallados.length > 1 && !ambito.comunes?.has(nombre.toLowerCase())) {
          throw new ErrorSQL(1052, '23000', "Column '" + nombre + "' in " + clausula + ' is ambiguous');
        }
        if (hallados.length) {
          const { f, c } = hallados[0];
          return { sql: f.sql ? f.sql + '.' + id(c.nombre) : id(c.nombre), tipo: c.tipo, columna: c, fuente: f };
        }
        if (ambito.aliasSelect && ambito.aliasSelect.has(nombre.toLowerCase())) {
          const a = ambito.aliasSelect.get(nombre.toLowerCase());
          return { sql: id(a.nombre), tipo: a.tipo };
        }
      } else {
        const tabla = partes[partes.length - 2];
        const bd = partes.length === 3 ? partes[0] : null;
        const f = ambito.fuentes.find((x) => (x.alias === tabla || (!x.conAlias && x.nombre === tabla)) && (!bd || x.bd === bd));
        if (f) {
          const c = buscarColumna(f, nombre);
          if (!c) throw new ErrorSQL(1054, '42S22', "Unknown column '" + textoCompleto + "' in '" + clausula + "'");
          return { sql: (f.sql || id(f.alias)) + '.' + id(c.nombre), tipo: c.tipo, columna: c, fuente: f };
        }
      }
      if (ctx.sinCorrelacion) break;
    }
    throw new ErrorSQL(1054, '42S22', "Unknown column '" + textoCompleto + "' in '" + clausula + "'");
  }

  // ---------- expresiones ----------

  function tipoLiteralNumero(v) {
    if (/^-?\d+$/.test(v)) return TIPO_ENTERO;
    if (/[eE]/.test(v)) return TIPO_DOBLE;
    return decimal((v.split('.')[1] || '').length);
  }

  function aritmetica(op, ta, tb) {
    const ca = clase(ta);
    const cb = clase(tb);
    if (ca === 'nulo' || cb === 'nulo') return op === '/' ? decimal(4) : TIPO_NULO;
    const dobles = ca === 'doble' || cb === 'doble' || ca === 'texto' || cb === 'texto' || ca === 'fecha' || cb === 'fecha';
    if (op === 'DIV') return TIPO_ENTERO;
    if (dobles) return TIPO_DOBLE;
    if (op === '/') return decimal(escala(ta) + 4);
    if (ca === 'entero' && cb === 'entero') return TIPO_ENTERO;
    if (op === '*') return decimal(escala(ta) + escala(tb));
    return decimal(Math.max(escala(ta), escala(tb)));
  }

  function traducir(e, ctx) {
    const tr = (x, c) => traducir(x, c || ctx);
    switch (e.t) {
      case 'num': {
        const v = e.v;
        return { sql: /^-/.test(v) ? '(' + v + ')' : v, tipo: tipoLiteralNumero(v), literal: v };
      }
      case 'str': return { sql: textoSQL(e.v), tipo: TIPO_TEXTO };
      case 'null': return { sql: 'NULL', tipo: TIPO_NULO };
      case 'bool': return { sql: e.v ? '1' : '0', tipo: TIPO_ENTERO };
      case 'hex':
        if (e.v !== null && e.v !== undefined) return { sql: "X'" + e.v + "'", tipo: { base: 'varbinary', longitud: e.v.length / 2 } };
        return { sql: String(parseInt(e.bits || '0', 2)), tipo: TIPO_ENTERO };
      case 'bitlit': return { sql: String(parseInt(e.v || '0', 2)), tipo: TIPO_ENTERO };
      case 'literalTipado': {
        const tipo = e.tipo === 'DATE' ? TIPO_FECHA : e.tipo === 'TIME' ? TIPO_HORA : TIPO_FECHAHORA;
        return { sql: textoSQL(e.v), tipo };
      }
      case 'col': {
        if (ctx.enCheck) {
          const col = C.columna(ctx.enCheck.tabla, e.partes[e.partes.length - 1]);
          if (!col) {
            throw new ErrorSQL(3820, 'HY000', "Check constraint '" + ctx.enCheck.nombre + "' refers to non-existing column '"
              + e.partes[e.partes.length - 1] + "'.");
          }
          if (col.autoInc) throw new ErrorSQL(3818, 'HY000', "Check constraint '" + ctx.enCheck.nombre + "' cannot refer to an auto-increment column.");
          return { sql: id(col.nombre), tipo: col.tipo, columna: col };
        }
        if (ctx.sinColumnas) throw new ErrorSQL(1054, '42S22', "Unknown column '" + e.partes.join('.') + "' in '" + (ctx.clausula || 'field list') + "'");
        const r = resolverColumna(e.partes, ctx);
        if (ctx.usadas && r.fuente && ctx.ambito.fuentes.includes(r.fuente)) ctx.usadas.push({ fuente: r.fuente, columna: r.columna, agregada: !!ctx.dentroAgregado });
        return r;
      }
      case 'par': {
        const a = tr(e.a);
        return { sql: '(' + a.sql + ')', tipo: a.tipo };
      }
      case 'fila': {
        const partes = e.lista.map((x) => tr(x));
        return { sql: '(' + partes.map((p) => p.sql).join(', ') + ')', tipo: TIPO_ENTERO, fila: true };
      }
      case 'bin': return binaria(e, ctx);
      case 'un': {
        const a = tr(e.a);
        if (e.op === 'NOT') return { sql: '(NOT ' + a.sql + ')', tipo: TIPO_ENTERO };
        if (e.op === '-') return { sql: '(-' + a.sql + ')', tipo: clase(a.tipo) === 'texto' ? TIPO_DOBLE : a.tipo };
        return { sql: '(~' + a.sql + ')', tipo: TIPO_ENTERO };
      }
      case 'esNulo': return { sql: '(' + tr(e.a).sql + (e.neg ? ' IS NOT NULL)' : ' IS NULL)'), tipo: TIPO_ENTERO };
      case 'esValor': return { sql: '(' + tr(e.a).sql + ' IS ' + (e.neg ? 'NOT ' : '') + (e.valor ? 'TRUE' : 'FALSE') + ')', tipo: TIPO_ENTERO };
      case 'entre': {
        const a = tr(e.a);
        const b = tr(e.b);
        const c = tr(e.c);
        const [x, y] = comparables(a, b);
        const [, z] = comparables(a, c);
        return { sql: '(' + x + (e.neg ? ' NOT' : '') + ' BETWEEN ' + y + ' AND ' + z + ')', tipo: TIPO_ENTERO };
      }
      case 'en': {
        const a = tr(e.a);
        if (e.consulta) {
          const sub = traducirConsulta(e.consulta, ctx.srv, ctx.ambito);
          const col = esTexto(a.tipo) ? ' COLLATE NOCASE' : '';
          return { sql: '(' + a.sql + col + (e.neg ? ' NOT' : '') + ' IN (' + sub.sql + '))', tipo: TIPO_ENTERO };
        }
        const lista = e.lista.map((x) => tr(x));
        if (lista.length && esTexto(a.tipo) && lista.every((x) => esTexto(x.tipo))) {
          const pares = lista.map((x) => comparables(a, x));
          return { sql: '(' + pares[0][0] + (e.neg ? ' NOT' : '') + ' IN (' + pares.map((p) => p[1]).join(', ') + '))', tipo: TIPO_ENTERO };
        }
        return { sql: '(' + a.sql + (e.neg ? ' NOT' : '') + ' IN (' + lista.map((x) => x.sql).join(', ') + '))', tipo: TIPO_ENTERO };
      }
      case 'como': {
        const a = tr(e.a);
        const p = tr(e.patron);
        const escape = e.escape ? tr(e.escape).sql : "'\\'";
        const col = colacionComparacion(a, p);
        if (T.distingueMayusculas(col)) {
          return { sql: '(' + (e.neg ? 'NOT ' : '') + 'mysql_like_bin(' + a.sql + ', ' + p.sql + ', ' + escape + '))', tipo: TIPO_ENTERO };
        }
        const f = sinAcentos(col) ? (conEnye(col) ? 'mysql_ai_es' : 'mysql_ai') : '';
        return { sql: '(' + f + '(' + a.sql + ')' + (e.neg ? ' NOT' : '') + ' LIKE ' + f + '(' + p.sql + ') ESCAPE ' + escape + ')', tipo: TIPO_ENTERO };
      }
      case 'regexp': {
        const a = tr(e.a);
        const p = tr(e.patron);
        return { sql: '(' + (e.neg ? 'NOT ' : '') + 'mysql_regexp(' + p.sql + ', ' + a.sql + '))', tipo: TIPO_ENTERO };
      }
      case 'caso': {
        let tipo = null;
        const partes = e.cuandos.map((w) => {
          const r = tr(w.r);
          if (!tipo && r.tipo.base !== 'null') tipo = r.tipo;
          return 'WHEN ' + tr(w.c).sql + ' THEN ' + r.sql;
        });
        let sino = '';
        if (e.sino) {
          const s = tr(e.sino);
          if (!tipo && s.tipo.base !== 'null') tipo = s.tipo;
          sino = ' ELSE ' + s.sql;
        }
        return { sql: '(CASE ' + (e.base ? tr(e.base).sql + ' ' : '') + partes.join(' ') + sino + ' END)', tipo: tipo || TIPO_NULO };
      }
      case 'sub': {
        if (ctx.enCheck) throw new ErrorSQL(3815, 'HY000', "An expression of a check constraint '" + ctx.enCheck.nombre + "' contains disallowed function.");
        const sub = traducirConsulta(e.consulta, ctx.srv, ctx.ambito);
        if (sub.columnas.length !== 1) throw new ErrorSQL(1241, '21000', 'Operand should contain 1 column(s)');
        return { sql: '(' + sub.sql + ')', tipo: sub.columnas[0].tipo };
      }
      case 'existe': {
        const sub = traducirConsulta(e.consulta, ctx.srv, ctx.ambito);
        return { sql: '(EXISTS (' + sub.sql + '))', tipo: TIPO_ENTERO };
      }
      case 'cuantificada': throw new NoDisponible('comparaciones con ANY, SOME o ALL');
      case 'var': {
        if (ctx.enCheck) throw new ErrorSQL(3816, 'HY000', "An expression of a check constraint '" + ctx.enCheck.nombre + "' cannot refer to a user or system variable.");
        const v = ctx.srv.variables.has(e.nombre) ? ctx.srv.variables.get(e.nombre) : null;
        return { sql: T.literalSQLite(v), tipo: v === null ? TIPO_NULO : typeof v === 'number' ? (Number.isInteger(v) ? TIPO_ENTERO : TIPO_DOBLE) : TIPO_TEXTO };
      }
      case 'varSistema': {
        if (ctx.enCheck) throw new ErrorSQL(3816, 'HY000', "An expression of a check constraint '" + ctx.enCheck.nombre + "' cannot refer to a user or system variable.");
        const v = ctx.srv.variableSistema(e.nombre);
        return { sql: T.literalSQLite(v), tipo: typeof v === 'number' ? TIPO_ENTERO : TIPO_TEXTO };
      }
      case 'colacion': {
        const a = tr(e.a);
        const col = T.normalizarColacion(e.colacion);
        return { sql: '(' + a.sql + ' COLLATE ' + (T.distingueMayusculas(col) ? 'BINARY' : 'NOCASE') + ')', tipo: Object.assign({}, a.tipo, { collation: col }), explicita: true };
      }
      case 'binario': {
        const a = tr(e.a);
        return { sql: '(' + a.sql + ' COLLATE BINARY)', tipo: a.tipo };
      }
      case 'func': return funcion(e, ctx);
      case 'intervalo': throw new ErrorSQL(1064, '42000', 'You have an error in your SQL syntax; INTERVAL is only valid in date arithmetic');
      case 'estrella': throw new ErrorSQL(1064, '42000', "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '*'");
      case 'defecto': throw new ErrorSQL(1064, '42000', "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'DEFAULT'");
      default: throw new NoDisponible('expresión ' + e.t);
    }
  }

  // Colación con que MySQL compara dos operandos: la de la columna si hay
  // una; si no, la de la conexión (utf8mb4_0900_ai_ci)
  function colacionComparacion(a, b) {
    // Prioridad de MySQL: COLLATE explícito, después la columna
    const t = a.explicita ? a.tipo : b.explicita ? b.tipo : a.columna ? a.tipo : b.columna ? b.tipo : a.tipo;
    return (t && t.collation) || 'utf8mb4_0900_ai_ci';
  }
  const sinAcentos = (col) => !T.distingueMayusculas(col) && !/_as_/.test(col);
  const conEnye = (col) => /spanish|_es_/.test(col);

  // Operandos de una comparación de cadenas con la semántica de su colación:
  // sin distinguir mayúsculas ni acentos (ai_ci), solo mayúsculas (as_ci)
  // o byte a byte (_bin, _cs)
  function comparables(a, b) {
    if (!(esTexto(a.tipo) && esTexto(b.tipo))) return [a.sql, b.sql];
    const col = colacionComparacion(a, b);
    if (T.distingueMayusculas(col)) return [a.sql + ' COLLATE BINARY', b.sql];
    if (sinAcentos(col)) {
      const f = conEnye(col) ? 'mysql_ai_es' : 'mysql_ai';
      return [f + '(' + a.sql + ')', f + '(' + b.sql + ')'];
    }
    return [a.sql + ' COLLATE NOCASE', b.sql];
  }

  function binaria(e, ctx) {
    const a = traducir(e.a, ctx);
    const b = traducir(e.b, ctx);
    switch (e.op) {
      case 'AND': return { sql: '(' + a.sql + ' AND ' + b.sql + ')', tipo: TIPO_ENTERO };
      case 'OR': return { sql: '(' + a.sql + ' OR ' + b.sql + ')', tipo: TIPO_ENTERO };
      case 'XOR': return { sql: '(((' + a.sql + ') AND NOT (' + b.sql + ')) OR (NOT (' + a.sql + ') AND (' + b.sql + ')))', tipo: TIPO_ENTERO };
      case '=': case '<>': case '<': case '<=': case '>': case '>=': case '<=>': {
        const op = e.op === '<=>' ? ' IS ' : ' ' + e.op + ' ';
        const [x, y] = comparables(a, b);
        return { sql: '(' + x + op + y + ')', tipo: TIPO_ENTERO };
      }
      case '+': case '-': case '*':
        return { sql: '(' + a.sql + ' ' + e.op + ' ' + b.sql + ')', tipo: aritmetica(e.op, a.tipo, b.tipo) };
      case '/': return { sql: '(CAST(' + a.sql + ' AS REAL) / ' + b.sql + ')', tipo: aritmetica('/', a.tipo, b.tipo) };
      case 'DIV': return { sql: 'CAST(CAST(' + a.sql + ' AS REAL) / ' + b.sql + ' AS INTEGER)', tipo: TIPO_ENTERO };
      case '%': return { sql: 'mysql_mod(' + a.sql + ', ' + b.sql + ')', tipo: aritmetica('%', a.tipo, b.tipo) };
      case '|': case '&': case '<<': case '>>': return { sql: '(' + a.sql + ' ' + e.op + ' ' + b.sql + ')', tipo: TIPO_ENTERO };
      case '^': return { sql: '((' + a.sql + ' | ' + b.sql + ') - (' + a.sql + ' & ' + b.sql + '))', tipo: TIPO_ENTERO };
      default: throw new NoDisponible('operador ' + e.op);
    }
  }

  const UNIDADES_SQLITE = { SECOND: 'seconds', MINUTE: 'minutes', HOUR: 'hours', DAY: 'days', MONTH: 'months', YEAR: 'years' };

  function funcion(e, ctx) {
    const n = e.nombre;
    if (ctx.enCheck && NO_DETERMINISTAS.has(n)) {
      throw new ErrorSQL(3814, 'HY000', "An expression of a check constraint '" + ctx.enCheck.nombre + "' contains disallowed function: " + n.toLowerCase() + '.');
    }
    if (AGREGADOS.has(n)) {
      if (ctx.enCheck) throw new ErrorSQL(3814, 'HY000', "An expression of a check constraint '" + ctx.enCheck.nombre + "' contains disallowed function: " + n.toLowerCase() + '.');
      if (ctx.sinAgregados) throw new ErrorSQL(1111, 'HY000', 'Invalid use of group function');
      if (ctx.marcas) ctx.marcas.agregado = true;
      return agregado(e, Object.assign({}, ctx, { sinAgregados: true, dentroAgregado: true }));
    }
    const args = e.args.map((x) => (x.t === 'intervalo' ? x : traducir(x, ctx)));
    const s = (i) => args[i].sql;
    const aridad = (min, max = min) => {
      if (args.length < min || args.length > max) {
        throw new ErrorSQL(1582, '42000', "Incorrect parameter count in the call to native function '" + n.toLowerCase() + "'");
      }
    };
    const fecha = (i) => 'mysql_fecha(' + s(i) + ')';
    switch (n) {
      case 'CONCAT':
        if (!args.length) aridad(1);
        return { sql: '(' + args.map((a) => a.sql).join(' || ') + ')', tipo: TIPO_TEXTO };
      case 'CONCAT_WS': aridad(2, 999); return { sql: 'concat_ws(' + args.map((a) => a.sql).join(', ') + ')', tipo: TIPO_TEXTO };
      case 'UPPER': case 'UCASE': aridad(1); return { sql: 'mysql_upper(' + s(0) + ')', tipo: TIPO_TEXTO };
      case 'LOWER': case 'LCASE': aridad(1); return { sql: 'mysql_lower(' + s(0) + ')', tipo: TIPO_TEXTO };
      case 'LENGTH': case 'OCTET_LENGTH': aridad(1); return { sql: 'octet_length(' + s(0) + ')', tipo: TIPO_ENTERO };
      case 'CHAR_LENGTH': case 'CHARACTER_LENGTH': aridad(1); return { sql: 'length(' + s(0) + ')', tipo: TIPO_ENTERO };
      case 'SUBSTRING': case 'SUBSTR': case 'MID':
        aridad(2, 3);
        return { sql: 'mysql_substr(' + args.map((a) => a.sql).join(', ') + ')', tipo: TIPO_TEXTO };
      case 'LEFT': aridad(2); return { sql: 'substr(' + s(0) + ', 1, ' + s(1) + ')', tipo: TIPO_TEXTO };
      case 'RIGHT': aridad(2); return { sql: 'mysql_right(' + s(0) + ', ' + s(1) + ')', tipo: TIPO_TEXTO };
      case 'TRIM':
        if (e.quitar) {
          const q = traducir(e.quitar, ctx).sql;
          const f = e.modoTrim === 'LEADING' ? 'mysql_ltrim_cadena' : e.modoTrim === 'TRAILING' ? 'mysql_rtrim_cadena' : 'mysql_trim_cadena';
          return { sql: f + '(' + s(0) + ', ' + q + ')', tipo: TIPO_TEXTO };
        }
        return { sql: (e.modoTrim === 'LEADING' ? 'ltrim(' : e.modoTrim === 'TRAILING' ? 'rtrim(' : 'trim(') + s(0) + ", ' ')", tipo: TIPO_TEXTO };
      case 'LTRIM': aridad(1); return { sql: 'ltrim(' + s(0) + ", ' ')", tipo: TIPO_TEXTO };
      case 'RTRIM': aridad(1); return { sql: 'rtrim(' + s(0) + ", ' ')", tipo: TIPO_TEXTO };
      case 'REPLACE': aridad(3); return { sql: 'replace(' + s(0) + ', ' + s(1) + ', ' + s(2) + ')', tipo: TIPO_TEXTO };
      case 'REVERSE': aridad(1); return { sql: 'mysql_reverse(' + s(0) + ')', tipo: TIPO_TEXTO };
      case 'REPEAT': aridad(2); return { sql: 'mysql_repeat(' + s(0) + ', ' + s(1) + ')', tipo: TIPO_TEXTO };
      case 'LPAD': aridad(3); return { sql: 'mysql_lpad(' + s(0) + ', ' + s(1) + ', ' + s(2) + ')', tipo: TIPO_TEXTO };
      case 'RPAD': aridad(3); return { sql: 'mysql_rpad(' + s(0) + ', ' + s(1) + ', ' + s(2) + ')', tipo: TIPO_TEXTO };
      case 'LOCATE':
        aridad(2, 3);
        return { sql: 'mysql_locate(' + args.map((a) => a.sql).join(', ') + ')', tipo: TIPO_ENTERO };
      case 'INSTR': aridad(2); return { sql: 'instr(' + s(0) + ', ' + s(1) + ')', tipo: TIPO_ENTERO };
      case 'ABS': aridad(1); return { sql: 'abs(' + s(0) + ')', tipo: args[0].tipo };
      case 'SIGN': aridad(1); return { sql: 'sign(' + s(0) + ')', tipo: TIPO_ENTERO };
      case 'CEIL': case 'CEILING': aridad(1); return { sql: 'CAST(ceil(' + s(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'FLOOR': aridad(1); return { sql: 'CAST(floor(' + s(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'ROUND': {
        aridad(1, 2);
        const d = args[1] ? Number(args[1].literal || 0) : 0;
        const tipo = clase(args[0].tipo) === 'doble' ? TIPO_DOBLE : d > 0 ? decimal(d) : TIPO_ENTERO;
        return { sql: 'mysql_round(' + s(0) + ', ' + (args[1] ? s(1) : '0') + ')', tipo };
      }
      case 'TRUNCATE': {
        aridad(2);
        const d = Number(args[1].literal || 0);
        return { sql: 'mysql_truncate(' + s(0) + ', ' + s(1) + ')', tipo: clase(args[0].tipo) === 'doble' ? TIPO_DOBLE : d > 0 ? decimal(d) : TIPO_ENTERO };
      }
      case 'MOD': aridad(2); return { sql: 'mysql_mod(' + s(0) + ', ' + s(1) + ')', tipo: aritmetica('%', args[0].tipo, args[1].tipo) };
      case 'POW': case 'POWER': aridad(2); return { sql: 'pow(' + s(0) + ', ' + s(1) + ')', tipo: TIPO_DOBLE };
      case 'SQRT': aridad(1); return { sql: 'sqrt(' + s(0) + ')', tipo: TIPO_DOBLE };
      case 'PI': aridad(0); return { sql: 'pi()', tipo: decimal(6) };
      case 'GREATEST': case 'LEAST':
        aridad(2, 999);
        return { sql: (n === 'GREATEST' ? 'max(' : 'min(') + args.map((a) => a.sql).join(', ') + ')', tipo: args[0].tipo };
      case 'IFNULL': aridad(2); return { sql: 'ifnull(' + s(0) + ', ' + s(1) + ')', tipo: args[0].tipo.base !== 'null' ? args[0].tipo : args[1].tipo };
      case 'NULLIF': aridad(2); return { sql: 'nullif(' + s(0) + ', ' + s(1) + ')', tipo: args[0].tipo };
      case 'COALESCE':
        aridad(1, 999);
        return { sql: (args.length === 1 ? 'ifnull(' + s(0) + ', NULL)' : 'coalesce(' + args.map((a) => a.sql).join(', ') + ')'),
          tipo: (args.find((a) => a.tipo.base !== 'null') || args[0]).tipo };
      case 'IF': aridad(3); return { sql: '(CASE WHEN ' + s(0) + ' THEN ' + s(1) + ' ELSE ' + s(2) + ' END)', tipo: args[1].tipo.base !== 'null' ? args[1].tipo : args[2].tipo };
      case 'ISNULL': aridad(1); return { sql: '(' + s(0) + ' IS NULL)', tipo: TIPO_ENTERO };
      case 'UTC_TIMESTAMP': return { sql: "strftime('%Y-%m-%d %H:%M:%S', 'now')", tipo: TIPO_FECHAHORA };
      case 'NOW': case 'CURRENT_TIMESTAMP': case 'LOCALTIME': case 'LOCALTIMESTAMP': case 'SYSDATE':
        return { sql: "strftime('%Y-%m-%d %H:%M:%S', 'now', '" + ctx.srv.modificadorZona() + "')", tipo: TIPO_FECHAHORA };
      case 'CURDATE': case 'CURRENT_DATE': return { sql: "date('now', '" + ctx.srv.modificadorZona() + "')", tipo: TIPO_FECHA };
      case 'CURTIME': case 'CURRENT_TIME': return { sql: "time('now', '" + ctx.srv.modificadorZona() + "')", tipo: TIPO_HORA };
      case 'UTC_DATE': return { sql: "date('now')", tipo: TIPO_FECHA };
      case 'UTC_TIME': return { sql: "time('now')", tipo: TIPO_HORA };
      case 'DATE': aridad(1); return { sql: 'date(' + fecha(0) + ')', tipo: TIPO_FECHA };
      case 'TIME': aridad(1); return { sql: 'time(' + fecha(0) + ')', tipo: TIPO_HORA };
      case 'YEAR': aridad(1); return { sql: "CAST(strftime('%Y', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'MONTH': aridad(1); return { sql: "CAST(strftime('%m', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'DAY': case 'DAYOFMONTH': aridad(1); return { sql: "CAST(strftime('%d', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'HOUR': aridad(1); return { sql: "CAST(strftime('%H', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'MINUTE': aridad(1); return { sql: "CAST(strftime('%M', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'SECOND': aridad(1); return { sql: "CAST(strftime('%S', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'DAYOFWEEK': aridad(1); return { sql: "(CAST(strftime('%w', " + fecha(0) + ') AS INTEGER) + 1)', tipo: TIPO_ENTERO };
      case 'WEEKDAY': aridad(1); return { sql: "((CAST(strftime('%w', " + fecha(0) + ') AS INTEGER) + 6) % 7)', tipo: TIPO_ENTERO };
      case 'DAYOFYEAR': aridad(1); return { sql: "CAST(strftime('%j', " + fecha(0) + ') AS INTEGER)', tipo: TIPO_ENTERO };
      case 'QUARTER': aridad(1); return { sql: "((CAST(strftime('%m', " + fecha(0) + ') AS INTEGER) + 2) / 3)', tipo: TIPO_ENTERO };
      case 'DAYNAME': aridad(1); return { sql: 'mysql_dayname(' + fecha(0) + ')', tipo: TIPO_TEXTO };
      case 'MONTHNAME': aridad(1); return { sql: 'mysql_monthname(' + fecha(0) + ')', tipo: TIPO_TEXTO };
      case 'LAST_DAY': aridad(1); return { sql: "date(" + fecha(0) + ", 'start of month', '+1 month', '-1 day')", tipo: TIPO_FECHA };
      case 'DATEDIFF': aridad(2); return { sql: 'CAST(julianday(date(' + fecha(0) + ')) - julianday(date(' + fecha(1) + ')) AS INTEGER)', tipo: TIPO_ENTERO };
      case 'TIMESTAMPDIFF': {
        aridad(3);
        const unidad = e.args[0].t === 'col' ? e.args[0].partes[0].toUpperCase() : '';
        return { sql: "mysql_timestampdiff('" + unidad + "', " + fecha(1) + ', ' + fecha(2) + ')', tipo: TIPO_ENTERO };
      }
      case 'DATE_ADD': case 'DATE_SUB': case 'ADDDATE': case 'SUBDATE': {
        aridad(2);
        const resta = n === 'DATE_SUB' || n === 'SUBDATE';
        let cantidad;
        let unidad;
        if (args[1].t === 'intervalo') {
          cantidad = traducir(args[1].valor, ctx).sql;
          unidad = args[1].unidad;
        } else {
          cantidad = s(1);
          unidad = 'DAY';
        }
        let modificador;
        if (unidad === 'WEEK') { cantidad = '(' + cantidad + ') * 7'; unidad = 'DAY'; }
        if (unidad === 'QUARTER') { cantidad = '(' + cantidad + ') * 3'; unidad = 'MONTH'; }
        if (!UNIDADES_SQLITE[unidad]) throw new NoDisponible('INTERVAL ' + unidad);
        modificador = "(CASE WHEN " + (resta ? '-' : '') + '(' + cantidad + ") >= 0 THEN '+' ELSE '' END || " + (resta ? '-' : '') + '(' + cantidad + ") || ' " + UNIDADES_SQLITE[unidad] + "')";
        const soloFecha = args[0].tipo.base === 'date' && ['DAY', 'MONTH', 'YEAR'].includes(unidad);
        return { sql: 'mysql_fecha_resultado(' + (soloFecha ? 'date(' : "strftime('%Y-%m-%d %H:%M:%S', ") + fecha(0) + ', ' + modificador + '), ' + (soloFecha ? 1 : 0) + ')',
          tipo: soloFecha ? TIPO_FECHA : TIPO_FECHAHORA };
      }
      case 'DATE_FORMAT': aridad(2); return { sql: 'mysql_date_format(' + fecha(0) + ', ' + s(1) + ')', tipo: TIPO_TEXTO };
      case 'CAST': return conversion(e, args[0]);
      case 'CONVERT': return { sql: s(0), tipo: args[0].tipo };
      case 'DATABASE': case 'SCHEMA':
        aridad(0);
        return { sql: T.literalSQLite(ctx.srv.bdActual), tipo: TIPO_TEXTO };
      case 'VERSION': aridad(0); return { sql: textoSQL(ctx.srv.variableSistema('version')), tipo: TIPO_TEXTO };
      case 'USER': case 'CURRENT_USER': case 'SESSION_USER': case 'SYSTEM_USER':
        return { sql: textoSQL('root@localhost'), tipo: TIPO_TEXTO };
      case 'CONNECTION_ID': return { sql: '8', tipo: TIPO_ENTERO };
      case 'LAST_INSERT_ID': aridad(0); return { sql: String(ctx.srv.ultimoId), tipo: TIPO_ENTERO };
      case 'ROW_COUNT': aridad(0); return { sql: String(ctx.srv.filasUltima), tipo: TIPO_ENTERO };
      default:
        if (CONOCIDAS.has(n)) throw new NoDisponible('la función ' + n);
        throw new ErrorSQL(1305, '42000', 'FUNCTION ' + (ctx.srv.bdActual ? ctx.srv.bdActual + '.' : '') + n.toLowerCase() + ' does not exist');
    }
  }

  function conversion(e, a) {
    const d = e.tipoDestino;
    switch (d.base) {
      case 'signed': case 'unsigned': return { sql: 'mysql_entero(' + a.sql + ')', tipo: TIPO_ENTERO };
      case 'char': return { sql: 'CAST(' + a.sql + ' AS TEXT)', tipo: TIPO_TEXTO };
      case 'decimal': return { sql: 'mysql_round(CAST(' + a.sql + ' AS REAL), ' + d.s + ')', tipo: { base: 'decimal', p: d.p, s: d.s } };
      case 'double': return { sql: 'CAST(' + a.sql + ' AS REAL)', tipo: TIPO_DOBLE };
      case 'date': return { sql: 'date(mysql_fecha(' + a.sql + '))', tipo: TIPO_FECHA };
      case 'datetime': return { sql: "strftime('%Y-%m-%d %H:%M:%S', mysql_fecha(" + a.sql + '))', tipo: TIPO_FECHAHORA };
      case 'time': return { sql: 'time(mysql_fecha(' + a.sql + '))', tipo: TIPO_HORA };
      default: throw new NoDisponible('CAST AS ' + d.base.toUpperCase());
    }
  }

  function agregado(e, ctx) {
    const n = e.nombre;
    if (n === 'COUNT') {
      if (e.estrella) return { sql: 'count(*)', tipo: TIPO_ENTERO, agregado: true };
      if (e.args.length !== 1 && !e.distinto) throw new ErrorSQL(1064, '42000', "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near ')'");
      if (e.args.length > 1) throw new NoDisponible('COUNT(DISTINCT) con varias columnas');
      const a = traducir(e.args[0], ctx);
      return { sql: 'count(' + (e.distinto ? 'DISTINCT ' : '') + a.sql + ')', tipo: TIPO_ENTERO, agregado: true };
    }
    if (e.estrella) throw new ErrorSQL(1064, '42000', "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '*)'");
    const a = traducir(e.args[0], ctx);
    const d = e.distinto ? 'DISTINCT ' : '';
    switch (n) {
      case 'SUM': {
        const c = clase(a.tipo);
        return { sql: 'sum(' + d + a.sql + ')', tipo: c === 'doble' || c === 'texto' ? TIPO_DOBLE : decimal(escala(a.tipo)), agregado: true };
      }
      case 'AVG': {
        const c = clase(a.tipo);
        return { sql: 'avg(' + d + a.sql + ')', tipo: c === 'doble' || c === 'texto' ? TIPO_DOBLE : decimal(escala(a.tipo) + 4), agregado: true };
      }
      case 'MIN': case 'MAX': return { sql: n.toLowerCase() + '(' + d + a.sql + ')', tipo: a.tipo, agregado: true };
      case 'GROUP_CONCAT': {
        const sep = e.separador !== undefined ? textoSQL(e.separador) : "','";
        const expr = e.args.length > 1 ? '(' + e.args.map((x) => traducir(x, ctx).sql).join(' || ') + ')' : a.sql;
        let orden = '';
        if (e.ordenar && e.ordenar.length) orden = ' ORDER BY ' + e.ordenar.map((o) => traducir(o.expr, ctx).sql + (o.desc ? ' DESC' : '')).join(', ');
        if (e.distinto && sep !== "','") throw new NoDisponible('GROUP_CONCAT(DISTINCT ... SEPARATOR)');
        return { sql: 'group_concat(' + d + expr + (e.distinto ? '' : ', ' + sep) + orden + ')', tipo: TIPO_TEXTO, agregado: true };
      }
      default: throw new NoDisponible('la función ' + n);
    }
  }

  // ---------- consultas ----------

  function traducirConsulta(ast, srv, padre) {
    if (ast.tipo === 'conjunto') return traducirConjunto(ast, srv, padre);
    const ambito = { fuentes: [], padre, aliasSelect: null, comunes: new Set() };
    const ctx = { srv, ambito, clausula: 'field list' };
    const desde = ast.desde.map((r) => traducirReferencia(r, srv, ambito)).join(', ');

    const columnas = [];
    const partes = [];
    const nombresAlias = new Map();
    const marcas = { agregado: false };
    const usadasPorColumna = [];
    ast.columnas.forEach((c) => {
      if (c.expr.t === 'estrella') {
        let fuentes = ambito.fuentes;
        if (c.expr.tabla) {
          fuentes = fuentes.filter((f) => (f.alias === c.expr.tabla || (!f.conAlias && f.nombre === c.expr.tabla))
            && (!c.expr.bd || f.bd === c.expr.bd));
          if (!fuentes.length) throw new ErrorSQL(1051, '42S02', "Unknown table '" + c.expr.tabla + "'");
        } else if (!fuentes.length) throw new ErrorSQL(1096, 'HY000', 'No tables used');
        fuentes.forEach((f) => f.columnas.forEach((col) => {
          if (!c.expr.tabla && f.ocultas && f.ocultas.has(col.nombre.toLowerCase())) return;
          partes.push((f.sql || id(f.alias)) + '.' + id(col.nombre) + ' AS ' + id(col.nombre));
          columnas.push({ nombre: col.nombre, tipo: col.tipo });
        }));
        return;
      }
      const usadas = [];
      const r = traducir(c.expr, Object.assign({}, ctx, { usadas, marcas }));
      usadasPorColumna.push({ usadas, expr: c.expr });
      const nombre = c.alias !== null && c.alias !== undefined ? c.alias
        : c.expr.t === 'col' ? c.expr.partes[c.expr.partes.length - 1] : c.texto;
      partes.push(r.sql + ' AS ' + id(nombre));
      columnas.push({ nombre, tipo: r.tipo });
      if (c.alias) nombresAlias.set(c.alias.toLowerCase(), { nombre: c.alias, tipo: r.tipo });
    });

    let sql = 'SELECT ' + (ast.distinto ? 'DISTINCT ' : '') + partes.join(', ');
    if (desde) sql += ' FROM ' + desde;
    if (ast.donde) sql += ' WHERE ' + traducir(ast.donde, Object.assign({}, ctx, { clausula: 'where clause', sinAgregados: true })).sql;
    ambito.aliasSelect = nombresAlias;
    const posicional = (expr, clausula) => {
      if (expr.t === 'num' && /^\d+$/.test(expr.v)) {
        const k = Number(expr.v);
        if (k < 1 || k > columnas.length) throw new ErrorSQL(1054, '42S22', "Unknown column '" + k + "' in '" + clausula + "'");
        return String(k);
      }
      return null;
    };
    if (ast.agrupar.length) {
      sql += ' GROUP BY ' + ast.agrupar.map((g) => posicional(g, 'group statement')
        || traducir(g, Object.assign({}, ctx, { clausula: 'group statement', sinAgregados: true })).sql).join(', ');
    }
    if (ast.teniendo) sql += ' HAVING ' + traducir(ast.teniendo, Object.assign({}, ctx, { clausula: 'having clause', marcas })).sql;
    comprobarAgrupacion(ast, ambito, usadasPorColumna, marcas, ctx);
    if (ast.ordenar.length) {
      sql += ' ORDER BY ' + ast.ordenar.map((o) => (posicional(o.expr, 'order clause')
        || traducir(o.expr, Object.assign({}, ctx, { clausula: 'order clause' })).sql) + (o.desc ? ' DESC' : '')).join(', ');
    }
    if (ast.limite) sql += limite(ast.limite);
    return { sql, columnas };
  }

  // ONLY_FULL_GROUP_BY: en una consulta agrupada, cada columna de la lista
  // del SELECT debe estar agregada, en el GROUP BY o depender funcionalmente
  // de él (por la clave primaria o una clave única NOT NULL de su tabla)
  function comprobarAgrupacion(ast, ambito, usadasPorColumna, marcas, ctx) {
    if (!ast.agrupar.length && !marcas.agregado) return;
    const clave = (f, c) => (f.alias || f.nombre) + '|' + c.nombre.toLowerCase();
    const agrupadas = new Set();
    const expresiones = new Set();
    ast.agrupar.forEach((g) => {
      expresiones.add(JSON.stringify(g));
      if (g.t === 'num' && /^\d+$/.test(g.v)) {
        const item = usadasPorColumna[Number(g.v) - 1];
        if (item) expresiones.add(JSON.stringify(item.expr));
        return;
      }
      const usadas = [];
      try {
        traducir(g, Object.assign({}, ctx, { usadas, clausula: 'group statement' }));
      } catch (e) {
        return;
      }
      if (g.t === 'col') usadas.forEach((u) => agrupadas.add(clave(u.fuente, u.columna)));
      if (g.t === 'col' && g.partes.length === 1 && ambito.aliasSelect && ambito.aliasSelect.has(g.partes[0].toLowerCase())) {
        const i = ast.columnas.findIndex((c) => c.alias && c.alias.toLowerCase() === g.partes[0].toLowerCase());
        if (i >= 0) expresiones.add(JSON.stringify(ast.columnas[i].expr));
      }
    });
    // Dependencia funcional: la tabla queda determinada si su clave está agrupada
    const determinadas = new Set();
    ambito.fuentes.forEach((f) => {
      if (!f.tabla) return;
      const claves = f.tabla.indices.filter((i) => i.unico && i.columnas.every((c) => !C.columna(f.tabla, c.nombre).nulo));
      if (claves.some((i) => i.columnas.every((c) => agrupadas.has((f.alias || f.nombre) + '|' + c.nombre.toLowerCase())))) determinadas.add(f);
    });
    usadasPorColumna.forEach((item, k) => {
      if (expresiones.has(JSON.stringify(item.expr))) return;
      const suelta = item.usadas.find((u) => !u.agregada && !agrupadas.has(clave(u.fuente, u.columna)) && !determinadas.has(u.fuente));
      if (!suelta) return;
      const nombre = (suelta.fuente.bd || '') + '.' + (suelta.fuente.alias || suelta.fuente.nombre) + '.' + suelta.columna.nombre;
      if (!ast.agrupar.length) {
        throw new ErrorSQL(1140, '42000', 'In aggregated query without GROUP BY, expression #' + (k + 1) + " of SELECT list contains nonaggregated column '"
          + nombre + "'; this is incompatible with sql_mode=only_full_group_by");
      }
      throw new ErrorSQL(1055, '42000', 'Expression #' + (k + 1) + " of SELECT list is not in GROUP BY clause and contains nonaggregated column '"
        + nombre + "' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by");
    });
  }

  function limite(l) {
    const valor = (e) => {
      if (e.t !== 'num' || !/^\d+$/.test(e.v)) throw new NoDisponible('LIMIT con expresiones');
      return e.v;
    };
    return ' LIMIT ' + valor(l.n) + (l.desplazamiento ? ' OFFSET ' + valor(l.desplazamiento) : '');
  }

  function traducirConjunto(ast, srv, padre) {
    const miembro = (m) => {
      const r = traducirConsulta(m, srv, padre);
      const propio = m.tipo === 'seleccionar' ? m.ordenar.length || m.limite : m.ordenar.length || m.limite;
      return { sql: propio || m.tipo === 'conjunto' ? 'SELECT * FROM (' + r.sql + ')' : r.sql, columnas: r.columnas };
    };
    const izq = miembro(ast.izq);
    const der = miembro(ast.der);
    if (izq.columnas.length !== der.columnas.length) {
      throw new ErrorSQL(1222, '21000', 'The used SELECT statements have a different number of columns');
    }
    if (ast.todos && ast.op !== 'UNION') throw new NoDisponible(ast.op + ' ALL');
    let sql = izq.sql + ' ' + ast.op + (ast.todos ? ' ALL ' : ' ') + der.sql;
    const columnas = izq.columnas.map((c, i) => ({ nombre: c.nombre, tipo: c.tipo.base === 'null' ? der.columnas[i].tipo : c.tipo }));
    if (ast.ordenar.length) {
      const ambito = { fuentes: [{ alias: null, nombre: null, conAlias: true, columnas, sql: null }], padre: null, aliasSelect: null };
      sql += ' ORDER BY ' + ast.ordenar.map((o) => {
        if (o.expr.t === 'num' && /^\d+$/.test(o.expr.v)) return o.expr.v + (o.desc ? ' DESC' : '');
        return traducir(o.expr, { srv, ambito, clausula: 'order clause' }).sql + (o.desc ? ' DESC' : '');
      }).join(', ');
    }
    if (ast.limite) sql += limite(ast.limite);
    return { sql, columnas };
  }

  function traducirReferencia(r, srv, ambito) {
    if (r.t === 'tabla') {
      const fuente = srv.fuenteTabla(r);
      if (ambito.fuentes.some((f) => f.alias === fuente.alias)) throw new ErrorSQL(1066, '42000', "Not unique table/alias: '" + fuente.alias + "'");
      ambito.fuentes.push(fuente);
      return fuente.desde;
    }
    if (r.t === 'subconsulta') {
      const sub = traducirConsulta(r.consulta, srv, ambito.padre);
      const vistos = new Set();
      sub.columnas.forEach((c) => {
        const k = c.nombre.toLowerCase();
        if (vistos.has(k)) throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + c.nombre + "'");
        vistos.add(k);
      });
      ambito.fuentes.push({ alias: r.alias, nombre: r.alias, conAlias: true, columnas: sub.columnas, sql: id(r.alias) });
      return '(' + sub.sql + ') AS ' + id(r.alias);
    }
    if (r.t === 'lista') return r.elementos.map((x) => traducirReferencia(x, srv, ambito)).join(', ');
    if (r.t === 'union') {
      const izq = traducirReferencia(r.izq, srv, ambito);
      const antes = ambito.fuentes.length;
      const der = traducirReferencia(r.der, srv, ambito);
      const derechas = ambito.fuentes.slice(antes);
      const izquierdas = ambito.fuentes.slice(0, antes);
      let comunes = null;
      if (r.natural || r.using) {
        if (r.using) comunes = r.using.map((c) => c.toLowerCase());
        else {
          const nIzq = new Set();
          izquierdas.forEach((f) => f.columnas.forEach((c) => nIzq.add(c.nombre.toLowerCase())));
          comunes = [];
          derechas.forEach((f) => f.columnas.forEach((c) => { if (nIzq.has(c.nombre.toLowerCase())) comunes.push(c.nombre.toLowerCase()); }));
        }
        comunes.forEach((c) => {
          if (!izquierdas.some((f) => buscarColumna(f, c)) || !derechas.some((f) => buscarColumna(f, c))) {
            throw new ErrorSQL(1054, '42S22', "Unknown column '" + c + "' in 'from clause'");
          }
          ambito.comunes.add(c);
          // En SELECT * las columnas comunes aparecen una sola vez
          derechas.forEach((f) => { f.ocultas = f.ocultas || new Set(); f.ocultas.add(c); });
        });
      }
      const tipo = r.tipo === 'CROSS' ? 'CROSS JOIN' : r.tipo === 'INNER' ? 'JOIN' : r.tipo + ' JOIN';
      let sql = izq + ' ' + (r.natural ? 'NATURAL ' : '') + tipo + ' ' + der;
      if (r.on) sql += ' ON ' + traducir(r.on, { srv, ambito, clausula: 'on clause', sinAgregados: true }).sql;
      if (r.using) sql += ' USING (' + r.using.map(id).join(', ') + ')';
      return sql;
    }
    throw new NoDisponible('referencia ' + r.t);
  }

  M.traductor = {
    traducir, traducirConsulta, id, textoSQL, nombreTablaSQL, nombreSQLite, tablaDeSQLite, codificar, clase, TIPO_TEXTO, TIPO_ENTERO, TIPO_DOBLE,
    TIPO_NULO, NO_DETERMINISTAS, AGREGADOS, colacionTexto,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
