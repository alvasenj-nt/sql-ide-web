'use strict';
// Diccionario de datos del servidor emulado: bases de datos, tablas,
// columnas, índices y restricciones con los nombres y el formato de MySQL
// 8.0 (SHOW CREATE TABLE, DESCRIBE, SHOW INDEX e information_schema).
(function (global) {
  const M = global.MotorMySQL;
  const T = M.tipos;

  const SISTEMA = ['information_schema', 'mysql', 'performance_schema', 'sys'];

  class Catalogo {
    constructor() {
      this.bases = new Map();
      this.charset = 'utf8mb4';
      this.collation = 'utf8mb4_0900_ai_ci';
    }

    esSistema(nombre) {
      return SISTEMA.includes(nombre.toLowerCase());
    }

    // Los nombres de base de datos y de tabla distinguen mayúsculas, como
    // en el servidor Linux del aula (lower_case_table_names = 0)
    bd(nombre) { return this.bases.get(nombre) || null; }

    tabla(bd, nombre) {
      const b = this.bases.get(bd);
      return b ? b.tablas.get(nombre) || null : null;
    }

    todasLasTablas() {
      const lista = [];
      this.bases.forEach((b) => b.tablas.forEach((t) => lista.push(t)));
      return lista;
    }

    // Claves ajenas de otras tablas que apuntan a la tabla dada
    referenciasA(tabla) {
      const lista = [];
      this.todasLasTablas().forEach((t) => t.fks.forEach((fk) => {
        if (fk.refBd === tabla.bd && fk.refTabla === tabla.nombre && t !== tabla) lista.push({ tabla: t, fk });
      }));
      return lista;
    }

    nombresCheck(bd) {
      const nombres = new Set();
      const b = this.bases.get(bd);
      if (b) b.tablas.forEach((t) => t.checks.forEach((c) => nombres.add(c.nombre.toLowerCase())));
      return nombres;
    }

    nombresFk(bd) {
      const nombres = new Set();
      const b = this.bases.get(bd);
      if (b) b.tablas.forEach((t) => t.fks.forEach((f) => nombres.add(f.nombre.toLowerCase())));
      return nombres;
    }
  }

  const cita = (s) => '`' + String(s).replace(/`/g, '``') + '`';
  const citaLista = (cols) => cols.map((c) => cita(typeof c === 'string' ? c : c.nombre)
    + (c.prefijo ? '(' + c.prefijo + ')' : '') + (c.desc ? ' DESC' : '')).join(',');

  function columna(tabla, nombre) {
    const n = nombre.toLowerCase();
    return tabla.columnas.find((c) => c.nombre.toLowerCase() === n) || null;
  }

  // Índices en el orden en que los muestra MySQL: primaria, únicos y el
  // resto, cada grupo en orden de creación
  function indicesOrdenados(tabla) {
    const pk = tabla.indices.filter((i) => i.primaria);
    const unicos = tabla.indices.filter((i) => i.unico && !i.primaria);
    const otros = tabla.indices.filter((i) => !i.unico);
    return pk.concat(unicos, otros);
  }

  // ---------- expresiones normalizadas (CHECK) ----------

  const OPERADORES_PALABRA = { AND: 'and', OR: 'or', XOR: 'xor', DIV: 'DIV' };

  function cadenaMySQL(s) {
    return "_utf8mb4'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  // Texto de una expresión tal como MySQL la guarda en el diccionario
  function textoExpresion(e) {
    switch (e.t) {
      case 'num':
        return e.v.startsWith('-') ? '-(' + e.v.slice(1) + ')' : e.v;
      case 'str': return cadenaMySQL(e.v);
      case 'null': return 'NULL';
      case 'bool': return e.v ? 'true' : 'false';
      case 'hex': return "0x" + (e.v || '').toLowerCase();
      case 'col': return cita(e.partes[e.partes.length - 1]);
      case 'par': return textoExpresion(e.a);
      case 'bin': {
        const op = OPERADORES_PALABRA[e.op] || e.op;
        if (e.op === 'AND' || e.op === 'OR') {
          // MySQL aplana las cadenas de AND y de OR
          const partes = [];
          const recoger = (x) => {
            while (x.t === 'par') x = x.a;
            if (x.t === 'bin' && x.op === e.op) { recoger(x.a); recoger(x.b); } else partes.push(textoExpresion(x));
          };
          recoger(e);
          return '(' + partes.join(' ' + op + ' ') + ')';
        }
        return '(' + textoExpresion(e.a) + ' ' + op + ' ' + textoExpresion(e.b) + ')';
      }
      case 'un':
        if (e.op === 'NOT') {
          let a = e.a;
          while (a.t === 'par') a = a.a;
          const inversa = { '=': '<>', '<>': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
          if (a.t === 'bin' && inversa[a.op]) return textoExpresion({ t: 'bin', op: inversa[a.op], a: a.a, b: a.b });
          if (['como', 'en', 'entre', 'regexp', 'esNulo', 'esValor'].includes(a.t) || (a.t === 'bin' && ['AND', 'OR', 'XOR'].includes(a.op))) {
            return '(not(' + textoExpresion(a) + '))';
          }
          return '(0 = ' + textoExpresion(a) + ')';
        }
        if (e.op === '-') return '-(' + textoExpresion(e.a) + ')';
        return e.op + '(' + textoExpresion(e.a) + ')';
      case 'esNulo': return '(' + textoExpresion(e.a) + ' is ' + (e.neg ? 'not ' : '') + 'null)';
      case 'esValor': return '(' + textoExpresion(e.a) + ' is ' + (e.neg ? 'not ' : '') + (e.valor ? 'true' : 'false') + ')';
      case 'entre': return '(' + textoExpresion(e.a) + (e.neg ? ' not' : '') + ' between ' + textoExpresion(e.b) + ' and ' + textoExpresion(e.c) + ')';
      case 'en': return '(' + textoExpresion(e.a) + (e.neg ? ' not' : '') + ' in (' + (e.lista || []).map(textoExpresion).join(',') + '))';
      case 'como': {
        const base = '(' + textoExpresion(e.a) + ' like ' + textoExpresion(e.patron) + (e.escape ? ' escape ' + textoExpresion(e.escape) : '') + ')';
        return e.neg ? '(not(' + base + '))' : base;
      }
      case 'regexp': {
        const base = 'regexp_like(' + textoExpresion(e.a) + ',' + textoExpresion(e.patron) + ')';
        return e.neg ? '(not(' + base + '))' : base;
      }
      case 'func': return e.nombre.toLowerCase() + '(' + (e.estrella ? '*' : e.args.map(textoExpresion).join(',')) + ')';
      case 'caso': return '(case ' + (e.base ? textoExpresion(e.base) + ' ' : '') + e.cuandos.map((w) => 'when ' + textoExpresion(w.c) + ' then ' + textoExpresion(w.r)).join(' ') + (e.sino ? ' else ' + textoExpresion(e.sino) : '') + ' end)';
      case 'literalTipado': return e.tipo + "'" + e.v + "'";
      default: return '?';
    }
  }

  // ---------- SHOW CREATE TABLE ----------

  function defectoMostrado(col) {
    const d = col.defecto;
    if (d === undefined) return undefined;
    if (d.nulo) return 'NULL';
    if (d.ahora) return 'CURRENT_TIMESTAMP' + (col.tipo.fsp ? '(' + col.tipo.fsp + ')' : '');
    return T.mostrarValor(d.valor, col.tipo);
  }

  function lineaColumna(col, tabla) {
    let s = '  ' + cita(col.nombre) + ' ' + T.textoTipo(col.tipo);
    if (T.tieneCharset(col.tipo) && (col.tipo.charsetExplicito || col.tipo.charset !== tabla.charset || col.tipo.collation !== tabla.collation)) {
      s += ' CHARACTER SET ' + col.tipo.charset + ' COLLATE ' + col.tipo.collation;
    }
    if (!col.nulo) s += ' NOT NULL';
    else if (col.tipo.base === 'timestamp') s += ' NULL';
    const d = col.defecto;
    const sinDefectoNulo = T.TEXTOS[col.tipo.base] || T.BLOBS[col.tipo.base] || col.tipo.base === 'json';
    if (d === undefined) {
      if (col.nulo && !sinDefectoNulo) s += ' DEFAULT NULL';
    } else if (d.nulo) {
      s += ' DEFAULT NULL';
    } else if (d.ahora) {
      s += ' DEFAULT ' + defectoMostrado(col);
    } else {
      s += " DEFAULT '" + String(defectoMostrado(col)).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    }
    if (col.alActualizarAhora) s += ' ON UPDATE CURRENT_TIMESTAMP' + (col.tipo.fsp ? '(' + col.tipo.fsp + ')' : '');
    if (col.autoInc) s += ' AUTO_INCREMENT';
    if (col.comentario) s += " COMMENT '" + col.comentario.replace(/'/g, "''") + "'";
    return s;
  }

  function textoAcciones(fk) {
    let s = '';
    if (fk.alBorrar && fk.alBorrar !== 'NO ACTION') s += ' ON DELETE ' + fk.alBorrar;
    if (fk.alActualizar && fk.alActualizar !== 'NO ACTION') s += ' ON UPDATE ' + fk.alActualizar;
    return s;
  }

  function referenciaFk(fk, tabla) {
    const destino = (fk.refBd !== tabla.bd ? cita(fk.refBd) + '.' : '') + cita(fk.refTabla);
    return 'FOREIGN KEY (' + fk.columnas.map(cita).join(', ') + ') REFERENCES ' + destino + ' (' + fk.refColumnas.map(cita).join(', ') + ')' + textoAcciones(fk);
  }

  function mostrarCrearTabla(tabla) {
    const lineas = tabla.columnas.map((c) => lineaColumna(c, tabla));
    indicesOrdenados(tabla).forEach((i) => {
      if (i.primaria) lineas.push('  PRIMARY KEY (' + citaLista(i.columnas) + ')');
      else lineas.push('  ' + (i.unico ? 'UNIQUE KEY ' : 'KEY ') + cita(i.nombre) + ' (' + citaLista(i.columnas) + ')');
    });
    const porNombre = (a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0);
    tabla.fks.slice().sort(porNombre).forEach((fk) => {
      lineas.push('  CONSTRAINT ' + cita(fk.nombre) + ' ' + referenciaFk(fk, tabla));
    });
    tabla.checks.slice().sort(porNombre).forEach((c) => {
      lineas.push('  CONSTRAINT ' + cita(c.nombre) + ' CHECK (' + c.texto + ')' + (c.aplicada ? '' : ' /*!80016 NOT ENFORCED */'));
    });
    let opciones = ') ENGINE=' + tabla.motor;
    if (tabla.autoInc && tabla.autoInc > 1) opciones += ' AUTO_INCREMENT=' + tabla.autoInc;
    opciones += ' DEFAULT CHARSET=' + tabla.charset;
    if (tabla.charset === 'utf8mb4' || tabla.collation !== T.CHARSETS[tabla.charset].defecto) opciones += ' COLLATE=' + tabla.collation;
    if (tabla.comentario) opciones += " COMMENT='" + tabla.comentario.replace(/'/g, "''") + "'";
    return 'CREATE TABLE ' + cita(tabla.nombre) + ' (\n' + lineas.join(',\n') + '\n' + opciones;
  }

  function mostrarCrearBD(bd) {
    return 'CREATE DATABASE ' + cita(bd.nombre) + ' /*!40100 DEFAULT CHARACTER SET ' + bd.charset
      + (bd.charset === 'utf8mb4' || bd.collation !== T.CHARSETS[bd.charset].defecto ? ' COLLATE ' + bd.collation : '')
      + " */ /*!80016 DEFAULT ENCRYPTION='N' */";
  }

  // ---------- DESCRIBE y SHOW INDEX ----------

  // Valor de la columna Key de DESCRIBE: PRI, UNI o MUL
  function claveDeColumna(tabla, col) {
    const n = col.nombre.toLowerCase();
    let pk = tabla.indices.find((i) => i.primaria);
    if (!pk) {
      // Sin clave primaria, el primer índice único sobre columnas NOT NULL hace de primaria
      pk = indicesOrdenados(tabla).find((i) => i.unico && i.columnas.every((c) => !columna(tabla, c.nombre).nulo));
    }
    if (pk && pk.columnas.some((c) => c.nombre.toLowerCase() === n)) return 'PRI';
    const primeras = tabla.indices.filter((i) => i.columnas[0].nombre.toLowerCase() === n);
    if (primeras.some((i) => i.unico && i.columnas.length === 1)) return 'UNI';
    if (primeras.length) return 'MUL';
    return '';
  }

  function extraDeColumna(col) {
    const partes = [];
    if (col.autoInc) partes.push('auto_increment');
    if (col.defecto && col.defecto.ahora) partes.push('DEFAULT_GENERATED');
    if (col.alActualizarAhora) partes.push('on update CURRENT_TIMESTAMP' + (col.tipo.fsp ? '(' + col.tipo.fsp + ')' : ''));
    return partes.join(' ');
  }

  function describir(tabla, completo) {
    return tabla.columnas.map((c) => {
      const d = defectoMostrado(c);
      const fila = [c.nombre, T.textoTipo(c.tipo)];
      if (completo) fila.push(T.tieneCharset(c.tipo) ? c.tipo.collation : null);
      fila.push(c.nulo ? 'YES' : 'NO', claveDeColumna(tabla, c), d === undefined || d === 'NULL' ? null : String(d), extraDeColumna(c));
      if (completo) fila.push('select,insert,update,references', c.comentario || '');
      return fila;
    });
  }

  function mostrarIndices(tabla, filas) {
    const lista = [];
    indicesOrdenados(tabla).forEach((i) => i.columnas.forEach((c, k) => {
      const col = columna(tabla, c.nombre);
      lista.push([tabla.nombre, i.unico ? 0 : 1, i.nombre, k + 1, col.nombre, c.desc ? 'D' : 'A', filas,
        c.prefijo || null, null, col.nulo ? 'YES' : '', 'BTREE', '', '', 'YES', null]);
    }));
    return lista;
  }

  // ---------- information_schema ----------

  // Columnas de cada vista de information_schema: [nombre, tipo]
  const INFO = {
    SCHEMATA: [['CATALOG_NAME', 'v'], ['SCHEMA_NAME', 'v'], ['DEFAULT_CHARACTER_SET_NAME', 'v'],
      ['DEFAULT_COLLATION_NAME', 'v'], ['SQL_PATH', 'v'], ['DEFAULT_ENCRYPTION', 'v']],
    TABLES: [['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['TABLE_TYPE', 'v'], ['ENGINE', 'v'],
      ['VERSION', 'i'], ['ROW_FORMAT', 'v'], ['TABLE_ROWS', 'i'], ['AUTO_INCREMENT', 'i'], ['TABLE_COLLATION', 'v'],
      ['CREATE_OPTIONS', 'v'], ['TABLE_COMMENT', 'v']],
    COLUMNS: [['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['COLUMN_NAME', 'v'],
      ['ORDINAL_POSITION', 'i'], ['COLUMN_DEFAULT', 'v'], ['IS_NULLABLE', 'v'], ['DATA_TYPE', 'v'],
      ['CHARACTER_MAXIMUM_LENGTH', 'i'], ['CHARACTER_OCTET_LENGTH', 'i'], ['NUMERIC_PRECISION', 'i'],
      ['NUMERIC_SCALE', 'i'], ['DATETIME_PRECISION', 'i'], ['CHARACTER_SET_NAME', 'v'], ['COLLATION_NAME', 'v'],
      ['COLUMN_TYPE', 'v'], ['COLUMN_KEY', 'v'], ['EXTRA', 'v'], ['PRIVILEGES', 'v'], ['COLUMN_COMMENT', 'v'],
      ['GENERATION_EXPRESSION', 'v']],
    TABLE_CONSTRAINTS: [['CONSTRAINT_CATALOG', 'v'], ['CONSTRAINT_SCHEMA', 'v'], ['CONSTRAINT_NAME', 'v'],
      ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['CONSTRAINT_TYPE', 'v'], ['ENFORCED', 'v']],
    KEY_COLUMN_USAGE: [['CONSTRAINT_CATALOG', 'v'], ['CONSTRAINT_SCHEMA', 'v'], ['CONSTRAINT_NAME', 'v'],
      ['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['COLUMN_NAME', 'v'], ['ORDINAL_POSITION', 'i'],
      ['POSITION_IN_UNIQUE_CONSTRAINT', 'i'], ['REFERENCED_TABLE_SCHEMA', 'v'], ['REFERENCED_TABLE_NAME', 'v'],
      ['REFERENCED_COLUMN_NAME', 'v']],
    REFERENTIAL_CONSTRAINTS: [['CONSTRAINT_CATALOG', 'v'], ['CONSTRAINT_SCHEMA', 'v'], ['CONSTRAINT_NAME', 'v'],
      ['UNIQUE_CONSTRAINT_CATALOG', 'v'], ['UNIQUE_CONSTRAINT_SCHEMA', 'v'], ['UNIQUE_CONSTRAINT_NAME', 'v'],
      ['MATCH_OPTION', 'v'], ['UPDATE_RULE', 'v'], ['DELETE_RULE', 'v'], ['TABLE_NAME', 'v'], ['REFERENCED_TABLE_NAME', 'v']],
    CHECK_CONSTRAINTS: [['CONSTRAINT_CATALOG', 'v'], ['CONSTRAINT_SCHEMA', 'v'], ['CONSTRAINT_NAME', 'v'], ['CHECK_CLAUSE', 'v']],
    STATISTICS: [['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['NON_UNIQUE', 'i'],
      ['INDEX_SCHEMA', 'v'], ['INDEX_NAME', 'v'], ['SEQ_IN_INDEX', 'i'], ['COLUMN_NAME', 'v'], ['COLLATION', 'v'],
      ['CARDINALITY', 'i'], ['SUB_PART', 'i'], ['PACKED', 'v'], ['NULLABLE', 'v'], ['INDEX_TYPE', 'v'], ['COMMENT', 'v'],
      ['INDEX_COMMENT', 'v'], ['IS_VISIBLE', 'v'], ['EXPRESSION', 'v']],
    ENGINES: [['ENGINE', 'v'], ['SUPPORT', 'v'], ['COMMENT', 'v'], ['TRANSACTIONS', 'v'], ['XA', 'v'], ['SAVEPOINTS', 'v']],
  };

  const MOTORES = [
    ['ndbcluster', 'NO', 'Clustered, fault-tolerant tables', null, null, null],
    ['MEMORY', 'YES', 'Hash based, stored in memory, useful for temporary tables', 'NO', 'NO', 'NO'],
    ['InnoDB', 'DEFAULT', 'Supports transactions, row-level locking, and foreign keys', 'YES', 'YES', 'YES'],
    ['PERFORMANCE_SCHEMA', 'YES', 'Performance Schema', 'NO', 'NO', 'NO'],
    ['MyISAM', 'YES', 'MyISAM storage engine', 'NO', 'NO', 'NO'],
    ['FEDERATED', 'NO', 'Federated MySQL storage engine', null, null, null],
    ['ndbinfo', 'NO', 'MySQL Cluster system information storage engine', null, null, null],
    ['MRG_MYISAM', 'YES', 'Collection of identical MyISAM tables', 'NO', 'NO', 'NO'],
    ['BLACKHOLE', 'YES', '/dev/null storage engine (anything you write to it disappears)', 'NO', 'NO', 'NO'],
    ['CSV', 'YES', 'CSV storage engine', 'NO', 'NO', 'NO'],
    ['ARCHIVE', 'YES', 'Archive storage engine', 'NO', 'NO', 'NO'],
  ];

  function datosColumna(c) {
    const t = c.tipo;
    let maxLen = null;
    let octetos = null;
    let precision = null;
    let escala = null;
    let fsp = null;
    const bytes = t.charset ? T.CHARSETS[t.charset].bytes : 1;
    if (t.base === 'char' || t.base === 'varchar') { maxLen = t.longitud; octetos = t.longitud * bytes; }
    if (t.base === 'binary' || t.base === 'varbinary') { maxLen = t.longitud; octetos = t.longitud; }
    if (T.TEXTOS[t.base]) { maxLen = Math.floor(T.TEXTOS[t.base] / bytes); octetos = T.TEXTOS[t.base]; }
    if (T.BLOBS[t.base]) { maxLen = T.BLOBS[t.base]; octetos = T.BLOBS[t.base]; }
    if (t.base === 'enum' || t.base === 'set') {
      maxLen = t.base === 'enum' ? Math.max(...t.valores.map((v) => Array.from(v).length))
        : t.valores.reduce((a, v) => a + Array.from(v).length, 0) + t.valores.length - 1;
      octetos = maxLen * bytes;
    }
    const preEnteros = { tinyint: 3, smallint: 5, mediumint: 7, int: 10, bigint: 19 };
    if (preEnteros[t.base]) { precision = t.base === 'bigint' && t.sinSigno ? 20 : preEnteros[t.base]; escala = 0; }
    if (t.base === 'decimal') { precision = t.p; escala = t.s; }
    if (t.base === 'float') { precision = t.p !== undefined ? t.p : 12; escala = t.s !== undefined ? t.s : null; }
    if (t.base === 'double') { precision = t.p !== undefined ? t.p : 22; escala = t.s !== undefined ? t.s : null; }
    if (t.base === 'bit') precision = t.longitud;
    if (['datetime', 'timestamp', 'time'].includes(t.base)) fsp = t.fsp || 0;
    return { maxLen, octetos, precision, escala, fsp };
  }

  function filasInfo(cat, vista) {
    const filas = [];
    const porNombre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const tablas = cat.todasLasTablas().sort((a, b) => porNombre(a.bd, b.bd) || porNombre(a.nombre, b.nombre));
    switch (vista) {
      case 'SCHEMATA':
        ['information_schema', 'mysql', 'performance_schema', 'sys'].forEach((n) => filas.push(['def', n,
          n === 'information_schema' ? 'utf8mb3' : 'utf8mb4', n === 'information_schema' ? 'utf8mb3_general_ci' : 'utf8mb4_0900_ai_ci', null, 'NO']));
        cat.bases.forEach((b) => filas.push(['def', b.nombre, b.charset, b.collation, null, 'NO']));
        filas.sort((a, b) => porNombre(a[1], b[1]));
        break;
      case 'TABLES':
        tablas.forEach((t) => filas.push(['def', t.bd, t.nombre, 'BASE TABLE', t.motor, 10, 'Dynamic', 0,
          t.columnas.some((c) => c.autoInc) ? t.autoInc || 1 : null, t.collation, '', t.comentario || '']));
        break;
      case 'COLUMNS':
        tablas.forEach((t) => t.columnas.forEach((c, k) => {
          const d = datosColumna(c);
          const def = defectoMostrado(c);
          filas.push(['def', t.bd, t.nombre, c.nombre, k + 1, def === undefined || def === 'NULL' ? null : String(def),
            c.nulo ? 'YES' : 'NO', c.tipo.base, d.maxLen, d.octetos, d.precision, d.escala, d.fsp,
            c.tipo.charset || null, c.tipo.collation || null, T.textoTipo(c.tipo), claveDeColumna(t, c), extraDeColumna(c),
            'select,insert,update,references', c.comentario || '', '']);
        }));
        break;
      case 'TABLE_CONSTRAINTS':
        tablas.forEach((t) => {
          indicesOrdenados(t).filter((i) => i.unico).forEach((i) => filas.push(['def', t.bd, i.primaria ? 'PRIMARY' : i.nombre,
            t.bd, t.nombre, i.primaria ? 'PRIMARY KEY' : 'UNIQUE', 'YES']));
          t.fks.forEach((f) => filas.push(['def', t.bd, f.nombre, t.bd, t.nombre, 'FOREIGN KEY', 'YES']));
          t.checks.forEach((c) => filas.push(['def', t.bd, c.nombre, t.bd, t.nombre, 'CHECK', c.aplicada ? 'YES' : 'NO']));
        });
        break;
      case 'KEY_COLUMN_USAGE':
        tablas.forEach((t) => {
          indicesOrdenados(t).filter((i) => i.unico).forEach((i) => i.columnas.forEach((c, k) => filas.push(['def', t.bd,
            i.primaria ? 'PRIMARY' : i.nombre, 'def', t.bd, t.nombre, columna(t, c.nombre).nombre, k + 1, null, null, null, null])));
          t.fks.forEach((f) => f.columnas.forEach((c, k) => filas.push(['def', t.bd, f.nombre, 'def', t.bd, t.nombre,
            columna(t, c).nombre, k + 1, k + 1, f.refBd, f.refTabla, f.refColumnas[k]])));
        });
        break;
      case 'REFERENTIAL_CONSTRAINTS':
        tablas.forEach((t) => t.fks.forEach((f) => {
          const padre = cat.tabla(f.refBd, f.refTabla);
          let unico = null;
          if (padre) {
            const i = indicesOrdenados(padre).find((x) => x.unico && x.columnas.length === f.refColumnas.length
              && x.columnas.every((c, k) => c.nombre.toLowerCase() === f.refColumnas[k].toLowerCase()));
            unico = i ? (i.primaria ? 'PRIMARY' : i.nombre) : null;
          }
          filas.push(['def', t.bd, f.nombre, 'def', f.refBd, unico, 'NONE', f.alActualizar || 'NO ACTION',
            f.alBorrar || 'NO ACTION', t.nombre, f.refTabla]);
        }));
        break;
      case 'CHECK_CONSTRAINTS':
        tablas.forEach((t) => t.checks.forEach((c) => filas.push(['def', t.bd, c.nombre, c.texto.replace(/'/g, "\\'")])));
        break;
      case 'STATISTICS':
        tablas.forEach((t) => indicesOrdenados(t).forEach((i) => i.columnas.forEach((c, k) => {
          const col = columna(t, c.nombre);
          filas.push(['def', t.bd, t.nombre, i.unico ? 0 : 1, t.bd, i.nombre, k + 1, col.nombre, c.desc ? 'D' : 'A', 0,
            c.prefijo || null, null, col.nulo ? 'YES' : '', 'BTREE', '', '', 'YES', null]);
        })));
        break;
      case 'ENGINES':
        MOTORES.forEach((m) => filas.push(m));
        break;
      default: break;
    }
    return filas;
  }

  M.catalogo = {
    Catalogo, SISTEMA, INFO, MOTORES, cita, columna, indicesOrdenados, textoExpresion, mostrarCrearTabla,
    mostrarCrearBD, describir, mostrarIndices, claveDeColumna, filasInfo, referenciaFk, defectoMostrado,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
