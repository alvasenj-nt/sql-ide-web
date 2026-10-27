'use strict';
// Análisis léxico del SQL de MySQL: división de un script en sentencias
// (con DELIMITER, como el cliente mysql) y división de cada sentencia en
// componentes. Funciona igual en el navegador y en Node.
(function (global) {
  const M = global.MotorMySQL || (global.MotorMySQL = {});

  class ErrorSQL extends Error {
    // codigo: número de error de MySQL; estado: SQLSTATE
    constructor(codigo, estado, mensaje, extra) {
      super(mensaje);
      this.codigo = codigo;
      this.estado = estado;
      Object.assign(this, extra || {});
    }
  }

  // Sentencia que MySQL acepta pero que el laboratorio no implementa
  class NoDisponible extends Error {
    constructor(que) {
      super('Esta sentencia no está disponible en el laboratorio: ' + que);
      this.noDisponible = true;
    }
  }

  M.ErrorSQL = ErrorSQL;
  M.NoDisponible = NoDisponible;

  const esEspacio = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  const esDigito = (c) => c >= '0' && c <= '9';
  const esLetraId = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);

  // "-- " solo es comentario si a los guiones les sigue un espacio, un
  // control o el final (como en MySQL)
  function empiezaComentarioGuiones(t, i) {
    if (t[i] !== '-' || t[i + 1] !== '-') return false;
    const c = t[i + 2];
    return c === undefined || c <= ' ';
  }

  // Divide un script en sentencias. Devuelve [{ texto, linea, lineaFin,
  // desde, hasta }] con la línea (desde 1) en que empieza el texto útil.
  function dividir(script) {
    const sentencias = [];
    let delimitador = ';';
    let i = 0;
    let linea = 1;
    let inicio = 0;
    let lineaInicio = 1;
    let util = false; // la sentencia en curso tiene algo más que comentarios
    const n = script.length;

    const cerrar = (fin) => {
      const texto = script.slice(inicio, fin);
      if (util) {
        // Línea del primer carácter que no es espacio ni comentario
        const recorte = primerUtil(texto);
        const lineaReal = lineaInicio + (texto.slice(0, recorte).match(/\n/g) || []).length;
        sentencias.push({ texto: texto.slice(recorte).replace(/\s+$/, ''), linea: lineaReal, lineaFin: linea,
          desde: inicio + recorte, hasta: fin });
      }
      util = false;
    };

    while (i < n) {
      const c = script[i];
      // DELIMITER al principio de una línea (orden del cliente, no de SQL)
      if ((i === 0 || script[i - 1] === '\n') && !util && /^delimiter[ \t]+\S/i.test(script.slice(i, i + 12))) {
        const fin = script.indexOf('\n', i);
        const lineaTexto = script.slice(i, fin === -1 ? n : fin);
        delimitador = lineaTexto.trim().split(/\s+/)[1];
        i = fin === -1 ? n : fin;
        inicio = i;
        lineaInicio = linea;
        continue;
      }
      if (c === '\n') { linea++; i++; continue; }
      if (esEspacio(c)) { i++; continue; }
      if (c === '#' || empiezaComentarioGuiones(script, i)) {
        while (i < n && script[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && script[i + 1] === '*') {
        const fin = script.indexOf('*/', i + 2);
        const hasta = fin === -1 ? n : fin + 2;
        linea += (script.slice(i, hasta).match(/\n/g) || []).length;
        i = hasta;
        continue;
      }
      if (script.startsWith(delimitador, i)) {
        cerrar(i);
        i += delimitador.length;
        inicio = i;
        lineaInicio = linea;
        continue;
      }
      if (!util) { util = true; }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < n) {
          if (script[j] === '\\' && c !== '`') { j += 2; continue; }
          if (script[j] === c) {
            if (script[j + 1] === c) { j += 2; continue; }
            break;
          }
          j++;
        }
        linea += (script.slice(i, j).match(/\n/g) || []).length;
        i = j + 1;
        continue;
      }
      i++;
    }
    cerrar(n);
    return sentencias;
  }

  // Posición del primer carácter que no es espacio ni comentario
  function primerUtil(t) {
    let i = 0;
    while (i < t.length) {
      if (esEspacio(t[i])) { i++; continue; }
      if (t[i] === '#' || empiezaComentarioGuiones(t, i)) {
        while (i < t.length && t[i] !== '\n') i++;
        continue;
      }
      if (t[i] === '/' && t[i + 1] === '*') {
        const fin = t.indexOf('*/', i + 2);
        i = fin === -1 ? t.length : fin + 2;
        continue;
      }
      break;
    }
    return i;
  }

  const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', 0: '\0', Z: '\x1a', '\\': '\\', "'": "'", '"': '"' };

  // Componentes de una sentencia: { tipo, valor, pos, linea }
  //   id: identificador sin comillas (valor tal cual; las palabras clave se
  //       reconocen comparando en mayúsculas)
  //   qid: identificador entre comillas invertidas
  //   num: número (valor: texto original)
  //   str: cadena (valor: contenido ya sin escapes)
  //   hex, bin: literales x'..', 0x.., b'..'
  //   var: @variable o @@variable
  //   op: operador o signo de puntuación
  function componentes(texto) {
    const lista = [];
    let i = 0;
    let linea = 1;
    const n = texto.length;
    const error = (pos) => {
      throw errorSintaxis(texto, pos);
    };
    while (i < n) {
      const c = texto[i];
      if (c === '\n') { linea++; i++; continue; }
      if (esEspacio(c)) { i++; continue; }
      if (c === '#' || empiezaComentarioGuiones(texto, i)) {
        while (i < n && texto[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && texto[i + 1] === '*') {
        const fin = texto.indexOf('*/', i + 2);
        if (fin === -1) error(i);
        linea += (texto.slice(i, fin).match(/\n/g) || []).length;
        i = fin + 2;
        continue;
      }
      const pos = i;
      const lineaPos = linea;
      // Cadenas
      if (c === "'" || c === '"') {
        let valor = '';
        let j = i + 1;
        let cerrada = false;
        while (j < n) {
          const d = texto[j];
          if (d === '\\') {
            const e = texto[j + 1];
            // \% y \_ conservan la barra (comodines de LIKE)
            valor += e === '%' || e === '_' ? '\\' + e : (ESCAPES[e] !== undefined ? ESCAPES[e] : e);
            j += 2;
            continue;
          }
          if (d === c) {
            if (texto[j + 1] === c) { valor += c; j += 2; continue; }
            cerrada = true;
            break;
          }
          if (d === '\n') linea++;
          valor += d;
          j++;
        }
        if (!cerrada) error(pos);
        lista.push({ tipo: 'str', valor, pos, linea: lineaPos, comillas: c });
        i = j + 1;
        continue;
      }
      if (c === '`') {
        let valor = '';
        let j = i + 1;
        let cerrada = false;
        while (j < n) {
          if (texto[j] === '`') {
            if (texto[j + 1] === '`') { valor += '`'; j += 2; continue; }
            cerrada = true;
            break;
          }
          valor += texto[j];
          j++;
        }
        if (!cerrada) error(pos);
        lista.push({ tipo: 'qid', valor, pos, linea: lineaPos });
        i = j + 1;
        continue;
      }
      // Literales hexadecimales y binarios
      if ((c === 'x' || c === 'X' || c === 'b' || c === 'B') && texto[i + 1] === "'") {
        const fin = texto.indexOf("'", i + 2);
        if (fin === -1) error(pos);
        const cuerpo = texto.slice(i + 2, fin);
        const hex = c === 'x' || c === 'X';
        if (hex ? !/^[0-9a-fA-F]*$/.test(cuerpo) || cuerpo.length % 2 : !/^[01]*$/.test(cuerpo)) error(pos);
        lista.push({ tipo: hex ? 'hex' : 'bin', valor: cuerpo, pos, linea: lineaPos });
        i = fin + 1;
        continue;
      }
      if (c === '0' && (texto[i + 1] === 'x' || texto[i + 1] === 'b') && /[0-9a-fA-F]/.test(texto[i + 2] || '')) {
        const hex = texto[i + 1] === 'x';
        let j = i + 2;
        while (j < n && (hex ? /[0-9a-fA-F]/ : /[01]/).test(texto[j])) j++;
        if (j < n && esLetraId(texto[j])) {
          // 0xyz... es un identificador
        } else {
          lista.push({ tipo: hex ? 'hex' : 'bin', valor: texto.slice(i + 2, j), pos, linea: lineaPos });
          i = j;
          continue;
        }
      }
      // Números
      if (esDigito(c) || (c === '.' && esDigito(texto[i + 1] || ''))) {
        let j = i;
        while (j < n && esDigito(texto[j])) j++;
        // 1abc es un identificador en MySQL
        if (j < n && /[A-Za-z_$]/.test(texto[j]) && !/[eE]/.test(texto[j])) {
          while (j < n && esLetraId(texto[j])) j++;
          lista.push({ tipo: 'id', valor: texto.slice(i, j), pos, linea: lineaPos });
          i = j;
          continue;
        }
        if (texto[j] === '.') {
          j++;
          while (j < n && esDigito(texto[j])) j++;
        }
        if ((texto[j] === 'e' || texto[j] === 'E') && /[0-9+-]/.test(texto[j + 1] || '')) {
          let k = j + 1;
          if (texto[k] === '+' || texto[k] === '-') k++;
          if (esDigito(texto[k] || '')) {
            j = k;
            while (j < n && esDigito(texto[j])) j++;
          }
        }
        lista.push({ tipo: 'num', valor: texto.slice(i, j), pos, linea: lineaPos });
        i = j;
        continue;
      }
      // Variables
      if (c === '@') {
        let j = i + 1;
        if (texto[j] === '@') j++;
        if (texto[j] === '`' || texto[j] === "'" || texto[j] === '"') {
          const q = texto[j];
          const fin = texto.indexOf(q, j + 1);
          if (fin === -1) error(pos);
          lista.push({ tipo: 'var', valor: texto.slice(i, j) + texto.slice(j + 1, fin), pos, linea: lineaPos });
          i = fin + 1;
          continue;
        }
        while (j < n && (esLetraId(texto[j]) || texto[j] === '.')) j++;
        lista.push({ tipo: 'var', valor: texto.slice(i, j), pos, linea: lineaPos });
        i = j;
        continue;
      }
      // Identificadores y palabras clave
      if (esLetraId(c)) {
        let j = i;
        while (j < n && esLetraId(texto[j])) j++;
        lista.push({ tipo: 'id', valor: texto.slice(i, j), pos, linea: lineaPos });
        i = j;
        continue;
      }
      // Operadores de varios caracteres
      const tres = texto.slice(i, i + 3);
      const dos = texto.slice(i, i + 2);
      if (tres === '<=>') { lista.push({ tipo: 'op', valor: tres, pos, linea: lineaPos }); i += 3; continue; }
      if (['<=', '>=', '<>', '!=', '||', '&&', '<<', '>>', ':='].includes(dos)) {
        lista.push({ tipo: 'op', valor: dos, pos, linea: lineaPos });
        i += 2;
        continue;
      }
      if ('=<>+-*/%(),.;!~^&|{}'.includes(c)) {
        lista.push({ tipo: 'op', valor: c, pos, linea: lineaPos });
        i++;
        continue;
      }
      error(pos);
    }
    lista.push({ tipo: 'fin', valor: '', pos: n, linea });
    return lista;
  }

  // Error 1064 con el texto de MySQL: el fragmento desde el punto del error
  // (hasta 80 caracteres) y la línea dentro de la sentencia
  function errorSintaxis(texto, pos) {
    const resto = texto.slice(pos).replace(/\s+$/, '');
    const linea = (texto.slice(0, pos).match(/\n/g) || []).length + 1;
    const cerca = resto.length > 80 ? resto.slice(0, 80) : resto;
    return new ErrorSQL(1064, '42000',
      "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '"
      + cerca + "' at line " + linea, { lineaRelativa: linea });
  }

  M.lexico = { dividir, componentes, errorSintaxis, primerUtil };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
