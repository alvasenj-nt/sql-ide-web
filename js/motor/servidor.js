'use strict';
// Servidor MySQL emulado sobre SQLite (sql.js). Ejecuta sentencias de una
// en una, mantiene el diccionario de datos con la semántica de MySQL 8.0 y
// devuelve resultados y errores con los códigos y mensajes de MySQL.
//
// Uso:
//   const srv = new MotorMySQL.Servidor(SQL);   // SQL: módulo de sql.js
//   const resultados = srv.ejecutarScript(texto, { seguir: false });
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const T = M.tipos;
  const C = M.catalogo;
  const TR = M.traductor;
  const { id, nombreTablaSQL } = TR;

  const VERSION = '8.0.46';
  const MODO_SQL = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
  const MOTORES = { innodb: 'InnoDB', myisam: 'MyISAM' };
  const MOTORES_NO_DISPONIBLES = ['memory', 'heap', 'csv', 'archive', 'blackhole', 'mrg_myisam', 'merge', 'federated', 'ndb', 'ndbcluster'];

  // Fecha y hora actuales en la zona de la sesión
  const ahora = () => new Date(Date.now() + (T.zona || 0) * 60000).toISOString().slice(0, 19).replace('T', ' ');

  class Servidor {
    constructor(SQL) {
      this.SQL = SQL;
      this.db = null;
      this.reiniciar();
    }

    // Servidor recién instalado: sin bases de datos de usuario
    reiniciar() {
      if (this.db) this.db.close();
      this.db = new this.SQL.Database();
      this.configurar();
      this.cat = new C.Catalogo();
      this.bdActual = null;
      this.variables = new Map();
      this.fkChecks = true;
      this.ultimoId = 0;
      this.filasUltima = 0;
      this.diagnostico = [];
      this.versionCatalogo = 0;
      this.infoMaterializada = {};
      this.fijarZona(0, 'SYSTEM');
    }

    // Zona horaria de la sesión en minutos respecto a UTC (el servidor del
    // aula está en UTC). TIMESTAMP se guarda en UTC y se muestra en esta zona.
    fijarZona(minutos, texto) {
      this.zona = minutos;
      this.textoZona = texto;
      T.zona = minutos;
    }

    modificadorZona() {
      return (this.zona >= 0 ? '+' : '') + this.zona + ' minutes';
    }

    configurar() {
      this.db.run('PRAGMA foreign_keys = ' + (this.fkChecks === false ? 'OFF' : 'ON'));
      M.funciones.registrar(this.db);
    }

    // Copia completa del estado (datos y diccionario) para restaurarla después
    instantanea() {
      const bytes = this.db.export();
      this.configurar();
      return { bytes, bases: structuredClone(this.cat.bases), bdActual: this.bdActual,
        variables: new Map(this.variables), fkChecks: this.fkChecks, ultimoId: this.ultimoId, zona: this.zona,
        textoZona: this.textoZona };
    }

    restaurar(inst) {
      if (this.db) this.db.close();
      this.db = new this.SQL.Database(inst.bytes);
      this.fkChecks = inst.fkChecks;
      this.configurar();
      this.cat = new C.Catalogo();
      this.cat.bases = structuredClone(inst.bases);
      this.bdActual = inst.bdActual;
      this.variables = new Map(inst.variables);
      this.ultimoId = inst.ultimoId;
      this.fijarZona(inst.zona, inst.textoZona);
      this.diagnostico = [];
      this.versionCatalogo++;
      this.infoMaterializada = {};
    }

    variableSistema(nombre) {
      const v = {
        version: VERSION, version_comment: 'MySQL Community Server - GPL (laboratorio)', sql_mode: MODO_SQL,
        foreign_key_checks: this.fkChecks ? 1 : 0, unique_checks: 1, lower_case_table_names: 0, autocommit: 1,
        character_set_server: 'utf8mb4', collation_server: 'utf8mb4_0900_ai_ci', character_set_database:
          this.bdActual ? this.cat.bd(this.bdActual).charset : 'utf8mb4', collation_database: this.bdActual
          ? this.cat.bd(this.bdActual).collation : 'utf8mb4_0900_ai_ci', time_zone: this.textoZona, system_time_zone: 'UTC',
        default_storage_engine: 'InnoDB', activate_all_roles_on_login: 0, transaction_isolation: 'REPEATABLE-READ',
        explicit_defaults_for_timestamp: 1, div_precision_increment: 4, max_allowed_packet: 67108864,
      }[nombre];
      if (v === undefined) throw new ErrorSQL(1193, 'HY000', "Unknown system variable '" + nombre + "'");
      return v;
    }

    // ---------- ejecución ----------

    ejecutarScript(texto, opciones = {}) {
      const resultados = [];
      const sentencias = M.lexico.dividir(texto);
      for (let i = 0; i < sentencias.length; i++) {
        const r = this.ejecutar(sentencias[i]);
        resultados.push(r);
        if (!r.ok && !opciones.seguir) {
          sentencias.slice(i + 1).forEach((s) => resultados.push({ sentencia: s, ok: false, omitida: true }));
          break;
        }
      }
      return resultados;
    }

    // sentencia: { texto, linea } (o una cadena)
    ejecutar(sentencia) {
      if (typeof sentencia === 'string') sentencia = { texto: sentencia, linea: 1 };
      const inicio = (typeof performance !== 'undefined' ? performance : Date).now();
      const avisos = [];
      let r;
      let ast = null;
      try {
        ast = M.sintaxis.analizar(sentencia.texto);
        r = this.despachar(ast, avisos);
        r.ok = true;
      } catch (e) {
        if (e instanceof ErrorSQL) r = { ok: false, error: { codigo: e.codigo, estado: e.estado, mensaje: e.message } };
        else if (e instanceof NoDisponible) r = { ok: false, noDisponible: true, error: { codigo: null, mensaje: e.message } };
        else r = { ok: false, interno: true, error: { codigo: null, mensaje: 'Error interno del laboratorio: ' + (e && e.message) } };
      }
      r.sentencia = sentencia;
      r.avisos = avisos.length;
      r.listaAvisos = avisos;
      r.duracion = ((typeof performance !== 'undefined' ? performance : Date).now() - inicio) / 1000;
      // SHOW WARNINGS y SHOW ERRORS no reemplazan el área de diagnóstico
      const esDiagnostico = ast && ast.tipo === 'mostrar' && (ast.que === 'avisos' || ast.que === 'errores');
      if (!esDiagnostico) {
        this.diagnostico = r.ok ? avisos.slice() : [['Error', r.error.codigo, r.error.mensaje]];
        if (r.ok && r.tipo === 'cambio') this.filasUltima = r.afectadas;
        else if (r.ok && r.tipo === 'filas') this.filasUltima = -1;
      }
      return r;
    }

    despachar(ast, avisos) {
      switch (ast.tipo) {
        case 'crearBD': return this.crearBD(ast, avisos);
        case 'borrarBD': return this.borrarBD(ast, avisos);
        case 'usar': return this.usar(ast);
        case 'crearTabla': return this.crearTabla(ast, avisos);
        case 'borrarTabla': return this.borrarTabla(ast, avisos);
        case 'insertar': return this.insertar(ast, avisos);
        case 'actualizar': return this.actualizar(ast, avisos);
        case 'eliminar': return this.eliminar(ast, avisos);
        case 'seleccionar': case 'conjunto': return this.consultar(ast);
        case 'mostrar': return this.mostrar(ast);
        case 'asignar': return this.asignar(ast);
        case 'alterarTabla': return this.alterarTabla(ast, avisos);
        case 'vaciarTabla': return this.vaciarTabla(ast, avisos);
        case 'renombrarTablas': return this.renombrarTablas(ast, avisos);
        case 'nada': return { tipo: 'cambio', afectadas: 0 };
        default: throw new NoDisponible(ast.tipo);
      }
    }

    resolverBD(nombre) {
      const bd = nombre || this.bdActual;
      if (!bd) throw new ErrorSQL(1046, '3D000', 'No database selected');
      return bd;
    }

    tablaExistente(ref) {
      const bd = this.resolverBD(ref.bd);
      if (this.cat.esSistema(bd)) throw new NoDisponible('modificar las bases de datos del sistema');
      if (!this.cat.bd(bd)) throw new ErrorSQL(1049, '42000', "Unknown database '" + bd + "'");
      const t = this.cat.tabla(bd, ref.nombre);
      if (!t) throw new ErrorSQL(1146, '42S02', "Table '" + bd + '.' + ref.nombre + "' doesn't exist");
      return t;
    }

    // Fuente de datos de un FROM para el traductor
    fuenteTabla(r) {
      const bd = this.resolverBD(r.bd);
      const alias = r.alias || r.nombre;
      if (bd.toLowerCase() === 'information_schema') {
        const vista = r.nombre.toUpperCase();
        if (!C.INFO[vista]) throw new NoDisponible('information_schema.' + vista);
        this.materializarInfo(vista);
        return {
          alias, conAlias: !!r.alias, bd: 'information_schema', nombre: r.alias ? r.nombre : vista,
          columnas: C.INFO[vista].map(([n, t]) => ({ nombre: n, tipo: t === 'i' ? TR.TIPO_ENTERO : TR.TIPO_TEXTO })),
          sql: id(alias), desde: id('information_schema.' + vista) + ' AS ' + id(alias),
        };
      }
      if (this.cat.esSistema(bd)) throw new NoDisponible('consultar la base de datos ' + bd);
      if (!this.cat.bd(bd)) throw new ErrorSQL(1049, '42000', "Unknown database '" + bd + "'");
      const t = this.cat.tabla(bd, r.nombre);
      if (!t) throw new ErrorSQL(1146, '42S02', "Table '" + bd + '.' + r.nombre + "' doesn't exist");
      return {
        alias, conAlias: !!r.alias, bd, nombre: r.nombre, columnas: t.columnas.map((c) => ({ nombre: c.nombre, tipo: c.tipo })),
        sql: id(alias), desde: nombreTablaSQL(bd, r.nombre) + ' AS ' + id(alias), tabla: t,
      };
    }

    materializarInfo(vista) {
      if (this.infoMaterializada[vista] === this.versionCatalogo) return;
      const nombre = id('information_schema.' + vista);
      const cols = C.INFO[vista];
      this.db.run('DROP TABLE IF EXISTS ' + nombre);
      // Nombres de bases de datos y tablas distinguen mayúsculas; el resto, no
      const binaria = (n) => /(SCHEMA|TABLE_NAME)$/.test(n);
      this.db.run('CREATE TABLE ' + nombre + ' (' + cols.map(([n, t]) => id(n) + (t === 'i' ? ' INTEGER'
        : ' TEXT COLLATE ' + (binaria(n) ? 'BINARY' : 'NOCASE'))).join(', ') + ')');
      const filas = C.filasInfo(this.cat, vista);
      if (filas.length) {
        const st = this.db.prepare('INSERT INTO ' + nombre + ' VALUES (' + cols.map(() => '?').join(', ') + ')');
        filas.forEach((f) => st.run(f.map((v) => (v === undefined ? null : v))));
        st.free();
      }
      this.infoMaterializada[vista] = this.versionCatalogo;
    }

    cambioCatalogo() {
      this.versionCatalogo++;
    }

    // Ejecuta fn dentro de un punto de guardado: si falla, la sentencia no
    // deja ningún cambio (las sentencias de InnoDB son atómicas)
    atomica(fn) {
      this.db.run('SAVEPOINT sentencia');
      try {
        const previas = this.fkChecks ? this.violacionesFk() : null;
        if (this.fkChecks) this.db.run('PRAGMA defer_foreign_keys = ON');
        const r = fn(previas);
        this.db.run('RELEASE sentencia');
        return r;
      } catch (e) {
        this.db.run('ROLLBACK TO sentencia');
        this.db.run('RELEASE sentencia');
        // Lo materializado de information_schema dentro de la sentencia se deshace
        this.infoMaterializada = {};
        throw e;
      }
    }

    violacionesFk() {
      const r = this.db.exec('PRAGMA foreign_key_check');
      const lista = r.length ? r[0].values : [];
      return new Set(lista.map((v) => v.join('|')));
    }

    // Comprueba las claves ajenas tras una sentencia de datos y traduce la
    // primera violación nueva al error de MySQL
    comprobarFks(previas, tablaObjetivo, tipo) {
      if (!this.fkChecks) return;
      const r = this.db.exec('PRAGMA foreign_key_check');
      if (!r.length) return;
      const nueva = r[0].values.find((v) => !previas.has(v.join('|')));
      if (!nueva) return;
      const [hija, , , fkid] = nueva;
      const ref = TR.tablaDeSQLite(hija);
      const tablaHija = this.cat.tabla(ref.bd, ref.nombre);
      const lista = this.db.exec('PRAGMA foreign_key_list(' + id(hija) + ')');
      const desde = lista[0].values.filter((v) => v[0] === fkid).map((v) => String(v[3]).toLowerCase());
      const fk = tablaHija.fks.find((f) => f.columnas.length === desde.length
        && f.columnas.every((c, i) => c.toLowerCase() === desde[i]));
      const descripcion = '(' + C.cita(tablaHija.bd) + '.' + C.cita(tablaHija.nombre) + ', CONSTRAINT ' + C.cita(fk.nombre)
        + ' FOREIGN KEY (' + fk.columnas.map(C.cita).join(', ') + ') REFERENCES '
        + (fk.refBd !== tablaHija.bd ? C.cita(fk.refBd) + '.' : '') + C.cita(fk.refTabla)
        + ' (' + fk.refColumnas.map(C.cita).join(', ') + ')'
        + (fk.alBorrar && fk.alBorrar !== 'NO ACTION' ? ' ON DELETE ' + fk.alBorrar : '')
        + (fk.alActualizar && fk.alActualizar !== 'NO ACTION' ? ' ON UPDATE ' + fk.alActualizar : '') + ')';
      const deHija = tipo === 'insertar' || (tipo === 'actualizar' && tablaHija === tablaObjetivo);
      if (deHija) throw new ErrorSQL(1452, '23000', 'Cannot add or update a child row: a foreign key constraint fails ' + descripcion);
      throw new ErrorSQL(1451, '23000', 'Cannot delete or update a parent row: a foreign key constraint fails ' + descripcion);
    }

    // Traduce un error de SQLite en una escritura al error de MySQL
    errorEscritura(e, tabla, valoresPorColumna) {
      const msg = String(e && e.message || e);
      let m = /UNIQUE constraint failed: (.*)$/.exec(msg);
      if (m) {
        const prefijo = TR.nombreSQLite(tabla.bd, tabla.nombre) + '.';
        const cols = m[1].split(', ').map((c) => (c.startsWith(prefijo) ? c.slice(prefijo.length) : c.split('.').pop()).toLowerCase());
        const indice = tabla.indices.find((i) => i.unico && i.columnas.length === cols.length
          && i.columnas.every((c, k) => c.nombre.toLowerCase() === cols[k]));
        const nombre = indice ? (indice.primaria ? 'PRIMARY' : indice.nombre) : 'PRIMARY';
        const valor = cols.map((c) => {
          const col = C.columna(tabla, c);
          const v = valoresPorColumna ? valoresPorColumna(col) : null;
          return v === null || v === undefined ? 'NULL' : T.mostrarValor(v, col.tipo);
        }).join('-');
        return new ErrorSQL(1062, '23000', "Duplicate entry '" + valor + "' for key '" + tabla.nombre + '.' + nombre + "'");
      }
      m = /CHECK constraint failed: (.*)$/.exec(msg);
      if (m) return new ErrorSQL(3819, 'HY000', "Check constraint '" + m[1] + "' is violated.");
      m = /NOT NULL constraint failed: (.*)$/.exec(msg);
      if (m) return new ErrorSQL(1048, '23000', "Column '" + m[1].split('.').pop() + "' cannot be null");
      if (/FOREIGN KEY constraint failed/.test(msg)) {
        return new ErrorSQL(1452, '23000', 'Cannot add or update a child row: a foreign key constraint fails');
      }
      return e;
    }

    // ---------- bases de datos ----------

    crearBD(ast, avisos) {
      const nombre = ast.nombre;
      if (nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + nombre + "' is too long");
      if (this.cat.esSistema(nombre) || this.cat.bd(nombre)) {
        if (ast.siNoExiste) {
          avisos.push(['Note', 1007, "Can't create database '" + nombre + "'; database exists"]);
          return { tipo: 'cambio', afectadas: 1 };
        }
        throw new ErrorSQL(1007, 'HY000', "Can't create database '" + nombre + "'; database exists");
      }
      const [charset, collation] = T.resolverCharset(ast.charset, ast.collation, this.cat.charset, this.cat.collation, avisos);
      this.cat.bases.set(nombre, { nombre, charset, collation, tablas: new Map() });
      this.cambioCatalogo();
      return { tipo: 'cambio', afectadas: 1 };
    }

    borrarBD(ast, avisos) {
      const nombre = ast.nombre;
      if (this.cat.esSistema(nombre)) throw new NoDisponible('borrar la base de datos ' + nombre);
      const bd = this.cat.bd(nombre);
      if (!bd) {
        if (ast.siExiste) {
          avisos.push(['Note', 1008, "Can't drop database '" + nombre + "'; database doesn't exist"]);
          return { tipo: 'cambio', afectadas: 0 };
        }
        throw new ErrorSQL(1008, 'HY000', "Can't drop database '" + nombre + "'; database doesn't exist");
      }
      const n = bd.tablas.size;
      this.db.run('PRAGMA foreign_keys = OFF');
      try {
        bd.tablas.forEach((t) => this.db.run('DROP TABLE ' + nombreTablaSQL(t.bd, t.nombre)));
      } finally {
        this.db.run('PRAGMA foreign_keys = ' + (this.fkChecks ? 'ON' : 'OFF'));
      }
      this.cat.bases.delete(nombre);
      if (this.bdActual === nombre) this.bdActual = null;
      this.cambioCatalogo();
      return { tipo: 'cambio', afectadas: n };
    }

    usar(ast) {
      const nombre = ast.nombre;
      if (nombre.toLowerCase() === 'information_schema') { this.bdActual = 'information_schema'; return { tipo: 'cambio', afectadas: 0, mensaje: 'Database changed' }; }
      if (this.cat.esSistema(nombre)) throw new NoDisponible('USE ' + nombre);
      if (!this.cat.bd(nombre)) throw new ErrorSQL(1049, '42000', "Unknown database '" + nombre + "'");
      this.bdActual = nombre;
      return { tipo: 'cambio', afectadas: 0, mensaje: 'Database changed' };
    }

    // ---------- tablas ----------

    crearTabla(ast, avisos) {
      const bd = this.resolverBD(ast.tabla.bd);
      if (bd.toLowerCase() === 'information_schema') throw new ErrorSQL(1044, '42000', "Access denied for user 'root'@'localhost' to database 'information_schema'");
      if (this.cat.esSistema(bd)) throw new NoDisponible('crear tablas en ' + bd);
      const base = this.cat.bd(bd);
      if (!base) throw new ErrorSQL(1049, '42000', "Unknown database '" + bd + "'");
      const nombre = ast.tabla.nombre;
      if (nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + nombre + "' is too long");
      if (base.tablas.has(nombre)) {
        if (ast.siNoExiste) {
          avisos.push(['Note', 1050, "Table '" + nombre + "' already exists"]);
          return { tipo: 'cambio', afectadas: 0 };
        }
        throw new ErrorSQL(1050, '42S01', "Table '" + nombre + "' already exists");
      }
      const tabla = ast.como ? this.definicionComo(ast, bd, nombre) : this.definicionTabla(ast, bd, nombre, avisos);
      const sql = this.ddlSQLite(tabla);
      this.atomicaDDL(() => sql.forEach((s) => this.db.run(s)));
      base.tablas.set(nombre, tabla);
      this.cambioCatalogo();
      return { tipo: 'cambio', afectadas: 0 };
    }

    atomicaDDL(fn) {
      this.db.run('SAVEPOINT ddl');
      try {
        fn();
        this.db.run('RELEASE ddl');
      } catch (e) {
        this.db.run('ROLLBACK TO ddl');
        this.db.run('RELEASE ddl');
        throw e;
      }
    }

    definicionComo(ast, bd, nombre) {
      const origen = this.tablaExistente(ast.como);
      const tabla = structuredClone(origen);
      tabla.bd = bd;
      tabla.nombre = nombre;
      tabla.fks = [];
      tabla.autoInc = null;
      let n = 0;
      const usados = this.cat.nombresCheck(bd);
      tabla.checks.forEach((c) => {
        if (c.generado || usados.has(c.nombre.toLowerCase())) {
          do n++; while (usados.has((nombre + '_chk_' + n).toLowerCase()));
          c.nombre = nombre + '_chk_' + n;
          c.generado = true;
        }
      });
      return tabla;
    }

    definicionTabla(ast, bd, nombre, avisos) {
      const base = this.cat.bd(bd);
      const o = ast.opciones || {};
      let motor = 'InnoDB';
      if (o.motor) {
        const m = o.motor.toLowerCase();
        if (MOTORES[m]) motor = MOTORES[m];
        else if (MOTORES_NO_DISPONIBLES.includes(m)) throw new NoDisponible('el motor ' + o.motor);
        else throw new ErrorSQL(1286, '42000', "Unknown storage engine '" + o.motor + "'");
      }
      const [charset, collation] = T.resolverCharset(o.charset, o.collation, base.charset, base.collation, avisos);
      const tabla = { bd, nombre, motor, charset, collation, comentario: o.comentario || null,
        autoInc: o.autoInc || null, columnas: [], indices: [], fks: [], checks: [] };
      if (!ast.columnas.length) throw new ErrorSQL(1113, '42000', 'A table must have at least 1 column');

      const pendientes = { pk: null, unicos: [], indices: [], fks: [], checks: [] };
      const nombres = new Set();
      ast.columnas.forEach((c) => {
        if (nombres.has(c.nombre.toLowerCase())) throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + c.nombre + "'");
        if (c.nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + c.nombre + "' is too long");
        nombres.add(c.nombre.toLowerCase());
        const tipo = T.normalizarTipo(c.tipo, c.nombre, tabla, avisos);
        const col = { nombre: c.nombre, tipo, nulo: c.nulo !== false && !c.autoInc, autoInc: c.autoInc, comentario: c.comentario,
          alActualizarAhora: c.alActualizarAhora, nuloExplicito: c.nulo === true };
        if (c.primaria) {
          if (pendientes.pk) throw new ErrorSQL(1068, '42000', 'Multiple primary key defined');
          pendientes.pk = { columnas: [{ nombre: c.nombre }] };
        }
        if (c.unico) pendientes.unicos.push({ nombreIndice: null, simbolo: null, columnas: [{ nombre: c.nombre }] });
        c.checks.forEach((k) => pendientes.checks.push(k));
        if (c.alActualizarAhora && !['datetime', 'timestamp'].includes(tipo.base)) {
          throw new ErrorSQL(1294, 'HY000', "Invalid ON UPDATE clause for '" + c.nombre + "' column");
        }
        col.defectoAST = c.defecto;
        tabla.columnas.push(col);
      });
      ast.restricciones.forEach((r) => {
        if (r.tipo === 'pk') {
          if (pendientes.pk) throw new ErrorSQL(1068, '42000', 'Multiple primary key defined');
          pendientes.pk = r;
        } else if (r.tipo === 'unico') pendientes.unicos.push(r);
        else if (r.tipo === 'indice') pendientes.indices.push(r);
        else if (r.tipo === 'fk') pendientes.fks.push(r);
        else if (r.tipo === 'check') pendientes.checks.push(r);
      });

      const comprobarColumnas = (cols) => cols.map((p) => {
        const col = C.columna(tabla, p.nombre);
        if (!col) throw new ErrorSQL(1072, '42000', "Key column '" + p.nombre + "' doesn't exist in table");
        if ((T.TEXTOS[col.tipo.base] || T.BLOBS[col.tipo.base]) && !p.prefijo) {
          throw new ErrorSQL(1170, '42000', "BLOB/TEXT column '" + col.nombre + "' used in key specification without a key length");
        }
        if (col.tipo.base === 'json') throw new ErrorSQL(3152, '42000', "JSON column '" + col.nombre + "' supports indexing only via generated columns on a specified JSON path.");
        return { nombre: col.nombre, prefijo: p.prefijo || null, desc: !!p.desc };
      });
      const nombresIndice = new Set(['primary']);
      const nombreLibre = (base) => {
        let n = base;
        let k = 2;
        while (nombresIndice.has(n.toLowerCase())) n = base + '_' + k++;
        return n;
      };
      const reservarNombre = (n) => {
        if (nombresIndice.has(n.toLowerCase())) throw new ErrorSQL(1061, '42000', "Duplicate key name '" + n + "'");
        nombresIndice.add(n.toLowerCase());
        return n;
      };

      // Clave primaria: sus columnas pasan a NOT NULL
      if (pendientes.pk) {
        const cols = comprobarColumnas(pendientes.pk.columnas);
        cols.forEach((p) => {
          const col = C.columna(tabla, p.nombre);
          if (col.nuloExplicito) throw new ErrorSQL(1171, '42000', 'All parts of a PRIMARY KEY must be NOT NULL; if you need NULL in a key, use UNIQUE instead');
          col.nulo = false;
        });
        tabla.indices.push({ nombre: 'PRIMARY', primaria: true, unico: true, columnas: cols });
      }
      pendientes.unicos.forEach((u) => {
        const cols = comprobarColumnas(u.columnas);
        const nombreIdx = u.nombreIndice || u.simbolo ? reservarNombre(u.nombreIndice || u.simbolo) : reservarNombre(nombreLibre(cols[0].nombre));
        tabla.indices.push({ nombre: nombreIdx, unico: true, primaria: false, columnas: cols });
      });
      pendientes.indices.forEach((u) => {
        const cols = comprobarColumnas(u.columnas);
        const nombreIdx = u.nombreIndice ? reservarNombre(u.nombreIndice) : reservarNombre(nombreLibre(cols[0].nombre));
        tabla.indices.push({ nombre: nombreIdx, unico: false, primaria: false, columnas: cols });
      });

      // Valores por defecto y AUTO_INCREMENT
      const autos = tabla.columnas.filter((c) => c.autoInc);
      tabla.columnas.forEach((col) => {
        const d = col.defectoAST;
        delete col.defectoAST;
        if (col.autoInc) {
          if (!['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'float', 'double'].includes(col.tipo.base)) {
            throw new ErrorSQL(1063, '42000', "Incorrect column specifier for column '" + col.nombre + "'");
          }
          if (d !== undefined) throw new ErrorSQL(1067, '42000', "Invalid default value for '" + col.nombre + "'");
        }
        if (d === undefined) return;
        const invalido = () => new ErrorSQL(1067, '42000', "Invalid default value for '" + col.nombre + "'");
        if (d.expresion) throw new NoDisponible('valores por defecto con expresiones');
        if (d.nulo) {
          if (!col.nulo) throw invalido();
          col.defecto = { nulo: true };
          return;
        }
        if (d.ahora) {
          if (!['datetime', 'timestamp'].includes(col.tipo.base)) throw invalido();
          col.defecto = { ahora: true };
          return;
        }
        if (T.TEXTOS[col.tipo.base] || T.BLOBS[col.tipo.base] || col.tipo.base === 'json') {
          throw new ErrorSQL(1101, '42000', "BLOB, TEXT, GEOMETRY or JSON column '" + col.nombre + "' can't have a default value");
        }
        const lit = d.literal;
        let valor;
        if (lit.t === 'num') valor = Number(lit.v);
        else if (lit.t === 'str') valor = lit.v;
        else valor = parseInt(lit.v || '0', lit.t === 'hex' ? 16 : 2);
        try {
          col.defecto = { valor: T.convertir(valor, col, 1, null, lit.t === 'num' ? lit.v : null) };
        } catch (e) {
          if (e instanceof ErrorSQL) throw invalido();
          throw e;
        }
      });
      if (autos.length > 1) throw new ErrorSQL(1075, '42000', 'Incorrect table definition; there can be only one auto column and it must be defined as a key');
      if (autos.length === 1 && !tabla.indices.some((i) => i.columnas[0].nombre.toLowerCase() === autos[0].nombre.toLowerCase())) {
        throw new ErrorSQL(1075, '42000', 'Incorrect table definition; there can be only one auto column and it must be defined as a key');
      }

      // Claves ajenas: requisitos de MySQL y su índice en la tabla hija
      const ctx = { nombresFk: this.cat.nombresFk(bd), contadorFk: 0, nombresIndice, reservarNombre, nombreLibre,
        nombresCheck: this.cat.nombresCheck(bd), contadorChk: 0 };
      pendientes.fks.forEach((f) => this.definirFk(tabla, f, ctx));

      // Restricciones CHECK con su nombre de MySQL
      pendientes.checks.forEach((k) => this.definirCheck(tabla, k, ctx));
      tabla.columnas.forEach((c) => delete c.nuloExplicito);
      return tabla;
    }

    // Añade a la tabla una clave ajena con las comprobaciones de MySQL y,
    // si hace falta, el índice de la tabla hija. ctx lleva los nombres ya
    // usados de claves ajenas e índices y el contador de nombres generados.
    definirFk(tabla, f, ctx) {
      const { bd, nombre, motor } = tabla;
      const { nombresFk, nombresIndice, reservarNombre, nombreLibre } = ctx;
      const cols = f.columnas.map((c) => {
        const col = C.columna(tabla, c);
        if (!col) throw new ErrorSQL(1072, '42000', "Key column '" + c + "' doesn't exist in table");
        return col;
      });
      let nombreFk = f.simbolo;
      let generado = false;
      if (!nombreFk) {
        do ctx.contadorFk++; while (nombresFk.has((nombre + '_ibfk_' + ctx.contadorFk).toLowerCase()));
        nombreFk = nombre + '_ibfk_' + ctx.contadorFk;
        generado = true;
      }
      if (nombreFk.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + nombreFk + "' is too long");
      if (nombresFk.has(nombreFk.toLowerCase())) throw new ErrorSQL(1826, 'HY000', "Duplicate foreign key constraint name '" + nombreFk + "'");
      nombresFk.add(nombreFk.toLowerCase());
      if (f.columnas.length !== f.columnasRef.length) {
        throw new ErrorSQL(1239, '42000', "Incorrect foreign key definition for '" + (f.simbolo || 'foreign key without name') + "': Key reference and table reference don't match");
      }
      // Índice de la tabla hija: el existente que empiece por esas columnas o uno nuevo
      const cubre = (i) => f.columnas.every((c, k) => i.columnas[k] && i.columnas[k].nombre.toLowerCase() === c.toLowerCase());
      const existente = tabla.indices.find((i) => cubre(i) && !i.generadoFk);
      const indiceFk = tabla.indices.find((i) => cubre(i) && i.generadoFk && i.columnas.length === f.columnas.length);
      if (!existente) {
        if (indiceFk) {
          // MySQL conserva el índice de la última clave ajena con esas columnas
          nombresIndice.delete(indiceFk.nombre.toLowerCase());
          indiceFk.nombre = f.nombreIndice ? reservarNombre(f.nombreIndice) : f.simbolo ? reservarNombre(f.simbolo) : reservarNombre(nombreLibre(cols[0].nombre));
        } else {
          const nombreIdx = f.nombreIndice ? reservarNombre(f.nombreIndice) : f.simbolo ? reservarNombre(f.simbolo) : reservarNombre(nombreLibre(cols[0].nombre));
          tabla.indices.push({ nombre: nombreIdx, unico: false, primaria: false, generadoFk: true,
            columnas: cols.map((c) => ({ nombre: c.nombre, prefijo: null, desc: false })) });
        }
      }
      if (motor !== 'InnoDB') return null; // MyISAM descarta la clave ajena sin avisar
      const refBd = f.tablaRef.bd || bd;
      const propia = refBd === bd && f.tablaRef.nombre === nombre;
      const padre = propia ? tabla : this.cat.tabla(refBd, f.tablaRef.nombre);
      const fk = { nombre: nombreFk, generado, columnas: cols.map((c) => c.nombre), refBd, refTabla: f.tablaRef.nombre,
        refColumnas: f.columnasRef.slice(), alBorrar: f.alBorrar, alActualizar: f.alActualizar };
      if (!padre) {
        if (this.fkChecks) throw new ErrorSQL(1824, 'HY000', "Failed to open the referenced table '" + f.tablaRef.nombre + "'");
        tabla.fks.push(fk);
        return fk;
      }
      if (padre.motor !== 'InnoDB') throw new ErrorSQL(1824, 'HY000', "Failed to open the referenced table '" + f.tablaRef.nombre + "'");
      const colsPadre = f.columnasRef.map((c) => {
        const col = C.columna(padre, c);
        if (!col) throw new ErrorSQL(3734, 'HY000', "Failed to add the foreign key constraint. Missing column '" + c + "' for constraint '" + nombreFk + "' in the referenced table '" + f.tablaRef.nombre + "'");
        return col;
      });
      fk.refColumnas = colsPadre.map((c) => c.nombre);
      cols.forEach((c, k) => {
        if (!tiposCompatibles(c.tipo, colsPadre[k].tipo)) {
          throw new ErrorSQL(3780, 'HY000', "Referencing column '" + c.nombre + "' and referenced column '" + colsPadre[k].nombre
            + "' in foreign key constraint '" + nombreFk + "' are incompatible.");
        }
      });
      const indicePadre = padre.indices.find((i) => fk.refColumnas.every((c, k) => i.columnas[k] && i.columnas[k].nombre.toLowerCase() === c.toLowerCase()));
      if (!indicePadre) {
        throw new ErrorSQL(1822, 'HY000', "Failed to add the foreign key constraint. Missing index for constraint '" + nombreFk
          + "' in the referenced table '" + f.tablaRef.nombre + "'");
      }
      if (!(indicePadre.unico && indicePadre.columnas.length === fk.refColumnas.length)) {
        throw new NoDisponible('claves ajenas que apuntan a columnas sin clave primaria ni índice único');
      }
      ['alBorrar', 'alActualizar'].forEach((a) => {
        if (fk[a] === 'SET NULL') {
          const noNula = cols.find((c) => !c.nulo);
          if (noNula) throw new ErrorSQL(1830, 'HY000', "Column '" + noNula.nombre + "' cannot be NOT NULL: needed in a foreign key constraint '" + nombreFk + "' SET NULL");
        }
      });
      tabla.fks.push(fk);
      return fk;
    }

    // Añade a la tabla una restricción CHECK con su nombre de MySQL
    definirCheck(tabla, k, ctx) {
      const { nombresCheck } = ctx;
      let nombreChk = k.simbolo;
      let generado = false;
      if (!nombreChk) {
        do ctx.contadorChk++; while (nombresCheck.has((tabla.nombre + '_chk_' + ctx.contadorChk).toLowerCase()));
        nombreChk = tabla.nombre + '_chk_' + ctx.contadorChk;
        generado = true;
      }
      if (nombresCheck.has(nombreChk.toLowerCase())) throw new ErrorSQL(3822, 'HY000', "Duplicate check constraint name '" + nombreChk + "'.");
      nombresCheck.add(nombreChk.toLowerCase());
      const traducida = TR.traducir(k.expr, { srv: this, enCheck: { tabla, nombre: nombreChk }, clausula: 'check' });
      const check = { nombre: nombreChk, generado, expr: k.expr, texto: C.textoExpresion(k.expr), sql: traducida.sql, aplicada: k.aplicada };
      tabla.checks.push(check);
      return check;
    }

    // Sentencias de SQLite que crean la tabla y sus índices
    ddlSQLite(tabla) {
      const nombre = nombreTablaSQL(tabla.bd, tabla.nombre);
      const partes = tabla.columnas.map((c) => {
        let s = id(c.nombre) + ' ' + T.tipoSQLite(c.tipo);
        if (!c.nulo) s += ' NOT NULL';
        if (T.esCadena(c.tipo)) s += ' COLLATE ' + TR.colacionTexto(c.tipo);
        return s;
      });
      const pk = tabla.indices.find((i) => i.primaria);
      if (pk) partes.push('PRIMARY KEY (' + pk.columnas.map((c) => id(c.nombre)).join(', ') + ')');
      tabla.checks.filter((k) => k.aplicada).forEach((k) => partes.push('CONSTRAINT ' + id(k.nombre) + ' CHECK (' + k.sql + ')'));
      tabla.fks.forEach((fk) => {
        if (!this.cat.tabla(fk.refBd, fk.refTabla) && !(fk.refBd === tabla.bd && fk.refTabla === tabla.nombre)) return;
        const accion = (a) => (a === 'CASCADE' ? 'CASCADE' : a === 'SET NULL' ? 'SET NULL' : 'NO ACTION');
        partes.push('FOREIGN KEY (' + fk.columnas.map(id).join(', ') + ') REFERENCES ' + nombreTablaSQL(fk.refBd, fk.refTabla)
          + ' (' + fk.refColumnas.map(id).join(', ') + ') ON DELETE ' + accion(fk.alBorrar) + ' ON UPDATE ' + accion(fk.alActualizar));
      });
      const sql = ['CREATE TABLE ' + nombre + ' (' + partes.join(', ') + ')'];
      tabla.indices.filter((i) => !i.primaria).forEach((i) => {
        sql.push('CREATE ' + (i.unico ? 'UNIQUE ' : '') + 'INDEX ' + id(TR.nombreSQLite(tabla.bd, tabla.nombre) + '.' + TR.codificar(i.nombre)) + ' ON '
          + nombre + ' (' + i.columnas.map((c) => id(c.nombre)).join(', ') + ')');
      });
      return sql;
    }

    borrarTabla(ast, avisos) {
      const tablas = [];
      const faltan = [];
      ast.tablas.forEach((ref) => {
        const bd = this.resolverBD(ref.bd);
        if (this.cat.esSistema(bd)) throw new NoDisponible('borrar tablas de ' + bd);
        const t = this.cat.tabla(bd, ref.nombre);
        if (t) tablas.push(t);
        else faltan.push(bd + '.' + ref.nombre);
      });
      if (faltan.length) {
        if (!ast.siExiste) throw new ErrorSQL(1051, '42S02', "Unknown table '" + faltan.join(',') + "'");
        faltan.forEach((f) => avisos.push(['Note', 1051, "Unknown table '" + f + "'"]));
      }
      if (this.fkChecks) {
        tablas.forEach((t) => {
          const externa = this.cat.referenciasA(t).find((r) => !tablas.includes(r.tabla));
          if (externa) {
            throw new ErrorSQL(3730, 'HY000', "Cannot drop table '" + t.nombre + "' referenced by a foreign key constraint '"
              + externa.fk.nombre + "' on table '" + externa.tabla.nombre + "'.");
          }
        });
      }
      this.db.run('PRAGMA foreign_keys = OFF');
      try {
        tablas.forEach((t) => {
          this.db.run('DROP TABLE ' + nombreTablaSQL(t.bd, t.nombre));
          this.cat.bd(t.bd).tablas.delete(t.nombre);
        });
      } finally {
        this.db.run('PRAGMA foreign_keys = ' + (this.fkChecks ? 'ON' : 'OFF'));
      }
      this.cambioCatalogo();
      return { tipo: 'cambio', afectadas: 0 };
    }

    // ---------- datos ----------

    // Valor de una expresión sin columnas: los literales se leen aquí y el
    // resto lo calcula SQLite
    valorExpresion(e) {
      if (e.t === 'num') return { valor: Number(e.v), literal: e.v };
      if (e.t === 'str') return { valor: e.v };
      if (e.t === 'null') return { valor: null };
      if (e.t === 'bool') return { valor: e.v ? 1 : 0 };
      if (e.t === 'par') return this.valorExpresion(e.a);
      const r = TR.traducir(e, { srv: this, ambito: null, sinColumnas: true, clausula: 'field list', sinAgregados: true });
      const st = this.db.prepare('SELECT ' + r.sql);
      try {
        st.step();
        const v = st.get()[0];
        if (typeof v === 'number' && TR.clase(r.tipo) === 'decimal') return { valor: v, literal: T.formatoDecimal(v, r.tipo.s) };
        return { valor: v === undefined ? null : v };
      } finally {
        st.free();
      }
    }

    valorDefecto(col, fila) {
      if (col.defecto === undefined) {
        if (col.autoInc) return { auto: true };
        // Columna sin valor por defecto tras ALTER ... DROP DEFAULT
        if (col.sinDefecto) throw new ErrorSQL(1364, 'HY000', "Field '" + col.nombre + "' doesn't have a default value");
        if (col.nulo) return { valor: null };
        // Un ENUM NOT NULL sin DEFAULT toma su primer valor, también en modo estricto
        if (col.tipo.base === 'enum') return { valor: col.tipo.valores[0] };
        throw new ErrorSQL(1364, 'HY000', "Field '" + col.nombre + "' doesn't have a default value");
      }
      if (col.defecto.nulo) return { valor: null };
      if (col.defecto.ahora) return { valor: T.convertir(ahora(), col, fila) };
      return { valor: col.defecto.valor };
    }

    siguienteAuto(tabla, col) {
      if (!tabla.autoInc) {
        const r = this.db.exec('SELECT max(' + id(col.nombre) + ') FROM ' + nombreTablaSQL(tabla.bd, tabla.nombre));
        const max = r.length ? r[0].values[0][0] : null;
        tabla.autoInc = max === null ? 1 : Math.floor(max) + 1;
      }
      return tabla.autoInc;
    }

    insertar(ast, avisos) {
      const tabla = this.tablaExistente(ast.tabla);
      let columnas;
      let filas;
      if (ast.asignaciones) {
        columnas = ast.asignaciones.map((a) => a.columna);
        filas = [ast.asignaciones.map((a) => a.expr)];
      } else {
        filas = ast.filas;
        const vacias = filas && filas.every((f) => f.length === 0);
        columnas = ast.columnas || (vacias ? [] : tabla.columnas.map((c) => c.nombre));
      }
      const cols = columnas.map((n) => {
        const col = C.columna(tabla, n);
        if (!col) throw new ErrorSQL(1054, '42S22', "Unknown column '" + n + "' in 'field list'");
        return col;
      });
      const vistos = new Set();
      cols.forEach((c) => {
        if (vistos.has(c.nombre.toLowerCase())) throw new ErrorSQL(1110, '42000', "Column '" + c.nombre + "' specified twice");
        vistos.add(c.nombre.toLowerCase());
      });
      let valoresFilas;
      if (ast.consulta) {
        const q = TR.traducirConsulta(ast.consulta, this, null);
        if (q.columnas.length !== cols.length) throw new ErrorSQL(1136, '21S01', "Column count doesn't match value count at row 1");
        valoresFilas = this.filasConsulta(q.sql).map((f) => f.map((v, k) => {
          if (typeof v === 'number' && TR.clase(q.columnas[k].tipo) === 'decimal') return { valor: v, literal: T.formatoDecimal(v, q.columnas[k].tipo.s) };
          return { valor: v };
        }));
      } else {
        filas.forEach((f, i) => {
          if (f.length !== cols.length) throw new ErrorSQL(1136, '21S01', "Column count doesn't match value count at row " + (i + 1));
        });
        valoresFilas = null;
      }
      const auto = tabla.columnas.find((c) => c.autoInc);
      let primerId = null;
      const autoAntes = tabla.autoInc;
      const n = valoresFilas ? valoresFilas.length : filas.length;
      const st = this.db.prepare('INSERT INTO ' + nombreTablaSQL(tabla.bd, tabla.nombre) + ' ('
        + tabla.columnas.map((c) => id(c.nombre)).join(', ') + ') VALUES (' + tabla.columnas.map(() => '?').join(', ') + ')');
      try {
        this.atomica((previas) => {
          for (let i = 0; i < n; i++) {
            const fila = i + 1;
            const valores = new Map();
            cols.forEach((col, k) => {
              const e = valoresFilas ? null : filas[i][k];
              if (e && e.t === 'defecto') valores.set(col, this.valorDefecto(col, fila));
              else valores.set(col, valoresFilas ? valoresFilas[i][k] : this.valorExpresion(e));
            });
            const final = tabla.columnas.map((col) => {
              let v = valores.has(col) ? valores.get(col) : this.valorDefecto(col, fila);
              if (col.autoInc && (v.auto || v.valor === null || v.valor === 0 || v.valor === '0')) {
                const siguiente = this.siguienteAuto(tabla, col);
                tabla.autoInc = siguiente + 1;
                if (primerId === null) primerId = siguiente;
                return siguiente;
              }
              if (v.auto) v = { valor: null };
              if (v.valor === null) {
                if (!col.nulo) throw new ErrorSQL(1048, '23000', "Column '" + col.nombre + "' cannot be null");
                return null;
              }
              const convertido = T.convertir(v.valor, col, fila, avisos, v.literal);
              if (col.autoInc) {
                const actual = this.siguienteAuto(tabla, col);
                if (convertido >= actual) tabla.autoInc = Math.floor(convertido) + 1;
              }
              return convertido;
            });
            try {
              st.run(final);
            } catch (e) {
              throw this.errorEscritura(e, tabla, (col) => final[tabla.columnas.indexOf(col)]);
            }
          }
          this.comprobarFks(previas, tabla, 'insertar');
        });
      } catch (e) {
        // InnoDB pierde los valores reservados si falla la escritura (clave
        // duplicada o ajena), pero no si el valor no llega a escribirse
        if (!(e instanceof ErrorSQL && [1062, 1451, 1452].includes(e.codigo))) tabla.autoInc = autoAntes;
        throw e;
      } finally {
        st.free();
      }
      if (primerId !== null) this.ultimoId = primerId;
      const r = { tipo: 'cambio', afectadas: n };
      if (n > 1 || ast.consulta) r.info = 'Records: ' + n + '  Duplicates: 0  Warnings: ' + avisos.length;
      return r;
    }

    filasConsulta(sql) {
      const st = this.db.prepare(sql);
      const filas = [];
      try {
        while (st.step()) filas.push(st.get(null, { useBigInt: true }).map(numeroSeguro));
      } finally {
        st.free();
      }
      return filas;
    }

    actualizar(ast, avisos) {
      const tabla = this.tablaExistente(ast.tabla);
      const alias = ast.alias || ast.tabla.nombre;
      const fuente = { alias, conAlias: !!ast.alias, bd: tabla.bd, nombre: tabla.nombre,
        columnas: tabla.columnas.map((c) => ({ nombre: c.nombre, tipo: c.tipo })), sql: id(alias) };
      const ambito = { fuentes: [fuente], padre: null, aliasSelect: null };
      const ctx = { srv: this, ambito, clausula: 'field list', sinAgregados: true };
      const asignaciones = ast.asignaciones.map((a) => {
        if (a.tablaCol && a.tablaCol !== alias) throw new ErrorSQL(1054, '42S22', "Unknown column '" + a.tablaCol + '.' + a.columna + "' in 'field list'");
        const col = C.columna(tabla, a.columna);
        if (!col) throw new ErrorSQL(1054, '42S22', "Unknown column '" + a.columna + "' in 'field list'");
        if (a.expr.t === 'defecto') return { col, defecto: true };
        const lit = ['num', 'str', 'null', 'bool'].includes(a.expr.t) ? this.valorExpresion(a.expr) : null;
        return { col, lit, sql: lit ? null : TR.traducir(a.expr, ctx) };
      });
      let sql = 'SELECT ' + id(alias) + '.rowid, ' + tabla.columnas.map((c) => id(alias) + '.' + id(c.nombre)).join(', ');
      asignaciones.forEach((a) => { if (a.sql) sql += ', ' + a.sql.sql; });
      sql += ' FROM ' + nombreTablaSQL(tabla.bd, tabla.nombre) + ' AS ' + id(alias);
      if (ast.donde) sql += ' WHERE ' + TR.traducir(ast.donde, Object.assign({}, ctx, { clausula: 'where clause' })).sql;
      if (ast.ordenar.length) sql += ' ORDER BY ' + ast.ordenar.map((o) => TR.traducir(o.expr, Object.assign({}, ctx, { clausula: 'order clause' })).sql + (o.desc ? ' DESC' : '')).join(', ');
      if (ast.limite !== null) sql += ' LIMIT ' + ast.limite;
      let cambiadas = 0;
      let coincidentes = 0;
      this.atomica((previas) => {
        const filas = this.filasConsulta(sql);
        coincidentes = filas.length;
        filas.forEach((f, i) => {
          const fila = i + 1;
          const viejo = f.slice(1, 1 + tabla.columnas.length);
          const nuevo = viejo.slice();
          let k = 1 + tabla.columnas.length;
          const asignadas = new Set();
          asignaciones.forEach((a) => {
            const pos = tabla.columnas.indexOf(a.col);
            let v;
            if (a.defecto) {
              const d = this.valorDefecto(a.col, fila);
              v = d.auto ? { valor: 0 } : d;
            } else if (a.lit) v = a.lit;
            else {
              const valor = f[k++];
              v = { valor, literal: typeof valor === 'number' && TR.clase(a.sql.tipo) === 'decimal' ? T.formatoDecimal(valor, a.sql.tipo.s) : undefined };
            }
            if (v.valor === null || v.valor === undefined) {
              if (!a.col.nulo) throw new ErrorSQL(1048, '23000', "Column '" + a.col.nombre + "' cannot be null");
              nuevo[pos] = null;
            } else nuevo[pos] = T.convertir(v.valor, a.col, fila, avisos, v.literal);
            asignadas.add(pos);
          });
          const distinto = nuevo.some((v, p) => !mismoValor(v, viejo[p]));
          if (!distinto) return;
          tabla.columnas.forEach((c, p) => {
            if (c.alActualizarAhora && !asignadas.has(p)) nuevo[p] = T.convertir(ahora(), c, fila);
          });
          const cambios = [];
          const valores = [];
          nuevo.forEach((v, p) => {
            if (!mismoValor(v, viejo[p])) { cambios.push(id(tabla.columnas[p].nombre) + ' = ?'); valores.push(v); }
          });
          try {
            this.db.run('UPDATE ' + nombreTablaSQL(tabla.bd, tabla.nombre) + ' SET ' + cambios.join(', ') + ' WHERE rowid = ?', valores.concat([f[0]]));
          } catch (e) {
            throw this.errorEscritura(e, tabla, (col) => nuevo[tabla.columnas.indexOf(col)]);
          }
          cambiadas++;
          const auto = tabla.columnas.find((c) => c.autoInc);
          if (auto && tabla.autoInc) {
            const v = nuevo[tabla.columnas.indexOf(auto)];
            if (v !== null && v >= tabla.autoInc) tabla.autoInc = Math.floor(v) + 1;
          }
        });
        this.comprobarFks(previas, tabla, 'actualizar');
      });
      return { tipo: 'cambio', afectadas: cambiadas, info: 'Rows matched: ' + coincidentes + '  Changed: ' + cambiadas + '  Warnings: ' + avisos.length };
    }

    eliminar(ast) {
      const tabla = this.tablaExistente(ast.tabla);
      const alias = ast.alias || ast.tabla.nombre;
      const fuente = { alias, conAlias: !!ast.alias, bd: tabla.bd, nombre: tabla.nombre,
        columnas: tabla.columnas.map((c) => ({ nombre: c.nombre, tipo: c.tipo })), sql: id(alias) };
      const ctx = { srv: this, ambito: { fuentes: [fuente], padre: null, aliasSelect: null }, clausula: 'where clause', sinAgregados: true };
      let sub = 'SELECT ' + id(alias) + '.rowid FROM ' + nombreTablaSQL(tabla.bd, tabla.nombre) + ' AS ' + id(alias);
      if (ast.donde) sub += ' WHERE ' + TR.traducir(ast.donde, ctx).sql;
      if (ast.ordenar.length) sub += ' ORDER BY ' + ast.ordenar.map((o) => TR.traducir(o.expr, Object.assign({}, ctx, { clausula: 'order clause' })).sql + (o.desc ? ' DESC' : '')).join(', ');
      if (ast.limite !== null) sub += ' LIMIT ' + ast.limite;
      let n = 0;
      this.atomica((previas) => {
        try {
          this.db.run('DELETE FROM ' + nombreTablaSQL(tabla.bd, tabla.nombre) + ' WHERE rowid IN (' + sub + ')');
        } catch (e) {
          throw this.errorEscritura(e, tabla, null);
        }
        n = this.db.getRowsModified();
        this.comprobarFks(previas, tabla, 'eliminar');
      });
      return { tipo: 'cambio', afectadas: n };
    }

    consultar(ast) {
      const q = TR.traducirConsulta(ast, this, null);
      let st;
      try {
        st = this.db.prepare(q.sql);
      } catch (e) {
        throw errorConsulta(e);
      }
      const filas = [];
      try {
        while (st.step()) filas.push(st.get(null, { useBigInt: true }).map((v, k) => T.mostrarValor(numeroSeguro(v), q.columnas[k] && q.columnas[k].tipo)));
      } catch (e) {
        throw errorConsulta(e);
      } finally {
        st.free();
      }
      return { tipo: 'filas', columnas: q.columnas.map((c) => c.nombre), filas };
    }

    // ---------- SHOW y DESCRIBE ----------

    mostrar(ast) {
      const filas = (columnas, lista) => ({ tipo: 'filas', columnas, filas: lista.map((f) => f.map((v) => (v === null || v === undefined ? null : String(v)))) });
      const patron = (p) => (p === null || p === undefined ? () => true
        : ((re) => (s) => re.test(s))(new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 's')));
      switch (ast.que) {
        case 'bases': {
          const nombres = C.SISTEMA.concat(Array.from(this.cat.bases.keys())).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          const f = patron(ast.patron);
          return filas(['Database' + (ast.patron ? ' (' + ast.patron + ')' : '')], nombres.filter(f).map((n) => [n]));
        }
        case 'tablas': {
          const bd = this.resolverBD(ast.bd);
          if (this.cat.esSistema(bd)) throw new NoDisponible('SHOW TABLES de ' + bd);
          const base = this.cat.bd(bd);
          if (!base) throw new ErrorSQL(1049, '42000', "Unknown database '" + bd + "'");
          const f = patron(ast.patron);
          const nombres = Array.from(base.tablas.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).filter(f);
          const cab = ['Tables_in_' + bd + (ast.patron ? ' (' + ast.patron + ')' : '')];
          if (ast.completo) return filas(cab.concat(['Table_type']), nombres.map((n) => [n, 'BASE TABLE']));
          return filas(cab, nombres.map((n) => [n]));
        }
        case 'columnas': {
          const t = this.tablaExistente(ast.tabla);
          let lista = C.describir(t, ast.completo);
          if (ast.columna) {
            const f = patron(ast.columna);
            lista = lista.filter((l) => f(l[0]));
          } else if (ast.patron) {
            const f = patron(ast.patron);
            lista = lista.filter((l) => f(l[0]));
          }
          const cab = ast.completo ? ['Field', 'Type', 'Collation', 'Null', 'Key', 'Default', 'Extra', 'Privileges', 'Comment']
            : ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'];
          return filas(cab, lista);
        }
        case 'crearTabla': {
          const t = this.tablaExistente(ast.tabla);
          return filas(['Table', 'Create Table'], [[t.nombre, C.mostrarCrearTabla(t)]]);
        }
        case 'crearBD': {
          const b = this.cat.bd(ast.nombre);
          if (!b) throw new ErrorSQL(1049, '42000', "Unknown database '" + ast.nombre + "'");
          return filas(['Database', 'Create Database'], [[b.nombre, C.mostrarCrearBD(b)]]);
        }
        case 'indices': {
          const t = this.tablaExistente(ast.tabla);
          const r = this.db.exec('SELECT count(*) FROM ' + nombreTablaSQL(t.bd, t.nombre));
          const n = r.length ? r[0].values[0][0] : 0;
          return filas(['Table', 'Non_unique', 'Key_name', 'Seq_in_index', 'Column_name', 'Collation', 'Cardinality', 'Sub_part',
            'Packed', 'Null', 'Index_type', 'Comment', 'Index_comment', 'Visible', 'Expression'], C.mostrarIndices(t, n));
        }
        case 'motores':
          return filas(['Engine', 'Support', 'Comment', 'Transactions', 'XA', 'Savepoints'], C.MOTORES);
        case 'avisos': return filas(['Level', 'Code', 'Message'], this.diagnostico);
        case 'errores': return filas(['Level', 'Code', 'Message'], this.diagnostico.filter((d) => d[0] === 'Error'));
        case 'charsets': {
          const f = patron(ast.patron);
          return filas(['Charset', 'Description', 'Default collation', 'Maxlen'], Object.keys(T.CHARSETS).filter(f).sort()
            .map((c) => [c, c, T.CHARSETS[c].defecto, T.CHARSETS[c].bytes]));
        }
        case 'colaciones': {
          const f = patron(ast.patron);
          return filas(['Collation', 'Charset'], Object.keys(T.COLACIONES).filter(f).sort().map((c) => [c, T.COLACIONES[c]]));
        }
        default: throw new NoDisponible('SHOW');
      }
    }

    asignar(ast) {
      ast.lista.forEach((a) => {
        if (a.variable !== undefined) {
          const v = this.valorExpresion(a.expr);
          this.variables.set(a.variable, v.valor === undefined ? null : v.valor);
          return;
        }
        const valor = a.expr.t === 'id' ? a.expr.v : this.valorExpresion(a.expr).valor;
        switch (a.sistema) {
          case 'foreign_key_checks': {
            const activo = !(valor === 0 || valor === '0' || valor === 'OFF' || valor === false);
            this.fkChecks = activo;
            this.db.run('PRAGMA foreign_keys = ' + (activo ? 'ON' : 'OFF'));
            break;
          }
          case 'unique_checks': case 'sql_notes': case 'sql_warnings': case 'names': case 'character_set_client':
          case 'character_set_results': case 'character_set_connection': case 'collation_connection':
            break;
          case 'time_zone': {
            const v = String(valor);
            const m = /^([+-])(\d{1,2}):(\d{2})$/.exec(v);
            if (/^(SYSTEM|UTC)$/i.test(v)) this.fijarZona(0, v.toUpperCase() === 'UTC' ? 'UTC' : 'SYSTEM');
            else if (m && Number(m[2]) * 60 + Number(m[3]) <= 14 * 60) this.fijarZona((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])), v);
            else throw new ErrorSQL(1298, 'HY000', "Unknown or incorrect time zone: '" + v + "'");
            break;
          }
          case 'sql_mode':
            if (typeof valor !== 'string' || !/STRICT_(TRANS|ALL)_TABLES/i.test(valor)) {
              throw new NoDisponible('cambiar sql_mode a un modo no estricto');
            }
            break;
          default:
            throw new NoDisponible('SET ' + a.sistema);
        }
      });
      return { tipo: 'cambio', afectadas: 0 };
    }

    // ---------- navegador y comprobaciones ----------

    // Resumen del diccionario para el panel de esquemas
    esquemas() {
      return Array.from(this.cat.bases.values()).map((b) => ({
        nombre: b.nombre,
        tablas: Array.from(b.tablas.values()).map((t) => ({
          nombre: t.nombre,
          motor: t.motor,
          columnas: t.columnas.map((c) => ({
            nombre: c.nombre, tipo: T.textoTipo(c.tipo), nulo: c.nulo, clave: C.claveDeColumna(t, c),
            pk: t.indices.some((i) => i.primaria && i.columnas.some((x) => x.nombre === c.nombre)),
            fk: t.fks.some((f) => f.columnas.includes(c.nombre)),
          })),
          indices: C.indicesOrdenados(t).map((i) => ({ nombre: i.nombre, unico: i.unico, columnas: i.columnas.map((c) => c.nombre) })),
          fks: t.fks.map((f) => ({ nombre: f.nombre, columnas: f.columnas, ref: (f.refBd !== t.bd ? f.refBd + '.' : '') + f.refTabla,
            refColumnas: f.refColumnas, alBorrar: f.alBorrar || 'NO ACTION', alActualizar: f.alActualizar || 'NO ACTION' })),
          checks: t.checks.map((k) => ({ nombre: k.nombre, texto: k.texto })),
        })),
      }));
    }

    // Ejecuta las comprobaciones de un ejercicio sobre el estado actual.
    // Cada una se ejecuta en una transacción que se deshace al terminar.
    // opciones.script: el script del alumno, para las comprobaciones que lo
    // vuelven a ejecutar (repetirScript)
    comprobar(especificacion, opciones = {}) {
      return especificacion.comprobaciones.map((c) => {
        if (c.repetirScript) return this.comprobarRepeticion(c, opciones.script || '');
        const estadoJS = { variables: new Map(this.variables), ultimoId: this.ultimoId, bdActual: this.bdActual,
          autos: this.cat.todasLasTablas().map((t) => [t, t.autoInc]) };
        this.db.run('SAVEPOINT comprobacion');
        let resultado = { id: c.id, texto: c.texto, ok: true, detalle: null };
        try {
          for (const paso of c.pasos) {
            const r = this.ejecutar({ texto: paso.sql, linea: 1 });
            const fallo = evaluarPaso(paso, r);
            if (fallo) {
              resultado = { id: c.id, texto: c.texto, ok: false, detalle: paso.siFalla || fallo };
              break;
            }
          }
        } finally {
          this.db.run('ROLLBACK TO comprobacion');
          this.db.run('RELEASE comprobacion');
          this.infoMaterializada = {};
          this.variables = estadoJS.variables;
          this.ultimoId = estadoJS.ultimoId;
          this.bdActual = estadoJS.bdActual;
          estadoJS.autos.forEach(([t, v]) => { t.autoInc = v; });
          this.diagnostico = [];
        }
        return resultado;
      });
    }
  }

  // Los enteros llegan de SQLite como BigInt: se pasan a número si caben
  function numeroSeguro(v) {
    if (typeof v === 'bigint' && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(v);
    return v;
  }

  Servidor.prototype.comprobarRepeticion = function comprobarRepeticion(c, script) {
    const inst = this.instantanea();
    try {
      const r = this.ejecutarScript(script, { seguir: true });
      const errores = r.filter((x) => !x.ok);
      if (!errores.length) {
        // Tras la segunda ejecución, los pasos comprueban que el resultado es el mismo
        for (const paso of c.pasos || []) {
          const fallo = evaluarPaso(paso, this.ejecutar({ texto: paso.sql, linea: 1 }));
          if (fallo) return { id: c.id, texto: c.texto, ok: false, detalle: paso.siFalla || fallo };
        }
        return { id: c.id, texto: c.texto, ok: true, detalle: null };
      }
      const e = errores[0];
      return { id: c.id, texto: c.texto, ok: false, detalle: 'La segunda ejecución da ' + errores.length + ' error(es); el primero, en la línea '
        + e.sentencia.linea + ': ' + (e.error.codigo ? 'Error Code ' + e.error.codigo + '. ' : '') + e.error.mensaje };
    } finally {
      this.restaurar(inst);
    }
  };

  function mismoValor(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return a === b || (a == null && b == null);
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) return false;
      return a.every((x, i) => x === b[i]);
    }
    if (typeof a === 'number' || typeof b === 'number' || typeof a === 'bigint' || typeof b === 'bigint') return Number(a) === Number(b);
    return a === b;
  }

  function errorConsulta(e) {
    if (e instanceof ErrorSQL || e instanceof NoDisponible) return e;
    const msg = String(e && e.message || e);
    let m = /no such function: (\w+)/i.exec(msg);
    if (m) return new ErrorSQL(1305, '42000', 'FUNCTION ' + m[1].toLowerCase() + ' does not exist');
    m = /misuse of aggregate/i.exec(msg);
    if (m) return new ErrorSQL(1111, 'HY000', 'Invalid use of group function');
    m = /no such column: (.*)$/.exec(msg);
    if (m) return new ErrorSQL(1054, '42S22', "Unknown column '" + m[1] + "' in 'field list'");
    m = /ambiguous column name: (.*)$/.exec(msg);
    if (m) return new ErrorSQL(1052, '23000', "Column '" + m[1] + "' in field list is ambiguous");
    return e;
  }

  // Compara el resultado de un paso de una comprobación con lo esperado.
  // Devuelve null si se cumple o el motivo si no.
  function evaluarPaso(paso, r) {
    const espera = paso.espera === undefined ? 'ok' : paso.espera;
    if (r.noDisponible) return 'La comprobación usa una sentencia que el laboratorio no admite: avisa al profesor.';
    if (r.interno) return 'Error interno del laboratorio al comprobar: ' + r.error.mensaje;
    if (espera === 'ok') return r.ok ? null : 'Se esperaba que la sentencia funcionara y falló: ' + r.error.mensaje;
    if (espera === 'error') return r.ok ? 'Se esperaba que la base de datos la rechazara y la aceptó.' : null;
    if (espera.error) {
      if (r.ok) return 'Se esperaba que la base de datos la rechazara y la aceptó.';
      const codigos = [].concat(espera.error);
      return !codigos.length || codigos.includes(r.error.codigo) ? null : 'La base de datos la rechazó, pero por otro motivo: ' + r.error.mensaje;
    }
    if (!r.ok) return 'La consulta de comprobación falló: ' + r.error.mensaje;
    const filas = r.filas || [];
    if (espera.filas) {
      const norm = (f) => f.map((v) => (v === null ? null : String(v)));
      const a = filas.map((f) => JSON.stringify(norm(f)));
      const b = espera.filas.map((f) => JSON.stringify(norm(f)));
      if (!espera.orden) { a.sort(); b.sort(); }
      return JSON.stringify(a) === JSON.stringify(b) ? null : 'El resultado no es el esperado.';
    }
    if (espera.valor !== undefined) {
      const v = filas.length && filas[0].length ? filas[0][0] : undefined;
      const esperado = espera.valor === null ? null : String(espera.valor);
      return v === esperado ? null : 'Se esperaba ' + (esperado === null ? 'NULL' : esperado) + ' y se obtuvo ' + (v === undefined ? 'ninguna fila' : v === null ? 'NULL' : v) + '.';
    }
    if (espera.nfilas !== undefined) return filas.length === espera.nfilas ? null : 'Se esperaban ' + espera.nfilas + ' filas y hay ' + filas.length + '.';
    if (espera.afectadas !== undefined) return r.afectadas === espera.afectadas ? null : 'Se esperaban ' + espera.afectadas + ' filas afectadas y hubo ' + r.afectadas + '.';
    return null;
  }

  // Tipos compatibles en una clave ajena: mismos enteros y signo, mismos
  // decimales, cadenas con el mismo juego de caracteres y colación
  function tiposCompatibles(a, b) {
    if (T.ENTEROS[a.base] || T.ENTEROS[b.base]) return a.base === b.base && !!a.sinSigno === !!b.sinSigno;
    if (a.base === 'decimal' || b.base === 'decimal') return a.base === b.base && a.p === b.p && a.s === b.s && !!a.sinSigno === !!b.sinSigno;
    const cadena = (t) => ['char', 'varchar'].includes(t.base);
    if (cadena(a) || cadena(b)) return cadena(a) && cadena(b) && a.charset === b.charset && a.collation === b.collation;
    const binaria = (t) => ['binary', 'varbinary'].includes(t.base);
    if (binaria(a) || binaria(b)) return binaria(a) && binaria(b);
    return a.base === b.base;
  }

  M.Servidor = Servidor;
  M.tiposCompatibles = tiposCompatibles;
  M.evaluarPaso = evaluarPaso;
  M.VERSION = VERSION;

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
