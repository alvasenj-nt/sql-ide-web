'use strict';
// Vistas del servidor emulado: CREATE, ALTER y DROP VIEW, consulta a través
// de la vista (una subconsulta en el FROM), texto canónico de MySQL para
// SHOW CREATE VIEW e information_schema, y escritura a través de vistas
// actualizables con WITH CHECK OPTION (LOCAL y CASCADED).
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const T = M.tipos;
  const C = M.catalogo;
  const TR = M.traductor;
  const { id } = TR;
  const P = M.Servidor.prototype;

  const DEFINIDOR = { usuario: 'root', host: '%' };
  const invalida = (v) => new ErrorSQL(1356, 'HY000', "View '" + v.bd + '.' + v.nombre
    + "' references invalid table(s) or column(s) or function(s) or definer/invoker of view lack rights to use them");

  // Recorre un árbol sintáctico (expresiones y consultas)
  function recorrer(e, fn) {
    if (!e || typeof e !== 'object') return;
    if (Array.isArray(e)) { e.forEach((x) => recorrer(x, fn)); return; }
    fn(e);
    Object.keys(e).forEach((k) => recorrer(e[k], fn));
  }

  const sinParentesis = (e) => { while (e && e.t === 'par') e = e.a; return e; };

  // ¿Puede MySQL escribir a través de la consulta de la vista?
  function consultaActualizable(q) {
    if (q.tipo !== 'seleccionar' || q.distinto || q.agrupar.length || q.teniendo || !q.desde.length) return false;
    let ok = true;
    q.columnas.forEach((c) => recorrer(c.expr, (n) => {
      if (n.t === 'func' && TR.AGREGADOS.has(String(n.nombre).toUpperCase())) ok = false;
      if (n.consulta) ok = false;
    }));
    recorrer(q.desde, (n) => { if (n.t === 'subconsulta') ok = false; });
    return ok;
  }

  // ---------- texto canónico de la consulta ----------

  const citaCadena = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  function textoConsulta(q, conBd, bdVista) {
    if (q.tipo === 'conjunto') {
      return textoConsulta(q.izq, conBd, bdVista) + ' ' + q.op.toLowerCase() + (q.todos ? ' all ' : ' ') + textoConsulta(q.der, conBd, bdVista);
    }
    const col = (e) => {
      const o = e.origen;
      const nombre = o ? o.columna.nombre : e.partes[e.partes.length - 1];
      if (!o || !o.fuente) return C.cita(nombre);
      const f = o.fuente;
      if (f.conAlias) return C.cita(f.alias) + '.' + C.cita(nombre);
      const tabla = C.cita(f.nombre);
      return (conBd && f.bd ? C.cita(f.bd) + '.' : '') + tabla + '.' + C.cita(nombre);
    };
    const opciones = { col, str: citaCadena, estrella: '0' };
    const tx = (e) => C.textoExpresion(e, opciones);
    const desde = (r) => {
      if (r.t === 'tabla') {
        const bd = r.bd || bdVista;
        return (conBd || bd !== bdVista ? C.cita(bd) + '.' : '') + C.cita(r.nombre) + (r.alias ? ' ' + C.cita(r.alias) : '');
      }
      if (r.t === 'subconsulta') return '(' + textoConsulta(r.consulta, conBd, bdVista) + ') ' + C.cita(r.alias);
      if (r.t === 'lista') return '(' + r.elementos.map(desde).join(' join ') + ')';
      if (r.t === 'union') {
        const tipo = r.tipo === 'LEFT' ? 'left join' : r.tipo === 'RIGHT' ? 'right join' : 'join';
        let s = '(' + desde(r.izq) + ' ' + (r.natural ? 'natural ' : '') + tipo + ' ' + desde(r.der);
        if (r.on) s += ' on(' + tx(r.on) + ')';
        if (r.using) s += ' using (' + r.using.map(C.cita).join(',') + ')';
        return s + ')';
      }
      return '?';
    };
    const columnas = q.columnas.map((c) => {
      const e = c.expr;
      const nombre = c.alias !== null && c.alias !== undefined ? c.alias
        : e.t === 'col' ? (e.origen ? e.origen.columna.nombre : e.partes[e.partes.length - 1]) : c.texto;
      return tx(e) + ' AS ' + C.cita(nombre);
    });
    let s = 'select ' + (q.distinto ? 'distinct ' : '') + columnas.join(',');
    if (q.desde.length) s += ' from ' + (q.desde.length > 1 ? '(' + q.desde.map(desde).join(' join ') + ')' : desde(q.desde[0]));
    if (q.donde) s += ' where ' + tx(q.donde);
    if (q.agrupar.length) s += ' group by ' + q.agrupar.map(tx).join(',');
    if (q.teniendo) s += ' having ' + tx(q.teniendo);
    if (q.ordenar.length) s += ' order by ' + q.ordenar.map((o) => tx(o.expr) + (o.desc ? ' desc' : '')).join(',');
    if (q.limite) s += ' limit ' + (q.limite.desplazamiento ? tx(q.limite.desplazamiento) + ',' : '') + tx(q.limite.n);
    return s;
  }

  // Sustituye cada * por las columnas que representaba al crear la vista
  function expandirEstrellas(q) {
    if (q.tipo === 'conjunto') { expandirEstrellas(q.izq); expandirEstrellas(q.der); return; }
    const lista = [];
    q.columnas.forEach((c) => {
      if (c.expr.t !== 'estrella') { lista.push(c); return; }
      (c.expr.expansion || []).forEach((x) => {
        const expr = { t: 'col', partes: [x.fuente.alias || x.fuente.nombre, x.columna.nombre] };
        Object.defineProperty(expr, 'origen', { value: { fuente: x.fuente, columna: x.columna }, configurable: true, writable: true });
        lista.push({ expr, alias: null, texto: x.columna.nombre });
      });
    });
    q.columnas = lista;
  }

  // ---------- diccionario ----------

  P.vistaDe = function (ref) {
    const bd = ref.bd || this.bdActual;
    return bd ? this.cat.vista(bd, ref.nombre) : null;
  };

  P.conBD = function (bd, fn) {
    const previa = this.bdActual;
    this.bdActual = bd;
    try {
      return fn();
    } finally {
      this.bdActual = previa;
    }
  };

  // Traduce la consulta de la vista con sus nombres de columna como alias
  P.traducirVista = function (v) {
    const q = structuredClone(v.consulta);
    const primera = (x) => (x.tipo === 'conjunto' ? primera(x.izq) : x);
    primera(q).columnas.forEach((c, k) => { c.alias = v.nombres[k]; });
    try {
      return { q, sql: this.conBD(v.bd, () => TR.traducirConsulta(q, this, null)) };
    } catch (e) {
      if (e instanceof ErrorSQL) throw invalida(v);
      throw e;
    }
  };

  // Fuente del FROM para una vista: su consulta como tabla derivada
  P.fuenteVista = function (r, v) {
    const { sql } = this.traducirVista(v);
    const alias = r.alias || r.nombre;
    return {
      alias, conAlias: !!r.alias, bd: v.bd, nombre: r.nombre, vista: v,
      columnas: sql.columnas.map((c) => ({ nombre: c.nombre, tipo: c.tipo })),
      sql: id(alias), desde: '(' + sql.sql + ') AS ' + id(alias),
    };
  };

  // Columnas de la vista como columnas de tabla (DESCRIBE, information_schema)
  function columnasVista(srv, v, q, traducida) {
    const primera = (x) => (x.tipo === 'conjunto' ? primera(x.izq) : x);
    return primera(q).columnas.map((c, k) => {
      const e = sinParentesis(c.expr);
      const nombre = v.nombres[k];
      if (e.t === 'col' && e.origen && e.origen.fuente) {
        const f = e.origen.fuente;
        let base = null;
        if (f.tabla) base = C.columna(f.tabla, e.origen.columna.nombre);
        else if (f.vista) base = (f.vista.columnas || []).find((x) => x.nombre.toLowerCase() === e.origen.columna.nombre.toLowerCase()) || null;
        if (base) {
          const col = structuredClone(base);
          col.nombre = nombre;
          col.autoInc = false;
          col.alActualizarAhora = false;
          if (f.tabla && (f.tabla.indices.find((i) => i.primaria) || {}).columnas) col.nulo = base.nulo;
          return col;
        }
      }
      let tipo = traducida.columnas[k].tipo;
      try { T.textoTipo(tipo); } catch (err) { tipo = { base: 'varchar', longitud: 255, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }; }
      return { nombre, tipo, nulo: true, autoInc: false };
    });
  }

  P.crearVista = function (ast) {
    const bd = this.resolverBD(ast.vista.bd);
    if (bd.toLowerCase() === 'information_schema') throw new ErrorSQL(1044, '42000', "Access denied for user 'root'@'localhost' to database 'information_schema'");
    if (this.cat.esSistema(bd)) throw new NoDisponible('crear vistas en ' + bd);
    const base = this.cat.bd(bd);
    if (!base) throw new ErrorSQL(1049, '42000', "Unknown database '" + bd + "'");
    const nombre = ast.vista.nombre;
    if (nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + nombre + "' is too long");
    const existente = base.vistas.get(nombre);
    if (base.tablas.has(nombre)) {
      if (ast.alterar || ast.reemplazar) throw new ErrorSQL(1347, 'HY000', "'" + bd + '.' + nombre + "' is not VIEW");
      throw new ErrorSQL(1050, '42S01', "Table '" + nombre + "' already exists");
    }
    if (ast.alterar && !existente) throw new ErrorSQL(1146, '42S02', "Table '" + bd + '.' + nombre + "' doesn't exist");
    if (existente && !ast.alterar && !ast.reemplazar) throw new ErrorSQL(1050, '42S01', "Table '" + nombre + "' already exists");

    const q = structuredClone(ast.consulta);
    const traducida = this.conBD(bd, () => TR.traducirConsulta(q, this, null));
    expandirEstrellas(q);
    const nombres = ast.columnas || traducida.columnas.map((c) => c.nombre);
    if (ast.columnas && ast.columnas.length !== traducida.columnas.length) {
      throw new ErrorSQL(1353, 'HY000', 'In definition of view, derived table or common table expression, SELECT list and column names list have different column counts');
    }
    const vistos = new Set();
    nombres.forEach((n) => {
      if (vistos.has(n.toLowerCase())) throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + n + "'");
      vistos.add(n.toLowerCase());
    });
    const v = { bd, nombre, nombres: nombres.slice(), explicitas: !!ast.columnas, opcion: ast.opcion,
      algoritmo: ast.algoritmo, seguridad: ast.seguridad, definidor: ast.definidor && !ast.definidor.actual ? ast.definidor : DEFINIDOR };
    const actualizable = ast.algoritmo !== 'TEMPTABLE' && consultaActualizable(q) && q.desde.every((r) => {
      let ok = true;
      recorrer(r, (n) => {
        if (n.t === 'tabla') {
          const interior = this.cat.vista(n.bd || bd, n.nombre);
          if (interior && !interior.actualizable) ok = false;
        }
      });
      return ok;
    });
    if (ast.opcion !== 'NONE' && !actualizable) throw new ErrorSQL(1368, 'HY000', "CHECK OPTION on non-updatable view '" + bd + '.' + nombre + "'");
    v.actualizable = actualizable;
    v.texto = textoConsulta(q, false, bd);
    v.definicion = textoConsulta(q, true, bd);
    v.columnas = columnasVista(this, v, q, traducida);
    v.consulta = structuredClone(q);
    base.vistas.set(nombre, v);
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.borrarVista = function (ast, avisos) {
    const faltan = [];
    const vistas = [];
    ast.vistas.forEach((ref) => {
      const bd = this.resolverBD(ref.bd);
      const base = this.cat.bd(bd);
      const v = base ? base.vistas.get(ref.nombre) : null;
      if (v) vistas.push(v);
      else if (base && base.tablas.has(ref.nombre)) throw new ErrorSQL(1347, 'HY000', "'" + bd + '.' + ref.nombre + "' is not VIEW");
      else faltan.push(bd + '.' + ref.nombre);
    });
    if (faltan.length) {
      if (!ast.siExiste) throw new ErrorSQL(1051, '42S02', "Unknown table '" + faltan.join(',') + "'");
      faltan.forEach((f) => avisos.push(['Note', 1051, "Unknown table '" + f + "'"]));
    }
    vistas.forEach((v) => this.cat.bd(v.bd).vistas.delete(v.nombre));
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.mostrarCrearVista = function (v) {
    const d = v.definidor || DEFINIDOR;
    return 'CREATE ALGORITHM=' + v.algoritmo + ' DEFINER=' + C.cita(d.usuario) + '@' + C.cita(d.host) + ' SQL SECURITY ' + v.seguridad
      + ' VIEW ' + C.cita(v.nombre) + (v.explicitas ? ' (' + v.nombres.map(C.cita).join(',') + ')' : '') + ' AS ' + v.texto
      + (v.opcion !== 'NONE' ? ' WITH ' + v.opcion + ' CHECK OPTION' : '');
  };

  // ---------- escritura a través de vistas ----------

  // Cambia en una expresión las columnas por su definición en 'mapa'. Con
  // alias, las cualificadas con ese alias (una vista dentro de otra); sin él,
  // las que escribe el usuario sobre la vista: sin cualificar o con su nombre.
  function sustituir(e, alias, mapa, vista, clausula) {
    if (!e || typeof e !== 'object') return e;
    if (Array.isArray(e)) return e.map((x) => sustituir(x, alias, mapa, vista, clausula));
    if (e.t === 'col') {
      const nombre = e.partes[e.partes.length - 1];
      const cualificador = e.partes.length >= 2 ? e.partes[e.partes.length - 2] : null;
      const aplica = alias !== null ? cualificador === alias : cualificador === null || cualificador === vista;
      if (aplica) {
        const def = mapa.get(nombre.toLowerCase());
        if (def) return { t: 'par', a: structuredClone(def) };
        if (alias === null) throw new ErrorSQL(1054, '42S22', "Unknown column '" + e.partes.join('.') + "' in '" + clausula + "'");
      }
      return e;
    }
    const r = {};
    Object.keys(e).forEach((k) => { r[k] = sustituir(e[k], alias, mapa, vista, clausula); });
    return r;
  }

  // Lleva la vista hasta sus tablas base: el FROM de las tablas, la
  // definición de cada columna de la vista sobre ellas y las condiciones de
  // cada nivel (con su opción de comprobación)
  P.resolverEscritura = function (v) {
    const { q } = this.traducirVista(v);
    if (!v.actualizable || q.tipo !== 'seleccionar') return { actualizable: false };
    // Columnas cualificadas con el alias de su fuente y tablas con su base de datos
    recorrer(q, (n) => {
      if (n.t === 'col' && n.origen && n.origen.fuente) n.partes = [n.origen.fuente.alias, n.origen.columna.nombre];
      if (n.t === 'tabla' && !n.bd) n.bd = v.bd;
    });
    const fuentes = new Map();
    recorrer(q.desde, (n) => {
      if (n.t !== 'tabla') return;
      const vista = this.cat.vista(n.bd, n.nombre);
      fuentes.set(n.alias || n.nombre, vista ? { vista, ref: n } : { tabla: this.cat.tabla(n.bd, n.nombre), ref: n });
    });
    let mapa = new Map(q.columnas.map((c, k) => [v.nombres[k].toLowerCase(), c.expr]));
    let donde = q.donde;
    if (fuentes.size === 1 && Array.from(fuentes.values())[0].vista) {
      const [alias, f] = Array.from(fuentes.entries())[0];
      const interior = this.resolverEscritura(f.vista);
      if (!interior.actualizable) return { actualizable: false };
      const m = interior.mapa;
      mapa = new Map(Array.from(mapa.entries()).map(([k, e]) => [k, sustituir(e, alias, m)]));
      if (donde) donde = sustituir(donde, alias, m);
      return { actualizable: true, desde: interior.desde, fuentes: interior.fuentes, mapa,
        niveles: [{ donde, opcion: v.opcion }].concat(interior.niveles) };
    }
    if (Array.from(fuentes.values()).some((f) => f.vista)) throw new NoDisponible('escribir a través de una vista que une otras vistas');
    return { actualizable: true, desde: q.desde, fuentes, mapa, niveles: [{ donde, opcion: v.opcion }] };
  };

  const y = (lista) => lista.filter(Boolean).reduce((a, b) => (a ? { t: 'bin', op: 'AND', a: { t: 'par', a }, b: { t: 'par', a: b } } : b), null);

  // Expresión del usuario (sobre las columnas de la vista) llevada a las tablas base
  function aBase(e, v, r, clausula) {
    return sustituir(e, null, r.mapa, v.nombre, clausula);
  }

  // Filas (rowid de la tabla 'alias') que ve la vista y cumplen la condición
  P.filasVista = function (r, alias, condicion, ordenar, limite) {
    const q = { tipo: 'seleccionar', distinto: false, columnas: [{ expr: { t: 'crudo', sql: id(alias) + '.rowid' }, alias: 'fila', texto: 'fila' }],
      desde: r.desde, donde: y(r.niveles.map((n) => n.donde).concat([condicion])), agrupar: [], teniendo: null,
      ordenar: ordenar || [], limite: limite === null || limite === undefined ? null : { n: { t: 'num', v: String(limite) } } };
    return this.filasConsulta(TR.traducirConsulta(q, this, null).sql).map((f) => f[0]);
  };

  // WITH CHECK OPTION: las filas escritas deben cumplir las condiciones que exige la vista
  P.verificarOpcion = function (v, r, alias, filas) {
    let cascada = false;
    const condiciones = [];
    r.niveles.forEach((n) => {
      if (n.opcion === 'CASCADED') cascada = true;
      if (n.donde && (cascada || n.opcion === 'LOCAL')) condiciones.push(n.donde);
    });
    if (!condiciones.length || !filas.length) return;
    const q = { tipo: 'seleccionar', distinto: false, columnas: [{ expr: y(condiciones), alias: 'ok', texto: 'ok' }],
      desde: r.desde, donde: { t: 'crudo', sql: id(alias) + '.rowid IN (' + filas.join(', ') + ')' }, agrupar: [], teniendo: null, ordenar: [], limite: null };
    const res = this.filasConsulta(TR.traducirConsulta(q, this, null).sql);
    if (res.some((f) => f[0] !== 1)) throw new ErrorSQL(1369, 'HY000', "CHECK OPTION failed '" + v.bd + '.' + v.nombre + "'");
  };

  P.conPuntoGuardado = function (fn) {
    this.db.run('SAVEPOINT vista');
    try {
      const r = fn();
      this.db.run('RELEASE vista');
      return r;
    } catch (e) {
      this.db.run('ROLLBACK TO vista');
      this.db.run('RELEASE vista');
      this.infoMaterializada = {};
      throw e;
    }
  };

  const columnaSimple = (e) => { const x = sinParentesis(e); return x && x.t === 'col' ? x : null; };

  P.insertarVista = function (v, ast, avisos) {
    const r = this.resolverEscritura(v);
    const noInsertable = () => new ErrorSQL(1471, 'HY000', 'The target table ' + v.nombre + ' of the INSERT is not insertable-into');
    if (!r.actualizable) throw noInsertable();
    const simples = Array.from(r.mapa.values()).map(columnaSimple);
    if (simples.some((c) => !c)) throw noInsertable();
    const union = r.fuentes.size > 1;
    let columnas = ast.asignaciones ? ast.asignaciones.map((a) => a.columna) : ast.columnas;
    if (!columnas) {
      if (union) throw new ErrorSQL(1394, 'HY000', "Can not insert into join view '" + v.bd + '.' + v.nombre + "' without fields list");
      columnas = v.nombres.slice();
    }
    const destino = columnas.map((n) => {
      const def = r.mapa.get(n.toLowerCase());
      if (!def) throw new ErrorSQL(1054, '42S22', "Unknown column '" + n + "' in 'field list'");
      const c = columnaSimple(def);
      return { alias: c.partes[0], columna: c.partes[1] };
    });
    const alias = destino.length ? destino[0].alias : Array.from(r.fuentes.keys())[0];
    if (destino.some((d) => d.alias !== alias)) {
      throw new ErrorSQL(1393, 'HY000', "Can not modify more than one base table through a join view '" + v.bd + '.' + v.nombre + "'");
    }
    const tabla = r.fuentes.get(alias).tabla;
    const nuevo = Object.assign({}, ast, { tabla: { bd: tabla.bd, nombre: tabla.nombre } });
    if (ast.asignaciones) nuevo.asignaciones = ast.asignaciones.map((a, k) => Object.assign({}, a, { columna: destino[k].columna }));
    else nuevo.columnas = destino.map((d) => d.columna);
    const fisica = TR.nombreTablaSQL(tabla.bd, tabla.nombre);
    return this.conPuntoGuardado(() => {
      const antes = new Set(this.filasConsulta('SELECT rowid FROM ' + fisica).map((f) => f[0]));
      let res;
      try {
        res = this.insertar(nuevo, avisos);
      } catch (e) {
        if (e instanceof ErrorSQL && e.codigo === 1364) {
          throw new ErrorSQL(1423, 'HY000', "Field of view '" + v.bd + '.' + v.nombre + "' underlying table doesn't have a default value");
        }
        throw e;
      }
      const nuevas = this.filasConsulta('SELECT rowid FROM ' + fisica).map((f) => f[0]).filter((f) => !antes.has(f));
      this.verificarOpcion(v, r, alias, nuevas);
      return res;
    });
  };

  P.actualizarVista = function (v, ast, avisos) {
    const r = this.resolverEscritura(v);
    if (!r.actualizable) throw new ErrorSQL(1288, 'HY000', 'The target table ' + v.nombre + ' of the UPDATE is not updatable');
    const destino = ast.asignaciones.map((a) => {
      const def = r.mapa.get(a.columna.toLowerCase());
      if (!def) throw new ErrorSQL(1054, '42S22', "Unknown column '" + a.columna + "' in 'field list'");
      const c = columnaSimple(def);
      if (!c) throw new ErrorSQL(1348, 'HY000', "Column '" + a.columna + "' is not updatable");
      return { alias: c.partes[0], columna: c.partes[1], a };
    });
    const alias = destino[0].alias;
    if (destino.some((d) => d.alias !== alias)) {
      throw new ErrorSQL(1393, 'HY000', "Can not modify more than one base table through a join view '" + v.bd + '.' + v.nombre + "'");
    }
    const tabla = r.fuentes.get(alias).tabla;
    const condicion = ast.donde ? aBase(ast.donde, v, r, 'where clause') : null;
    const ordenar = ast.ordenar.map((o) => ({ expr: aBase(o.expr, v, r, 'order clause'), desc: o.desc }));
    const filas = this.filasVista(r, alias, condicion, ordenar, ast.limite);
    const asignaciones = destino.map((d) => ({ columna: d.columna, tablaCol: null,
      expr: d.a.expr.t === 'defecto' ? d.a.expr : aBase(d.a.expr, v, r, 'field list') }));
    const nuevo = { tipo: 'actualizar', tabla: { bd: tabla.bd, nombre: tabla.nombre }, alias: alias !== tabla.nombre ? alias : null,
      asignaciones, donde: null, ordenar: [], limite: null, filas };
    return this.conPuntoGuardado(() => {
      const res = this.actualizar(nuevo, avisos);
      this.verificarOpcion(v, r, alias, filas);
      return res;
    });
  };

  P.eliminarVista = function (v, ast) {
    const r = this.resolverEscritura(v);
    if (!r.actualizable) throw new ErrorSQL(1288, 'HY000', 'The target table ' + v.nombre + ' of the DELETE is not updatable');
    if (r.fuentes.size > 1) throw new ErrorSQL(1395, 'HY000', "Can not delete from join view '" + v.bd + '.' + v.nombre + "'");
    const [alias, f] = Array.from(r.fuentes.entries())[0];
    const condicion = ast.donde ? aBase(ast.donde, v, r, 'where clause') : null;
    const ordenar = ast.ordenar.map((o) => ({ expr: aBase(o.expr, v, r, 'order clause'), desc: o.desc }));
    const filas = this.filasVista(r, alias, condicion, ordenar, ast.limite);
    return this.eliminar({ tipo: 'eliminar', tabla: { bd: f.tabla.bd, nombre: f.tabla.nombre }, alias: null, donde: null, ordenar: [], limite: null, filas });
  };

  M.vistas = { textoConsulta, consultaActualizable };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
