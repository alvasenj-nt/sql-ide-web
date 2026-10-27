'use strict';
// Análisis sintáctico del subconjunto de MySQL 8.0 que implementa el
// laboratorio. Cada sentencia produce un árbol; lo que MySQL acepta y el
// laboratorio no implementa lanza NoDisponible, y lo que MySQL tampoco
// acepta lanza el error 1064 con el fragmento y la línea.
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const { componentes, errorSintaxis } = M.lexico;

  // Palabras reservadas de MySQL 8.0: sin comillas invertidas no pueden ser
  // nombres de tabla ni de columna (CREATE TABLE order ... da 1064)
  const RESERVADAS = new Set(('ACCESSIBLE ADD ALL ALTER ANALYZE AND AS ASC ASENSITIVE BEFORE BETWEEN BIGINT BINARY BLOB '
    + 'BOTH BY CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN CONDITION CONSTRAINT CONTINUE CONVERT '
    + 'CREATE CROSS CUBE CUME_DIST CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES '
    + 'DAY_HOUR DAY_MICROSECOND DAY_MINUTE DAY_SECOND DEC DECIMAL DECLARE DEFAULT DELAYED DELETE DENSE_RANK DESC '
    + 'DESCRIBE DETERMINISTIC DISTINCT DISTINCTROW DIV DOUBLE DROP DUAL EACH ELSE ELSEIF EMPTY ENCLOSED ESCAPED EXCEPT '
    + 'EXISTS EXIT EXPLAIN FALSE FETCH FIRST_VALUE FLOAT FLOAT4 FLOAT8 FOR FORCE FOREIGN FROM FULLTEXT FUNCTION '
    + 'GENERATED GET GRANT GROUP GROUPING GROUPS HAVING HIGH_PRIORITY HOUR_MICROSECOND HOUR_MINUTE HOUR_SECOND IF '
    + 'IGNORE IN INDEX INFILE INNER INOUT INSENSITIVE INSERT INT INT1 INT2 INT3 INT4 INT8 INTEGER INTERSECT INTERVAL '
    + 'INTO IO_AFTER_GTIDS IO_BEFORE_GTIDS IS ITERATE JOIN JSON_TABLE KEY KEYS KILL LAG LAST_VALUE LATERAL LEAD LEADING '
    + 'LEAVE LEFT LIKE LIMIT LINEAR LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOOP LOW_PRIORITY '
    + 'MASTER_BIND MASTER_SSL_VERIFY_SERVER_CERT MATCH MAXVALUE MEDIUMBLOB MEDIUMINT MEDIUMTEXT MIDDLEINT '
    + 'MINUTE_MICROSECOND MINUTE_SECOND MOD MODIFIES NATURAL NOT NO_WRITE_TO_BINLOG NTH_VALUE NTILE NULL NUMERIC OF ON '
    + 'OPTIMIZE OPTIMIZER_COSTS OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE OVER PARTITION PERCENT_RANK PRECISION '
    + 'PRIMARY PROCEDURE PURGE RANGE RANK READ READS READ_WRITE REAL RECURSIVE REFERENCES REGEXP RELEASE RENAME REPEAT '
    + 'REPLACE REQUIRE RESIGNAL RESTRICT RETURN REVOKE RIGHT RLIKE ROW ROWS ROW_NUMBER SCHEMA SCHEMAS SECOND_MICROSECOND '
    + 'SELECT SENSITIVE SEPARATOR SET SHOW SIGNAL SMALLINT SPATIAL SPECIFIC SQL SQLEXCEPTION SQLSTATE SQLWARNING '
    + 'SQL_BIG_RESULT SQL_CALC_FOUND_ROWS SQL_SMALL_RESULT SSL STARTING STORED STRAIGHT_JOIN SYSTEM TABLE TERMINATED '
    + 'THEN TINYBLOB TINYINT TINYTEXT TO TRAILING TRIGGER TRUE UNDO UNION UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING '
    + 'UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES VARBINARY VARCHAR VARCHARACTER VARYING VIRTUAL WHEN WHERE WHILE WINDOW '
    + 'WITH WRITE XOR YEAR_MONTH ZEROFILL').split(' '));

  // Funciones con nombre reservado que sí se pueden llamar con paréntesis
  const FUNCIONES_RESERVADAS = new Set(['LEFT', 'RIGHT', 'IF', 'INSERT', 'REPLACE', 'MOD', 'DATABASE', 'CHAR',
    'CONVERT', 'CURRENT_USER', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP',
    'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'REPEAT', 'SCHEMA', 'MATCH', 'VALUES', 'DEFAULT', 'INTERVAL', 'TRUNCATE',
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'EXISTS']);

  // Funciones sin paréntesis
  const SIN_PARENTESIS = new Set(['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_USER', 'LOCALTIME',
    'LOCALTIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP']);

  const ACCIONES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'];

  class Analizador {
    constructor(texto) {
      this.texto = texto;
      this.c = componentes(texto);
      this.i = 0;
    }

    get actual() { return this.c[this.i]; }
    mira(n = 1) { return this.c[Math.min(this.i + n, this.c.length - 1)]; }
    avanza() { return this.c[this.i++]; }

    error(tok) {
      return errorSintaxis(this.texto, (tok || this.actual).pos);
    }

    // ¿El componente actual es la palabra clave kw?
    es(kw, tok = this.actual) {
      return tok.tipo === 'id' && tok.valor.toUpperCase() === kw;
    }
    esOp(op, tok = this.actual) { return tok.tipo === 'op' && tok.valor === op; }

    acepta(...kws) {
      // Varias palabras seguidas: acepta('NOT', 'NULL')
      for (let k = 0; k < kws.length; k++) if (!this.es(kws[k], this.mira(k))) return false;
      this.i += kws.length;
      return true;
    }
    aceptaOp(op) {
      if (this.esOp(op)) { this.i++; return true; }
      return false;
    }
    espera(...kws) {
      for (const kw of kws) {
        if (!this.es(kw)) throw this.error();
        this.i++;
      }
    }
    esperaOp(op) {
      if (!this.esOp(op)) throw this.error();
      this.i++;
    }
    fin() {
      if (this.actual.tipo !== 'fin') throw this.error();
    }

    // Identificador: sin comillas no puede ser una palabra reservada
    identificador() {
      const t = this.actual;
      if (t.tipo === 'qid') { this.i++; return t.valor; }
      if (t.tipo === 'id' && !RESERVADAS.has(t.valor.toUpperCase())) { this.i++; return t.valor; }
      throw this.error();
    }
    esIdentificador(t = this.actual) {
      return t.tipo === 'qid' || (t.tipo === 'id' && !RESERVADAS.has(t.valor.toUpperCase()));
    }
    // Nombres de motor, juego de caracteres o colación: también entre comillas
    nombreLibre() {
      const t = this.actual;
      if (t.tipo === 'qid' || t.tipo === 'id' || t.tipo === 'str') { this.i++; return t.valor; }
      throw this.error();
    }

    // [bd.]tabla
    nombreTabla() {
      const a = this.identificador();
      if (this.esOp('.')) {
        this.i++;
        return { bd: a, nombre: this.identificadorTrasPunto() };
      }
      return { bd: null, nombre: a };
    }
    // Tras un punto, MySQL admite también palabras reservadas: bd.order
    identificadorTrasPunto() {
      const t = this.actual;
      if (t.tipo === 'qid' || t.tipo === 'id') { this.i++; return t.valor; }
      throw this.error();
    }

    entero() {
      const t = this.actual;
      if (t.tipo !== 'num' || !/^\d+$/.test(t.valor)) throw this.error();
      this.i++;
      return Number(t.valor);
    }
    cadena() {
      const t = this.actual;
      if (t.tipo !== 'str') throw this.error();
      this.i++;
      return t.valor;
    }

    // ---------- sentencias ----------

    sentencia() {
      const t = this.actual;
      if (t.tipo === 'op' && t.valor === '(') {
        const s = this.consulta();
        this.fin();
        return s;
      }
      if (t.tipo !== 'id') throw this.error();
      const kw = t.valor.toUpperCase();
      let s;
      switch (kw) {
        case 'CREATE': s = this.crear(); break;
        case 'DROP': s = this.borrar(); break;
        case 'USE': this.i++; s = { tipo: 'usar', nombre: this.identificador() }; break;
        case 'INSERT': s = this.insertar(); break;
        case 'UPDATE': s = this.actualizar(); break;
        case 'DELETE': s = this.eliminar(); break;
        case 'SELECT': case 'WITH': s = this.consulta(); break;
        case 'SHOW': s = this.mostrar(); break;
        case 'DESCRIBE': case 'DESC': case 'EXPLAIN': s = this.describir(); break;
        case 'SET': s = this.asignar(); break;
        case 'ALTER': case 'TRUNCATE': case 'RENAME': case 'GRANT': case 'REVOKE': case 'START': case 'BEGIN':
        case 'COMMIT': case 'ROLLBACK': case 'SAVEPOINT': case 'RELEASE': case 'CALL': case 'LOCK': case 'UNLOCK':
        case 'LOAD': case 'ANALYZE': case 'OPTIMIZE': case 'FLUSH': case 'KILL': case 'REPLACE': case 'HANDLER':
        case 'DO': case 'PREPARE': case 'EXECUTE': case 'DEALLOCATE': case 'CHECKSUM': case 'REPAIR': case 'CHECK':
        case 'XA': case 'INSTALL': case 'UNINSTALL': case 'RESET': case 'PURGE': case 'CHANGE': case 'IMPORT':
        case 'TABLE': case 'VALUES': case 'HELP': case 'SHUTDOWN': case 'RESTART': case 'CLONE':
          throw new NoDisponible(kw);
        default: throw this.error();
      }
      this.fin();
      return s;
    }

    crear() {
      this.espera('CREATE');
      if (this.acepta('DATABASE') || this.acepta('SCHEMA')) {
        const siNoExiste = this.acepta('IF', 'NOT', 'EXISTS');
        const nombre = this.identificador();
        const opciones = this.opcionesBaseDatos();
        return Object.assign({ tipo: 'crearBD', nombre, siNoExiste }, opciones);
      }
      if (this.es('TEMPORARY')) throw new NoDisponible('CREATE TEMPORARY TABLE');
      if (this.acepta('TABLE')) return this.crearTabla();
      const resto = this.actual.valor.toUpperCase();
      if (['UNIQUE', 'FULLTEXT', 'SPATIAL', 'INDEX'].includes(resto)) throw new NoDisponible('CREATE INDEX');
      if (['VIEW', 'OR', 'ALGORITHM', 'DEFINER', 'SQL'].includes(resto)) throw new NoDisponible('CREATE VIEW');
      if (['USER', 'ROLE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT', 'TABLESPACE', 'SERVER', 'SPATIAL',
        'LOGFILE', 'RESOURCE', 'UNDO', 'AGGREGATE'].includes(resto)) throw new NoDisponible('CREATE ' + resto);
      throw this.error();
    }

    opcionesBaseDatos() {
      const o = {};
      for (;;) {
        this.acepta('DEFAULT');
        if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) {
          this.aceptaOp('=');
          o.charset = this.nombreLibre();
        } else if (this.acepta('COLLATE')) {
          this.aceptaOp('=');
          o.collation = this.nombreLibre();
        } else if (this.acepta('ENCRYPTION')) {
          this.aceptaOp('=');
          this.cadena();
        } else break;
      }
      return o;
    }

    crearTabla() {
      const siNoExiste = this.acepta('IF', 'NOT', 'EXISTS');
      const tabla = this.nombreTabla();
      if (this.acepta('LIKE')) return { tipo: 'crearTabla', tabla, siNoExiste, como: this.nombreTabla() };
      if (this.esOp('(') && this.es('LIKE', this.mira())) {
        this.i += 2;
        const como = this.nombreTabla();
        this.esperaOp(')');
        return { tipo: 'crearTabla', tabla, siNoExiste, como };
      }
      if (this.es('SELECT') || this.es('AS')) throw new NoDisponible('CREATE TABLE ... SELECT');
      this.esperaOp('(');
      const columnas = [];
      const restricciones = [];
      do {
        if (this.esRestriccion()) restricciones.push(this.restriccion());
        else columnas.push(this.columna());
      } while (this.aceptaOp(','));
      this.esperaOp(')');
      const opciones = this.opcionesTabla();
      if (this.es('SELECT') || this.es('AS') || this.es('IGNORE') || this.es('REPLACE')) {
        throw new NoDisponible('CREATE TABLE ... SELECT');
      }
      if (this.es('PARTITION')) throw new NoDisponible('PARTITION BY');
      return { tipo: 'crearTabla', tabla, siNoExiste, columnas, restricciones, opciones };
    }

    esRestriccion() {
      const t = this.actual;
      if (t.tipo !== 'id') return false;
      return ['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'INDEX', 'KEY', 'FULLTEXT', 'SPATIAL']
        .includes(t.valor.toUpperCase());
    }

    // Partes de una clave: col [(longitud)] [ASC|DESC]
    partesClave() {
      this.esperaOp('(');
      const cols = [];
      do {
        if (this.esOp('(')) throw new NoDisponible('índices sobre expresiones');
        const nombre = this.identificador();
        let prefijo = null;
        if (this.aceptaOp('(')) { prefijo = this.entero(); this.esperaOp(')'); }
        let desc = false;
        if (this.acepta('ASC')) desc = false;
        else if (this.acepta('DESC')) desc = true;
        cols.push({ nombre, prefijo, desc });
      } while (this.aceptaOp(','));
      this.esperaOp(')');
      return cols;
    }

    opcionesIndice() {
      for (;;) {
        if (this.acepta('USING')) { this.nombreLibre(); continue; }
        if (this.acepta('COMMENT')) { this.cadena(); continue; }
        if (this.acepta('VISIBLE') || this.acepta('INVISIBLE')) continue;
        if (this.acepta('KEY_BLOCK_SIZE')) { this.aceptaOp('='); this.entero(); continue; }
        break;
      }
    }

    restriccion() {
      let simbolo = null;
      let conSimbolo = false;
      if (this.acepta('CONSTRAINT')) {
        conSimbolo = true;
        if (this.esIdentificador() && !this.esRestriccionTras()) simbolo = this.identificador();
      }
      if (this.acepta('PRIMARY')) {
        this.espera('KEY');
        if (this.acepta('USING')) this.nombreLibre();
        const columnas = this.partesClave();
        this.opcionesIndice();
        return { tipo: 'pk', simbolo, columnas };
      }
      if (this.acepta('UNIQUE')) {
        if (!this.acepta('INDEX')) this.acepta('KEY');
        const nombreIndice = this.esIdentificador() ? this.identificador() : null;
        if (this.acepta('USING')) this.nombreLibre();
        const columnas = this.partesClave();
        this.opcionesIndice();
        return { tipo: 'unico', simbolo, nombreIndice, columnas };
      }
      if (this.acepta('FOREIGN')) {
        this.espera('KEY');
        const nombreIndice = this.esIdentificador() ? this.identificador() : null;
        const columnas = this.partesClave().map((p) => p.nombre);
        const ref = this.referencias();
        return Object.assign({ tipo: 'fk', simbolo, nombreIndice, columnas }, ref);
      }
      if (this.acepta('CHECK')) {
        const expr = this.parentesis();
        const aplicada = this.aplicada();
        return { tipo: 'check', simbolo, expr, aplicada };
      }
      if (conSimbolo) throw this.error();
      if (this.acepta('INDEX') || this.acepta('KEY')) {
        const nombreIndice = this.esIdentificador() ? this.identificador() : null;
        if (this.acepta('USING')) this.nombreLibre();
        const columnas = this.partesClave();
        this.opcionesIndice();
        return { tipo: 'indice', nombreIndice, columnas };
      }
      if (this.es('FULLTEXT') || this.es('SPATIAL')) throw new NoDisponible('índices ' + this.actual.valor.toUpperCase());
      throw this.error();
    }

    // CONSTRAINT PRIMARY KEY (sin símbolo): el siguiente es palabra de restricción
    esRestriccionTras() {
      return ['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].includes(this.actual.tipo === 'id' ? this.actual.valor.toUpperCase() : '');
    }

    aplicada() {
      if (this.acepta('NOT', 'ENFORCED')) return false;
      this.acepta('ENFORCED');
      return true;
    }

    referencias() {
      this.espera('REFERENCES');
      const tablaRef = this.nombreTabla();
      const columnasRef = this.partesClave().map((p) => p.nombre);
      let alBorrar = null;
      let alActualizar = null;
      if (this.acepta('MATCH')) {
        if (!this.acepta('FULL') && !this.acepta('PARTIAL') && !this.acepta('SIMPLE')) throw this.error();
      }
      for (;;) {
        if (this.acepta('ON', 'DELETE')) { alBorrar = this.accionRef(); continue; }
        if (this.acepta('ON', 'UPDATE')) { alActualizar = this.accionRef(); continue; }
        break;
      }
      return { tablaRef, columnasRef, alBorrar, alActualizar };
    }

    accionRef() {
      if (this.acepta('RESTRICT')) return 'RESTRICT';
      if (this.acepta('CASCADE')) return 'CASCADE';
      if (this.acepta('SET', 'NULL')) return 'SET NULL';
      if (this.acepta('NO', 'ACTION')) return 'NO ACTION';
      if (this.acepta('SET', 'DEFAULT')) return 'SET DEFAULT';
      throw this.error();
    }

    columna() {
      const tokNombre = this.actual;
      const nombre = this.identificador();
      const tipo = this.tipoDato();
      const col = { nombre, tipo, nulo: null, defecto: undefined, autoInc: false, unico: false, primaria: false,
        comentario: null, checks: [], alActualizarAhora: false, tokNombre };
      for (;;) {
        if (this.acepta('NOT', 'NULL')) { col.nulo = false; continue; }
        if (this.acepta('NULL')) { col.nulo = true; continue; }
        if (this.acepta('DEFAULT')) { col.defecto = this.valorDefecto(); continue; }
        if (this.acepta('AUTO_INCREMENT')) { col.autoInc = true; continue; }
        if (this.acepta('UNIQUE')) { this.acepta('KEY'); col.unico = true; continue; }
        if (this.acepta('PRIMARY', 'KEY')) { col.primaria = true; continue; }
        if (this.acepta('KEY')) { col.primaria = true; continue; }
        if (this.acepta('COMMENT')) { col.comentario = this.cadena(); continue; }
        if (this.acepta('COLLATE')) { tipo.collation = this.nombreLibre(); continue; }
        if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) { tipo.charset = this.nombreLibre(); continue; }
        if (this.acepta('VISIBLE') || this.acepta('INVISIBLE')) continue;
        if (this.acepta('COLUMN_FORMAT')) { this.nombreLibre(); continue; }
        if (this.acepta('STORAGE')) { this.nombreLibre(); continue; }
        if (this.es('CONSTRAINT') || this.es('CHECK')) {
          let simbolo = null;
          if (this.acepta('CONSTRAINT')) {
            if (this.esIdentificador() && !this.es('CHECK')) simbolo = this.identificador();
          }
          this.espera('CHECK');
          const expr = this.parentesis();
          col.checks.push({ simbolo, expr, aplicada: this.aplicada() });
          continue;
        }
        if (this.es('REFERENCES')) {
          // MySQL analiza la referencia en línea y la descarta
          col.referenciaEnLinea = this.referencias();
          continue;
        }
        if (this.acepta('ON', 'UPDATE')) {
          const f = this.actual;
          const nombreF = f.tipo === 'id' ? f.valor.toUpperCase() : '';
          if (!['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP'].includes(nombreF)) throw this.error();
          this.i++;
          if (this.aceptaOp('(')) this.esperaOp(')');
          col.alActualizarAhora = true;
          continue;
        }
        if (this.es('GENERATED') || this.es('AS')) throw new NoDisponible('columnas generadas');
        if (this.es('SRID')) throw new NoDisponible('SRID');
        break;
      }
      return col;
    }

    // DEFAULT: literal, NULL, CURRENT_TIMESTAMP o (expresión)
    valorDefecto() {
      const t = this.actual;
      if (this.esOp('(')) {
        const tok = this.actual;
        return { expresion: this.parentesis(), tok };
      }
      if (this.es('NULL')) { this.i++; return { nulo: true }; }
      const nombreF = t.tipo === 'id' ? t.valor.toUpperCase() : '';
      if (['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP'].includes(nombreF)) {
        this.i++;
        if (this.aceptaOp('(')) {
          if (!this.esOp(')')) this.entero();
          this.esperaOp(')');
        } else if (nombreF === 'NOW') throw this.error(t);
        return { ahora: true };
      }
      if (this.es('TRUE') || this.es('FALSE')) {
        this.i++;
        return { literal: { t: 'num', v: nombreF === 'TRUE' ? '1' : '0' } };
      }
      let signo = '';
      if (this.esOp('-') || this.esOp('+')) signo = this.avanza().valor === '-' ? '-' : '';
      const v = this.actual;
      if (v.tipo === 'num') { this.i++; return { literal: { t: 'num', v: signo + v.valor } }; }
      if (signo) throw this.error();
      if (v.tipo === 'str') { this.i++; return { literal: { t: 'str', v: v.valor } }; }
      if (v.tipo === 'hex' || v.tipo === 'bin') { this.i++; return { literal: { t: v.tipo, v: v.valor } }; }
      if (v.tipo === 'id' && /^_[a-z0-9]+$/i.test(v.valor) && this.mira().tipo === 'str') {
        this.i++;
        return { literal: { t: 'str', v: this.avanza().valor } };
      }
      throw this.error();
    }

    tipoDato() {
      const t = this.actual;
      if (t.tipo !== 'id') throw this.error();
      let base = t.valor.toUpperCase();
      this.i++;
      const tipo = { base: null };
      const ancho = () => {
        if (this.aceptaOp('(')) { const n = this.entero(); this.esperaOp(')'); return n; }
        return null;
      };
      const signo = () => {
        for (;;) {
          if (this.acepta('UNSIGNED')) { tipo.sinSigno = true; continue; }
          if (this.acepta('SIGNED')) continue;
          if (this.acepta('ZEROFILL')) { tipo.zerofill = true; tipo.sinSigno = true; continue; }
          break;
        }
      };
      const enteros = { TINYINT: 'tinyint', INT1: 'tinyint', SMALLINT: 'smallint', INT2: 'smallint',
        MEDIUMINT: 'mediumint', INT3: 'mediumint', MIDDLEINT: 'mediumint', INT: 'int', INTEGER: 'int', INT4: 'int',
        BIGINT: 'bigint', INT8: 'bigint' };
      if (enteros[base]) {
        tipo.base = enteros[base];
        tipo.ancho = ancho();
        signo();
        return tipo;
      }
      if (base === 'BOOL' || base === 'BOOLEAN') return { base: 'tinyint', ancho: 1, booleano: true };
      if (base === 'BIT') { tipo.base = 'bit'; tipo.longitud = ancho() || 1; return tipo; }
      if (['DECIMAL', 'DEC', 'NUMERIC', 'FIXED'].includes(base)) {
        tipo.base = 'decimal';
        tipo.p = 10;
        tipo.s = 0;
        if (this.aceptaOp('(')) {
          tipo.p = this.entero();
          if (this.aceptaOp(',')) tipo.s = this.entero();
          this.esperaOp(')');
          tipo.explicito = true;
        }
        signo();
        return tipo;
      }
      if (['FLOAT', 'FLOAT4', 'DOUBLE', 'FLOAT8', 'REAL'].includes(base)) {
        if (base === 'DOUBLE') this.acepta('PRECISION');
        tipo.base = base === 'FLOAT' || base === 'FLOAT4' ? 'float' : 'double';
        if (this.aceptaOp('(')) {
          const p = this.entero();
          if (this.aceptaOp(',')) {
            tipo.p = p;
            tipo.s = this.entero();
          } else if (tipo.base === 'float') {
            if (p > 24) tipo.base = 'double';
          } else throw this.error();
          this.esperaOp(')');
        }
        signo();
        return tipo;
      }
      if (base === 'NATIONAL') {
        base = this.actual.valor.toUpperCase();
        this.i++;
      }
      if (['CHAR', 'CHARACTER', 'NCHAR'].includes(base)) {
        if (this.acepta('VARYING')) {
          tipo.base = 'varchar';
          tipo.longitud = ancho();
          if (tipo.longitud === null) throw this.error();
        } else {
          tipo.base = 'char';
          const n = ancho();
          tipo.longitud = n === null ? 1 : n;
        }
        if (base === 'NCHAR') tipo.charset = 'utf8mb3';
        this.atributosTexto(tipo);
        return tipo;
      }
      if (['VARCHAR', 'NVARCHAR', 'VARCHARACTER'].includes(base)) {
        tipo.base = 'varchar';
        if (!this.esOp('(')) throw this.error();
        tipo.longitud = ancho();
        if (base === 'NVARCHAR') tipo.charset = 'utf8mb3';
        this.atributosTexto(tipo);
        return tipo;
      }
      if (base === 'BINARY') { tipo.base = 'binary'; const n = ancho(); tipo.longitud = n === null ? 1 : n; return tipo; }
      if (base === 'VARBINARY') {
        tipo.base = 'varbinary';
        if (!this.esOp('(')) throw this.error();
        tipo.longitud = ancho();
        return tipo;
      }
      const textos = { TINYTEXT: 'tinytext', TEXT: 'text', MEDIUMTEXT: 'mediumtext', LONGTEXT: 'longtext' };
      if (textos[base]) {
        tipo.base = textos[base];
        if (base === 'TEXT') ancho();
        this.atributosTexto(tipo);
        return tipo;
      }
      if (base === 'LONG') {
        if (this.acepta('VARCHAR')) { tipo.base = 'mediumtext'; this.atributosTexto(tipo); return tipo; }
        throw new NoDisponible('LONG');
      }
      const blobs = { TINYBLOB: 'tinyblob', BLOB: 'blob', MEDIUMBLOB: 'mediumblob', LONGBLOB: 'longblob' };
      if (blobs[base]) {
        tipo.base = blobs[base];
        if (base === 'BLOB') ancho();
        return tipo;
      }
      if (base === 'ENUM' || base === 'SET') {
        tipo.base = base.toLowerCase();
        this.esperaOp('(');
        tipo.valores = [];
        do {
          const v = this.actual;
          if (v.tipo !== 'str') throw this.error();
          this.i++;
          tipo.valores.push(v.valor);
        } while (this.aceptaOp(','));
        this.esperaOp(')');
        this.atributosTexto(tipo);
        return tipo;
      }
      if (base === 'DATE') { tipo.base = 'date'; return tipo; }
      if (base === 'TIME' || base === 'DATETIME' || base === 'TIMESTAMP') {
        tipo.base = base.toLowerCase();
        tipo.fsp = ancho() || 0;
        return tipo;
      }
      if (base === 'YEAR') { tipo.base = 'year'; const n = ancho(); if (n !== null && n !== 4) throw this.error(); return tipo; }
      if (base === 'JSON') { tipo.base = 'json'; return tipo; }
      if (base === 'SERIAL') throw new NoDisponible('SERIAL');
      if (['GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON',
        'GEOMETRYCOLLECTION'].includes(base)) throw new NoDisponible('tipos espaciales');
      throw this.error(t);
    }

    atributosTexto(tipo) {
      for (;;) {
        if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) { tipo.charset = this.nombreLibre(); continue; }
        if (this.acepta('COLLATE')) { tipo.collation = this.nombreLibre(); continue; }
        if (this.acepta('BINARY')) { tipo.binario = true; continue; }
        if (this.acepta('ASCII')) { tipo.charset = 'latin1'; continue; }
        if (this.acepta('UNICODE')) { tipo.charset = 'ucs2'; continue; }
        break;
      }
    }

    opcionesTabla() {
      const o = {};
      for (;;) {
        this.aceptaOp(',');
        if (this.acepta('ENGINE') || this.acepta('TYPE')) { this.aceptaOp('='); o.motor = this.nombreLibre(); continue; }
        const conDefecto = this.acepta('DEFAULT');
        if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) { this.aceptaOp('='); o.charset = this.nombreLibre(); continue; }
        if (this.acepta('COLLATE')) { this.aceptaOp('='); o.collation = this.nombreLibre(); continue; }
        if (conDefecto) throw this.error();
        if (this.acepta('AUTO_INCREMENT')) { this.aceptaOp('='); o.autoInc = this.entero(); continue; }
        if (this.acepta('COMMENT')) { this.aceptaOp('='); o.comentario = this.cadena(); continue; }
        if (this.acepta('ROW_FORMAT')) { this.aceptaOp('='); this.nombreLibre(); continue; }
        if (this.acepta('KEY_BLOCK_SIZE') || this.acepta('AVG_ROW_LENGTH') || this.acepta('MAX_ROWS')
          || this.acepta('MIN_ROWS') || this.acepta('STATS_PERSISTENT') || this.acepta('STATS_AUTO_RECALC')
          || this.acepta('PACK_KEYS') || this.acepta('CHECKSUM') || this.acepta('DELAY_KEY_WRITE')) {
          this.aceptaOp('=');
          this.avanza();
          continue;
        }
        break;
      }
      return o;
    }

    borrar() {
      this.espera('DROP');
      if (this.acepta('DATABASE') || this.acepta('SCHEMA')) {
        const siExiste = this.acepta('IF', 'EXISTS');
        return { tipo: 'borrarBD', nombre: this.identificador(), siExiste };
      }
      if (this.es('TEMPORARY')) throw new NoDisponible('DROP TEMPORARY TABLE');
      if (this.acepta('TABLE') || this.acepta('TABLES')) {
        const siExiste = this.acepta('IF', 'EXISTS');
        const tablas = [];
        do tablas.push(this.nombreTabla()); while (this.aceptaOp(','));
        if (!this.acepta('RESTRICT')) this.acepta('CASCADE');
        return { tipo: 'borrarTabla', tablas, siExiste };
      }
      const resto = this.actual.tipo === 'id' ? this.actual.valor.toUpperCase() : '';
      if (['INDEX', 'VIEW', 'USER', 'ROLE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT', 'TABLESPACE', 'SERVER',
        'SPATIAL', 'LOGFILE', 'RESOURCE', 'UNDO', 'ONLINE', 'OFFLINE'].includes(resto)) throw new NoDisponible('DROP ' + resto);
      throw this.error();
    }

    insertar() {
      this.espera('INSERT');
      if (this.es('LOW_PRIORITY') || this.es('DELAYED') || this.es('HIGH_PRIORITY')) this.i++;
      if (this.es('IGNORE')) throw new NoDisponible('INSERT IGNORE');
      this.acepta('INTO');
      const tabla = this.nombreTabla();
      if (this.es('PARTITION')) throw new NoDisponible('PARTITION');
      let columnas = null;
      if (this.esOp('(') && !this.es('SELECT', this.mira())) {
        this.i++;
        columnas = [];
        if (!this.esOp(')')) {
          do {
            let nombre = this.identificador();
            // tabla.columna
            if (this.aceptaOp('.')) nombre = this.identificadorTrasPunto();
            columnas.push(nombre);
          } while (this.aceptaOp(','));
        }
        this.esperaOp(')');
      }
      let filas = null;
      let consulta = null;
      let asignaciones = null;
      if (this.acepta('VALUES') || this.acepta('VALUE')) {
        filas = [];
        do {
          this.acepta('ROW');
          this.esperaOp('(');
          const fila = [];
          if (!this.esOp(')')) {
            do fila.push(this.es('DEFAULT') && !this.esOp('(', this.mira()) ? (this.i++, { t: 'defecto' }) : this.expr());
            while (this.aceptaOp(','));
          }
          this.esperaOp(')');
          filas.push(fila);
        } while (this.aceptaOp(','));
      } else if (this.acepta('SET')) {
        if (columnas) throw this.error();
        asignaciones = this.asignaciones();
      } else if (this.es('SELECT') || this.esOp('(') || this.es('WITH')) {
        consulta = this.consulta();
      } else if (this.es('TABLE')) {
        throw new NoDisponible('INSERT ... TABLE');
      } else throw this.error();
      if (this.es('AS')) throw new NoDisponible('INSERT ... AS alias');
      if (this.es('ON')) throw new NoDisponible('ON DUPLICATE KEY UPDATE');
      return { tipo: 'insertar', tabla, columnas, filas, consulta, asignaciones };
    }

    asignaciones() {
      const lista = [];
      do {
        let columna = this.identificador();
        let tablaCol = null;
        if (this.aceptaOp('.')) { tablaCol = columna; columna = this.identificadorTrasPunto(); }
        this.esperaOp('=');
        const expr = this.es('DEFAULT') && !this.esOp('(', this.mira()) ? (this.i++, { t: 'defecto' }) : this.expr();
        lista.push({ columna, tablaCol, expr });
      } while (this.aceptaOp(','));
      return lista;
    }

    actualizar() {
      this.espera('UPDATE');
      if (this.es('LOW_PRIORITY')) this.i++;
      if (this.es('IGNORE')) throw new NoDisponible('UPDATE IGNORE');
      const tabla = this.nombreTabla();
      let alias = null;
      if (this.acepta('AS') || this.esIdentificador()) alias = this.identificador();
      if (this.esOp(',') || this.es('JOIN') || this.es('INNER') || this.es('LEFT')) throw new NoDisponible('UPDATE de varias tablas');
      this.espera('SET');
      const asignaciones = this.asignaciones();
      const donde = this.acepta('WHERE') ? this.expr() : null;
      const ordenar = this.acepta('ORDER', 'BY') ? this.listaOrden() : [];
      const limite = this.acepta('LIMIT') ? this.entero() : null;
      return { tipo: 'actualizar', tabla, alias, asignaciones, donde, ordenar, limite };
    }

    eliminar() {
      this.espera('DELETE');
      if (this.es('LOW_PRIORITY') || this.es('QUICK')) this.i++;
      if (this.es('IGNORE')) throw new NoDisponible('DELETE IGNORE');
      if (!this.es('FROM')) throw new NoDisponible('DELETE de varias tablas');
      this.espera('FROM');
      const tabla = this.nombreTabla();
      let alias = null;
      if (this.acepta('AS') || this.esIdentificador()) alias = this.identificador();
      if (this.esOp(',') || this.es('USING')) throw new NoDisponible('DELETE de varias tablas');
      const donde = this.acepta('WHERE') ? this.expr() : null;
      const ordenar = this.acepta('ORDER', 'BY') ? this.listaOrden() : [];
      const limite = this.acepta('LIMIT') ? this.entero() : null;
      return { tipo: 'eliminar', tabla, alias, donde, ordenar, limite };
    }

    mostrar() {
      this.espera('SHOW');
      if (this.acepta('DATABASES') || this.acepta('SCHEMAS')) {
        return { tipo: 'mostrar', que: 'bases', patron: this.patronMostrar() };
      }
      const completo = this.acepta('FULL');
      if (this.acepta('TABLES')) {
        let bd = null;
        if (this.acepta('FROM') || this.acepta('IN')) bd = this.identificador();
        return { tipo: 'mostrar', que: 'tablas', bd, completo, patron: this.patronMostrar() };
      }
      if (this.acepta('COLUMNS') || this.acepta('FIELDS')) {
        if (!this.acepta('FROM')) this.espera('IN');
        const tabla = this.nombreTabla();
        if (this.acepta('FROM') || this.acepta('IN')) tabla.bd = this.identificador();
        return { tipo: 'mostrar', que: 'columnas', tabla, completo, patron: this.patronMostrar() };
      }
      if (completo) throw this.error();
      if (this.acepta('CREATE', 'TABLE')) return { tipo: 'mostrar', que: 'crearTabla', tabla: this.nombreTabla() };
      if (this.acepta('CREATE', 'DATABASE') || this.acepta('CREATE', 'SCHEMA')) {
        const siNoExiste = this.acepta('IF', 'NOT', 'EXISTS');
        return { tipo: 'mostrar', que: 'crearBD', nombre: this.identificador(), siNoExiste };
      }
      if (this.acepta('INDEX') || this.acepta('INDEXES') || this.acepta('KEYS')) {
        if (!this.acepta('FROM')) this.espera('IN');
        const tabla = this.nombreTabla();
        if (this.acepta('FROM') || this.acepta('IN')) tabla.bd = this.identificador();
        if (this.es('WHERE')) throw new NoDisponible('SHOW INDEX ... WHERE');
        return { tipo: 'mostrar', que: 'indices', tabla };
      }
      if (this.acepta('STORAGE', 'ENGINES') || this.acepta('ENGINES')) return { tipo: 'mostrar', que: 'motores' };
      if (this.acepta('WARNINGS')) { this.limiteMostrar(); return { tipo: 'mostrar', que: 'avisos' }; }
      if (this.acepta('ERRORS')) { this.limiteMostrar(); return { tipo: 'mostrar', que: 'errores' }; }
      if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) return { tipo: 'mostrar', que: 'charsets', patron: this.patronMostrar() };
      if (this.acepta('COLLATION')) return { tipo: 'mostrar', que: 'colaciones', patron: this.patronMostrar() };
      if (this.es('COUNT')) throw new NoDisponible('SHOW COUNT');
      throw new NoDisponible('SHOW ' + (this.actual.valor || '').toUpperCase());
    }

    patronMostrar() {
      if (this.acepta('LIKE')) return this.cadena();
      if (this.es('WHERE')) throw new NoDisponible('SHOW ... WHERE');
      return null;
    }
    limiteMostrar() {
      if (this.acepta('LIMIT')) { this.entero(); if (this.aceptaOp(',')) this.entero(); }
    }

    describir() {
      this.avanza();
      if (this.es('SELECT') || this.es('FORMAT') || this.es('ANALYZE') || this.es('INSERT') || this.es('UPDATE')
        || this.es('DELETE') || this.es('EXTENDED') || this.es('PARTITIONS') || this.esOp('(')) throw new NoDisponible('EXPLAIN');
      const tabla = this.nombreTabla();
      let columna = null;
      if (this.actual.tipo !== 'fin') {
        columna = this.actual.tipo === 'str' ? this.cadena() : this.identificador();
      }
      return { tipo: 'mostrar', que: 'columnas', tabla, columna, describir: true };
    }

    asignar() {
      this.espera('SET');
      if (this.acepta('NAMES')) {
        if (!this.acepta('DEFAULT')) {
          this.nombreLibre();
          if (this.acepta('COLLATE')) this.nombreLibre();
        }
        return { tipo: 'nada' };
      }
      if (this.acepta('CHARACTER', 'SET') || this.acepta('CHARSET')) { this.nombreLibre(); return { tipo: 'nada' }; }
      const lista = [];
      do {
        const t = this.actual;
        if (t.tipo === 'var' && !t.valor.startsWith('@@')) {
          this.i++;
          if (!this.aceptaOp('=')) this.esperaOp(':=');
          lista.push({ variable: t.valor.slice(1).toLowerCase(), expr: this.expr() });
          continue;
        }
        let nombre;
        if (t.tipo === 'var') { this.i++; nombre = t.valor.replace(/^@@(session\.|local\.)?/i, ''); }
        else {
          this.acepta('SESSION') || this.acepta('LOCAL');
          if (this.es('GLOBAL') || this.es('PERSIST') || this.es('PERSIST_ONLY')) throw new NoDisponible('SET GLOBAL');
          if (this.es('TRANSACTION')) throw new NoDisponible('SET TRANSACTION');
          if (this.es('PASSWORD') || this.es('ROLE') || this.es('DEFAULT')) throw new NoDisponible('SET ' + t.valor.toUpperCase());
          nombre = this.identificador();
        }
        if (!this.aceptaOp('=')) this.esperaOp(':=');
        const v = this.actual;
        let valor;
        if (v.tipo === 'id' && (['ON', 'OFF', 'DEFAULT'].includes(v.valor.toUpperCase()) || this.mira().tipo === 'fin' || this.esOp(',', this.mira()))) {
          this.i++;
          valor = { t: 'id', v: ['ON', 'OFF', 'DEFAULT'].includes(v.valor.toUpperCase()) ? v.valor.toUpperCase() : v.valor };
        }
        else valor = this.expr();
        lista.push({ sistema: nombre.toLowerCase(), expr: valor });
      } while (this.aceptaOp(','));
      return { tipo: 'asignar', lista };
    }

    // ---------- consultas ----------

    consulta() {
      if (this.es('WITH')) throw new NoDisponible('WITH (expresiones de tabla comunes)');
      let izq = this.bloqueConsulta();
      for (;;) {
        let op = null;
        if (this.acepta('UNION')) op = 'UNION';
        else if (this.acepta('INTERSECT')) op = 'INTERSECT';
        else if (this.acepta('EXCEPT')) op = 'EXCEPT';
        else break;
        let todos = false;
        if (this.acepta('ALL')) todos = true;
        else this.acepta('DISTINCT');
        const der = this.bloqueConsulta();
        izq = { tipo: 'conjunto', op, todos, izq, der, ordenar: [], limite: null };
      }
      if (izq.tipo === 'conjunto') {
        if (this.acepta('ORDER', 'BY')) izq.ordenar = this.listaOrden();
        if (this.acepta('LIMIT')) izq.limite = this.limite();
      }
      if (this.es('FOR') || this.es('LOCK')) throw new NoDisponible('SELECT ... FOR UPDATE / LOCK IN SHARE MODE');
      if (this.es('INTO')) throw new NoDisponible('SELECT ... INTO');
      return izq;
    }

    bloqueConsulta() {
      if (this.aceptaOp('(')) {
        const s = this.consulta();
        this.esperaOp(')');
        return s;
      }
      return this.seleccion();
    }

    seleccion() {
      this.espera('SELECT');
      const s = { tipo: 'seleccionar', distinto: false, columnas: [], desde: [], donde: null, agrupar: [],
        teniendo: null, ordenar: [], limite: null };
      for (;;) {
        if (this.acepta('DISTINCT') || this.acepta('DISTINCTROW')) { s.distinto = true; continue; }
        if (this.acepta('ALL')) continue;
        if (this.acepta('SQL_CALC_FOUND_ROWS') || this.acepta('SQL_NO_CACHE') || this.acepta('SQL_CACHE')
          || this.acepta('STRAIGHT_JOIN') || this.acepta('HIGH_PRIORITY') || this.acepta('SQL_SMALL_RESULT')
          || this.acepta('SQL_BIG_RESULT') || this.acepta('SQL_BUFFER_RESULT')) continue;
        break;
      }
      do s.columnas.push(this.columnaSelect()); while (this.aceptaOp(','));
      if (this.es('INTO')) throw new NoDisponible('SELECT ... INTO');
      if (this.acepta('FROM')) {
        if (this.acepta('DUAL')) s.desde = [];
        else s.desde = this.referenciasTabla();
      }
      if (this.acepta('WHERE')) s.donde = this.expr();
      if (this.acepta('GROUP', 'BY')) {
        do {
          const e = this.expr();
          if (this.acepta('ASC') || this.acepta('DESC')) { /* obsoleto, se ignora */ }
          s.agrupar.push(e);
        } while (this.aceptaOp(','));
        if (this.acepta('WITH', 'ROLLUP')) throw new NoDisponible('WITH ROLLUP');
      }
      if (this.acepta('HAVING')) s.teniendo = this.expr();
      if (this.es('WINDOW')) throw new NoDisponible('WINDOW');
      if (this.acepta('ORDER', 'BY')) s.ordenar = this.listaOrden();
      if (this.acepta('LIMIT')) s.limite = this.limite();
      return s;
    }

    limite() {
      const a = this.expr();
      if (this.aceptaOp(',')) return { desplazamiento: a, n: this.expr() };
      if (this.acepta('OFFSET')) return { n: a, desplazamiento: this.expr() };
      return { n: a, desplazamiento: null };
    }

    listaOrden() {
      const lista = [];
      do {
        const expr = this.expr();
        let desc = false;
        if (this.acepta('DESC')) desc = true;
        else this.acepta('ASC');
        lista.push({ expr, desc });
      } while (this.aceptaOp(','));
      return lista;
    }

    columnaSelect() {
      if (this.esOp('*')) { this.i++; return { expr: { t: 'estrella', tabla: null } }; }
      // t.* y bd.t.*
      if ((this.actual.tipo === 'id' || this.actual.tipo === 'qid') && this.esOp('.', this.mira())) {
        if (this.esOp('*', this.mira(2))) {
          const tabla = this.identificadorTrasPunto();
          this.i += 2;
          return { expr: { t: 'estrella', tabla } };
        }
        if ((this.mira(2).tipo === 'id' || this.mira(2).tipo === 'qid') && this.esOp('.', this.mira(3)) && this.esOp('*', this.mira(4))) {
          const bd = this.identificadorTrasPunto();
          this.i++;
          const tabla = this.identificadorTrasPunto();
          this.i += 2;
          return { expr: { t: 'estrella', tabla, bd } };
        }
      }
      const desde = this.actual.pos;
      const expr = this.expr();
      const texto = this.texto.slice(desde, this.c[this.i - 1].pos + this.longitudComponente(this.c[this.i - 1]));
      let alias = null;
      if (this.acepta('AS')) {
        alias = this.actual.tipo === 'str' ? this.cadena() : this.identificador();
      } else if (this.esIdentificador() || this.actual.tipo === 'str') {
        alias = this.actual.tipo === 'str' ? this.cadena() : this.identificador();
      }
      return { expr, alias, texto };
    }

    // Longitud en el texto original de un componente (para el nombre de las
    // columnas del resultado, que MySQL toma del texto de la expresión)
    longitudComponente(t) {
      const sig = this.c[this.c.indexOf(t) + 1];
      let fin = sig ? sig.pos : this.texto.length;
      let trozo = this.texto.slice(t.pos, fin);
      return trozo.replace(/\s+$/, '').replace(/(--\s.*|#.*|\/\*[\s\S]*?\*\/)\s*$/, '').replace(/\s+$/, '').length;
    }

    referenciasTabla() {
      const lista = [];
      do lista.push(this.referenciaUnion()); while (this.aceptaOp(','));
      return lista;
    }

    referenciaUnion() {
      let izq = this.factorTabla();
      for (;;) {
        let tipo = null;
        let natural = false;
        if (this.acepta('NATURAL')) {
          natural = true;
          if (this.acepta('LEFT')) { this.acepta('OUTER'); tipo = 'LEFT'; }
          else if (this.acepta('RIGHT')) { this.acepta('OUTER'); tipo = 'RIGHT'; }
          else { this.acepta('INNER'); tipo = 'INNER'; }
          this.espera('JOIN');
        } else if (this.acepta('JOIN') || this.acepta('INNER', 'JOIN')) tipo = 'INNER';
        else if (this.acepta('CROSS', 'JOIN')) tipo = 'CROSS';
        else if (this.acepta('STRAIGHT_JOIN')) tipo = 'INNER';
        else if (this.acepta('LEFT')) { this.acepta('OUTER'); this.espera('JOIN'); tipo = 'LEFT'; }
        else if (this.acepta('RIGHT')) { this.acepta('OUTER'); this.espera('JOIN'); tipo = 'RIGHT'; }
        else break;
        const der = tipo === 'INNER' || tipo === 'CROSS' ? this.factorTabla() : this.factorTablaConUniones();
        const union = { t: 'union', tipo, natural, izq, der, on: null, using: null };
        if (!natural) {
          if (this.acepta('ON')) union.on = this.expr();
          else if (this.acepta('USING')) {
            this.esperaOp('(');
            union.using = [];
            do union.using.push(this.identificador()); while (this.aceptaOp(','));
            this.esperaOp(')');
          } else if (tipo === 'LEFT' || tipo === 'RIGHT') throw this.error();
        }
        izq = union;
      }
      return izq;
    }

    factorTablaConUniones() {
      return this.factorTabla();
    }

    factorTabla() {
      if (this.esOp('(')) {
        if (this.es('SELECT', this.mira()) || this.esOp('(', this.mira())) {
          this.i++;
          const consulta = this.consulta();
          this.esperaOp(')');
          this.acepta('AS');
          if (this.es('LATERAL')) throw new NoDisponible('LATERAL');
          const alias = this.identificador();
          return { t: 'subconsulta', consulta, alias };
        }
        this.i++;
        const dentro = this.referenciasTabla();
        this.esperaOp(')');
        return dentro.length === 1 ? dentro[0] : { t: 'lista', elementos: dentro };
      }
      if (this.es('LATERAL') || this.es('JSON_TABLE')) throw new NoDisponible(this.actual.valor.toUpperCase());
      const tabla = this.nombreTabla();
      let alias = null;
      if (this.acepta('AS')) alias = this.identificador();
      else if (this.esIdentificador() && !this.esPalabraTrasTabla()) alias = this.identificador();
      if (this.es('USE') || this.es('FORCE') || this.es('IGNORE')) throw new NoDisponible('indicaciones de índice');
      return { t: 'tabla', bd: tabla.bd, nombre: tabla.nombre, alias };
    }

    // Palabras no reservadas que pueden seguir a una tabla y no son su alias
    esPalabraTrasTabla() {
      return false;
    }

    // ---------- expresiones ----------

    parentesis() {
      this.esperaOp('(');
      const e = this.expr();
      this.esperaOp(')');
      return e;
    }

    expr() {
      return this.exprO();
    }

    exprO() {
      let a = this.exprXor();
      while (this.es('OR') || this.esOp('||')) {
        this.i++;
        a = { t: 'bin', op: 'OR', a, b: this.exprXor() };
      }
      return a;
    }

    exprXor() {
      let a = this.exprY();
      while (this.acepta('XOR')) a = { t: 'bin', op: 'XOR', a, b: this.exprY() };
      return a;
    }

    exprY() {
      let a = this.exprNo();
      while (this.es('AND') || this.esOp('&&')) {
        this.i++;
        a = { t: 'bin', op: 'AND', a, b: this.exprNo() };
      }
      return a;
    }

    exprNo() {
      if (this.es('NOT') && !this.es('EXISTS', this.mira())) {
        this.i++;
        return { t: 'un', op: 'NOT', a: this.exprNo() };
      }
      return this.predicado();
    }

    predicado() {
      let a = this.bitO();
      for (;;) {
        const t = this.actual;
        if (t.tipo === 'op' && ['=', '<=>', '>=', '>', '<=', '<', '<>', '!='].includes(t.valor)) {
          this.i++;
          const op = t.valor === '!=' ? '<>' : t.valor;
          if (this.es('ANY') || this.es('SOME') || this.es('ALL')) {
            const cuant = this.avanza().valor.toUpperCase();
            this.esperaOp('(');
            const consulta = this.consulta();
            this.esperaOp(')');
            a = { t: 'cuantificada', op, cuant: cuant === 'SOME' ? 'ANY' : cuant, a, consulta };
            continue;
          }
          a = { t: 'bin', op, a, b: this.bitO() };
          continue;
        }
        if (this.es('IS')) {
          this.i++;
          const neg = this.acepta('NOT');
          if (this.acepta('NULL')) { a = { t: 'esNulo', a, neg }; continue; }
          if (this.acepta('TRUE')) { a = { t: 'esValor', a, valor: true, neg }; continue; }
          if (this.acepta('FALSE')) { a = { t: 'esValor', a, valor: false, neg }; continue; }
          if (this.acepta('UNKNOWN')) { a = { t: 'esNulo', a, neg }; continue; }
          throw this.error();
        }
        const neg = this.es('NOT') && ['BETWEEN', 'IN', 'LIKE', 'REGEXP', 'RLIKE'].includes((this.mira().valor || '').toUpperCase())
          && this.mira().tipo === 'id';
        if (neg) this.i++;
        if (this.acepta('BETWEEN')) {
          const b = this.bitO();
          this.espera('AND');
          const c = this.bitO();
          a = { t: 'entre', a, b, c, neg };
          continue;
        }
        if (this.acepta('IN')) {
          this.esperaOp('(');
          if (this.es('SELECT') || this.es('WITH') || (this.esOp('(') && this.es('SELECT', this.mira()))) {
            const consulta = this.consulta();
            this.esperaOp(')');
            a = { t: 'en', a, consulta, neg };
          } else {
            const lista = [];
            do lista.push(this.expr()); while (this.aceptaOp(','));
            this.esperaOp(')');
            a = { t: 'en', a, lista, neg };
          }
          continue;
        }
        if (this.acepta('LIKE')) {
          const patron = this.bitO();
          const escape = this.acepta('ESCAPE') ? this.bitO() : null;
          a = { t: 'como', a, patron, escape, neg };
          continue;
        }
        if (this.acepta('REGEXP') || this.acepta('RLIKE')) {
          a = { t: 'regexp', a, patron: this.bitO(), neg };
          continue;
        }
        if (neg) throw this.error();
        if (this.es('SOUNDS') || this.es('MEMBER')) throw new NoDisponible(this.actual.valor.toUpperCase());
        break;
      }
      return a;
    }

    bitO() {
      let a = this.bitY();
      while (this.esOp('|')) { this.i++; a = { t: 'bin', op: '|', a, b: this.bitY() }; }
      return a;
    }
    bitY() {
      let a = this.desplazamiento();
      while (this.esOp('&')) { this.i++; a = { t: 'bin', op: '&', a, b: this.desplazamiento() }; }
      return a;
    }
    desplazamiento() {
      let a = this.suma();
      while (this.esOp('<<') || this.esOp('>>')) { const op = this.avanza().valor; a = { t: 'bin', op, a, b: this.suma() }; }
      return a;
    }
    suma() {
      let a = this.producto();
      for (;;) {
        if (this.esOp('+') || this.esOp('-')) {
          const op = this.avanza().valor;
          if (this.es('INTERVAL')) {
            this.i++;
            const intervalo = this.intervalo();
            a = { t: 'func', nombre: op === '+' ? 'DATE_ADD' : 'DATE_SUB', args: [a, intervalo] };
            continue;
          }
          a = { t: 'bin', op, a, b: this.producto() };
          continue;
        }
        break;
      }
      return a;
    }
    producto() {
      let a = this.bitXor();
      for (;;) {
        if (this.esOp('*') || this.esOp('/') || this.esOp('%')) { const op = this.avanza().valor; a = { t: 'bin', op, a, b: this.bitXor() }; continue; }
        if (this.acepta('DIV')) { a = { t: 'bin', op: 'DIV', a, b: this.bitXor() }; continue; }
        if (this.es('MOD') && !this.esOp('(', this.mira())) { this.i++; a = { t: 'bin', op: '%', a, b: this.bitXor() }; continue; }
        break;
      }
      return a;
    }
    bitXor() {
      let a = this.unario();
      while (this.esOp('^')) { this.i++; a = { t: 'bin', op: '^', a, b: this.unario() }; }
      return a;
    }
    unario() {
      if (this.esOp('-')) {
        this.i++;
        const a = this.unario();
        if (a.t === 'num' && !a.v.startsWith('-')) return { t: 'num', v: '-' + a.v };
        return { t: 'un', op: '-', a };
      }
      if (this.esOp('+')) { this.i++; return this.unario(); }
      if (this.esOp('~')) { this.i++; return { t: 'un', op: '~', a: this.unario() }; }
      if (this.esOp('!')) { this.i++; return { t: 'un', op: 'NOT', a: this.unario() }; }
      if (this.es('BINARY') && !this.esOp('(', this.mira())) { this.i++; return { t: 'binario', a: this.unario() }; }
      let a = this.primario();
      while (this.acepta('COLLATE')) a = { t: 'colacion', a, colacion: this.nombreLibre() };
      return a;
    }

    intervalo() {
      const valor = this.expr();
      const t = this.actual;
      const unidades = ['MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
      if (t.tipo !== 'id' || !unidades.includes(t.valor.toUpperCase())) {
        if (t.tipo === 'id') throw new NoDisponible('INTERVAL ' + t.valor.toUpperCase());
        throw this.error();
      }
      this.i++;
      return { t: 'intervalo', valor, unidad: t.valor.toUpperCase() };
    }

    primario() {
      const t = this.actual;
      switch (t.tipo) {
        case 'num': this.i++; return { t: 'num', v: t.valor };
        case 'str': {
          this.i++;
          let v = t.valor;
          // Cadenas contiguas se concatenan: 'a' 'b'
          while (this.actual.tipo === 'str') v += this.avanza().valor;
          return { t: 'str', v };
        }
        case 'hex': this.i++; return { t: 'hex', v: t.valor };
        case 'bin': this.i++; return { t: 'bitlit', v: t.valor };
        case 'var':
          this.i++;
          if (t.valor.startsWith('@@')) return { t: 'varSistema', nombre: t.valor.replace(/^@@(session\.|global\.|local\.)?/i, '').toLowerCase() };
          return { t: 'var', nombre: t.valor.slice(1).toLowerCase() };
        case 'op':
          if (t.valor === '(') {
            if (this.es('SELECT', this.mira()) || this.es('WITH', this.mira())) {
              this.i++;
              const consulta = this.consulta();
              this.esperaOp(')');
              return { t: 'sub', consulta };
            }
            this.i++;
            const e = this.expr();
            if (this.aceptaOp(',')) {
              const lista = [e];
              do lista.push(this.expr()); while (this.aceptaOp(','));
              this.esperaOp(')');
              return { t: 'fila', lista };
            }
            this.esperaOp(')');
            return { t: 'par', a: e };
          }
          if (t.valor === '{') throw new NoDisponible('sintaxis ODBC');
          throw this.error();
        case 'qid': return this.referenciaColumna();
        case 'id': break;
        default: throw this.error();
      }
      const kw = t.valor.toUpperCase();
      if (kw === 'NULL') { this.i++; return { t: 'null' }; }
      if (kw === 'TRUE' || kw === 'FALSE') { this.i++; return { t: 'bool', v: kw === 'TRUE' }; }
      if (kw === 'CASE') return this.caso();
      if (kw === 'EXISTS') {
        this.i++;
        this.esperaOp('(');
        const consulta = this.consulta();
        this.esperaOp(')');
        return { t: 'existe', consulta };
      }
      if (kw === 'NOT' && this.es('EXISTS', this.mira())) {
        this.i++;
        return { t: 'un', op: 'NOT', a: this.primario() };
      }
      if (kw === 'INTERVAL') { this.i++; return this.intervalo(); }
      if ((kw === 'DATE' || kw === 'TIME' || kw === 'TIMESTAMP') && this.mira().tipo === 'str') {
        this.i++;
        return { t: 'literalTipado', tipo: kw, v: this.avanza().valor };
      }
      // Introductor de juego de caracteres: _utf8mb4'texto' o _utf8mb4 0x...
      if (/^_[a-z0-9]+$/i.test(t.valor) && ['str', 'hex', 'bin'].includes(this.mira().tipo)) {
        this.i++;
        const v = this.avanza();
        return v.tipo === 'str' ? { t: 'str', v: v.valor, introductor: kw.slice(1).toLowerCase() }
          : { t: 'hex', v: v.tipo === 'hex' ? v.valor : null, bits: v.tipo === 'bin' ? v.valor : null, introductor: kw.slice(1).toLowerCase() };
      }
      if (this.esOp('(', this.mira())) {
        if (RESERVADAS.has(kw) && !FUNCIONES_RESERVADAS.has(kw)) throw this.error();
        return this.funcion();
      }
      if (SIN_PARENTESIS.has(kw)) { this.i++; return { t: 'func', nombre: kw, args: [] }; }
      if (kw === 'DEFAULT') throw this.error();
      return this.referenciaColumna();
    }

    referenciaColumna() {
      const partes = [this.identificador()];
      while (this.esOp('.')) {
        this.i++;
        partes.push(this.identificadorTrasPunto());
        if (partes.length > 3) throw this.error();
      }
      return { t: 'col', partes };
    }

    caso() {
      this.espera('CASE');
      const caso = { t: 'caso', base: null, cuandos: [], sino: null };
      if (!this.es('WHEN')) caso.base = this.expr();
      while (this.acepta('WHEN')) {
        const c = this.expr();
        this.espera('THEN');
        caso.cuandos.push({ c, r: this.expr() });
      }
      if (!caso.cuandos.length) throw this.error();
      if (this.acepta('ELSE')) caso.sino = this.expr();
      this.espera('END');
      return caso;
    }

    tipoConversion() {
      const t = this.actual;
      const kw = t.tipo === 'id' ? t.valor.toUpperCase() : '';
      this.i++;
      const ancho = () => {
        if (this.aceptaOp('(')) {
          const a = this.entero();
          let b = null;
          if (this.aceptaOp(',')) b = this.entero();
          this.esperaOp(')');
          return [a, b];
        }
        return [null, null];
      };
      if (kw === 'SIGNED' || kw === 'UNSIGNED') { this.acepta('INTEGER') || this.acepta('INT'); return { base: kw === 'SIGNED' ? 'signed' : 'unsigned' }; }
      if (kw === 'CHAR' || kw === 'NCHAR' || kw === 'VARCHAR') {
        const [n] = ancho();
        this.atributosTexto({});
        return { base: 'char', longitud: n };
      }
      if (kw === 'DECIMAL' || kw === 'DEC') { const [p, s] = ancho(); return { base: 'decimal', p: p === null ? 10 : p, s: s || 0 }; }
      if (kw === 'DATE' || kw === 'TIME' || kw === 'DATETIME' || kw === 'YEAR' || kw === 'JSON') { ancho(); return { base: kw.toLowerCase() }; }
      if (kw === 'DOUBLE' || kw === 'REAL' || kw === 'FLOAT') { ancho(); return { base: 'double' }; }
      if (kw === 'BINARY') { const [n] = ancho(); return { base: 'binary', longitud: n }; }
      throw this.error(t);
    }

    funcion() {
      const t = this.avanza();
      const nombre = t.valor.toUpperCase();
      this.esperaOp('(');
      const f = { t: 'func', nombre, args: [], distinto: false, estrella: false };
      if (nombre === 'CAST') {
        f.args.push(this.expr());
        this.espera('AS');
        f.tipoDestino = this.tipoConversion();
        this.esperaOp(')');
        return f;
      }
      if (nombre === 'CONVERT') {
        f.args.push(this.expr());
        if (this.acepta('USING')) { f.charset = this.nombreLibre(); this.esperaOp(')'); return f; }
        this.esperaOp(',');
        f.nombre = 'CAST';
        f.tipoDestino = this.tipoConversion();
        this.esperaOp(')');
        return f;
      }
      if (['EXTRACT'].includes(nombre)) {
        const unidad = this.identificador().toUpperCase();
        this.espera('FROM');
        f.args.push({ t: 'str', v: unidad }, this.expr());
        this.esperaOp(')');
        return f;
      }
      if (nombre === 'TRIM') {
        let modo = 'BOTH';
        if (this.acepta('BOTH')) modo = 'BOTH';
        else if (this.acepta('LEADING')) modo = 'LEADING';
        else if (this.acepta('TRAILING')) modo = 'TRAILING';
        let quitar = null;
        let origen;
        if (this.acepta('FROM')) origen = this.expr();
        else {
          const e = this.expr();
          if (this.acepta('FROM')) { quitar = e; origen = this.expr(); } else origen = e;
        }
        this.esperaOp(')');
        f.args = [origen];
        f.modoTrim = modo;
        f.quitar = quitar;
        return f;
      }
      if (nombre === 'POSITION') {
        const sub = this.bitO();
        this.espera('IN');
        f.nombre = 'LOCATE';
        f.args = [sub, this.expr()];
        this.esperaOp(')');
        return f;
      }
      if (this.esOp(')')) { this.i++; return this.ventana(f); }
      if (this.esOp('*')) {
        this.i++;
        f.estrella = true;
        this.esperaOp(')');
        return this.ventana(f);
      }
      if (this.acepta('DISTINCT')) f.distinto = true;
      else this.acepta('ALL');
      do {
        if (this.es('INTERVAL')) { this.i++; f.args.push(this.intervalo()); continue; }
        f.args.push(this.expr());
      } while (this.aceptaOp(','));
      if (nombre === 'GROUP_CONCAT') {
        if (this.acepta('ORDER', 'BY')) f.ordenar = this.listaOrden();
        if (this.acepta('SEPARATOR')) f.separador = this.cadena();
      }
      if ((nombre === 'SUBSTRING' || nombre === 'SUBSTR') && this.acepta('FROM')) {
        f.args.push(this.expr());
        if (this.acepta('FOR')) f.args.push(this.expr());
      }
      this.esperaOp(')');
      return this.ventana(f);
    }

    ventana(f) {
      if (this.es('OVER')) throw new NoDisponible('funciones de ventana (OVER)');
      return f;
    }
  }

  function analizar(texto) {
    return new Analizador(texto).sentencia();
  }

  M.sintaxis = { analizar, Analizador, RESERVADAS, ACCIONES };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
