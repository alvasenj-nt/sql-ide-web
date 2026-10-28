'use strict';
// ALTER TABLE, CREATE INDEX, DROP INDEX, TRUNCATE y RENAME TABLE del
// servidor emulado. ALTER trabaja sobre una copia del diccionario de la
// tabla, aplica las operaciones en orden con los errores de MySQL y después
// reconstruye la tabla de SQLite copiando las filas con la conversión de
// tipos de MySQL en modo estricto.
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const T = M.tipos;
  const C = M.catalogo;
  const TR = M.traductor;
  const { id, nombreTablaSQL } = TR;
  const P = M.Servidor.prototype;

  const ahora = () => new Date(Date.now() + (T.zona || 0) * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const igual = (a, b) => a.toLowerCase() === b.toLowerCase();
  const noExiste = (n) => new ErrorSQL(1091, '42000', "Can't DROP '" + n + "'; check that column/key exists");

  // Mayor número de los nombres generados (tabla_ibfk_N, tabla_chk_N)
  function ultimoGenerado(lista, tabla, sufijo) {
    const re = new RegExp('^' + tabla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + sufijo + '(\\d+)$', 'i');
    return lista.reduce((m, x) => {
      const r = re.exec(x.nombre);
      return r ? Math.max(m, Number(r[1])) : m;
    }, 0);
  }

  // Columnas que usa una expresión (para CHECK)
  function columnasDe(e, lista = []) {
    if (!e || typeof e !== 'object') return lista;
    if (Array.isArray(e)) { e.forEach((x) => columnasDe(x, lista)); return lista; }
    if (e.t === 'col' && Array.isArray(e.partes)) lista.push(e.partes[e.partes.length - 1]);
    Object.keys(e).forEach((k) => { if (k !== 'partes') columnasDe(e[k], lista); });
    return lista;
  }

  function renombrarEnExpresion(e, viejo, nuevo) {
    if (!e || typeof e !== 'object') return;
    if (Array.isArray(e)) { e.forEach((x) => renombrarEnExpresion(x, viejo, nuevo)); return; }
    if (e.t === 'col' && Array.isArray(e.partes) && igual(e.partes[e.partes.length - 1], viejo)) e.partes[e.partes.length - 1] = nuevo;
    Object.keys(e).forEach((k) => { if (k !== 'partes') renombrarEnExpresion(e[k], viejo, nuevo); });
  }

  // Bytes de longitud de un VARCHAR: 1 hasta 255 bytes, 2 a partir de ahí
  const bytesLongitud = (t) => (t.longitud * T.CHARSETS[t.charset].bytes < 256 ? 1 : 2);

  // ¿Cambiar el tipo obliga a MySQL a copiar la tabla (y a contar sus filas)?
  function cambioConCopia(a, b) {
    const mismoTexto = T.textoTipo(a) === T.textoTipo(b) && a.charset === b.charset && a.collation === b.collation;
    if (mismoTexto) return false;
    if (a.base === 'varchar' && b.base === 'varchar' && a.charset === b.charset && a.collation === b.collation) {
      return !(b.longitud >= a.longitud && bytesLongitud(a) === bytesLongitud(b));
    }
    if ((a.base === 'enum' || a.base === 'set') && a.base === b.base && a.collation === b.collation) {
      const anade = b.valores.length >= a.valores.length && a.valores.every((v, k) => v === b.valores[k]);
      return !anade;
    }
    return true;
  }

  // Valor por defecto de una columna nueva o modificada (como en CREATE TABLE)
  P.fijarDefecto = function (col, d) {
    delete col.defecto;
    if (col.autoInc && d !== undefined) throw new ErrorSQL(1067, '42000', "Invalid default value for '" + col.nombre + "'");
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
  };

  // Valor que recibe una columna nueva NOT NULL sin DEFAULT en las filas existentes
  function valorImplicito(col, fila) {
    const b = col.tipo.base;
    if (b === 'date') throw new ErrorSQL(1292, '22007', "Incorrect date value: '0000-00-00' for column '" + col.nombre + "' at row " + fila);
    if (b === 'datetime' || b === 'timestamp') {
      throw new ErrorSQL(1292, '22007', "Incorrect datetime value: '0000-00-00 00:00:00' for column '" + col.nombre + "' at row " + fila);
    }
    if (b === 'time') return '00:00:00';
    if (b === 'enum') return col.tipo.valores[0];
    if (T.esCadena(col.tipo)) return '';
    if (b === 'json' || T.BLOBS[b] || b === 'binary' || b === 'varbinary') throw new NoDisponible('añadir columnas binarias o JSON NOT NULL a una tabla con filas');
    return 0;
  }

  P.alterarTabla = function (ast, avisos) {
    const vieja = this.tablaExistente(ast.tabla);
    const t = structuredClone(vieja);
    const bd = t.bd;
    t.columnas.forEach((c) => { c.origen = c.nombre; });
    const e = { copia: false, fksNuevas: [], validarFks: false, renombrada: null };

    const nombresIndice = new Set(['primary']);
    t.indices.forEach((i) => nombresIndice.add(i.nombre.toLowerCase()));
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
    const ctx = { nombresFk: this.cat.nombresFk(bd), contadorFk: ultimoGenerado(t.fks, t.nombre, '_ibfk_'), nombresIndice,
      reservarNombre, nombreLibre, nombresCheck: this.cat.nombresCheck(bd), contadorChk: ultimoGenerado(t.checks, t.nombre, '_chk_') };
    const columna = (n) => C.columna(t, n);
    const desconocida = (n) => new ErrorSQL(1054, '42S22', "Unknown column '" + n + "' in '" + t.nombre + "'");
    // Claves ajenas de otras tablas que apuntan a esta
    const hijas = this.cat.referenciasA(vieja);

    const comprobarColumnas = (cols) => cols.map((p) => {
      const col = columna(p.nombre);
      if (!col) throw new ErrorSQL(1072, '42000', "Key column '" + p.nombre + "' doesn't exist in table");
      if ((T.TEXTOS[col.tipo.base] || T.BLOBS[col.tipo.base]) && !p.prefijo) {
        throw new ErrorSQL(1170, '42000', "BLOB/TEXT column '" + col.nombre + "' used in key specification without a key length");
      }
      if (col.tipo.base === 'json') throw new ErrorSQL(3152, '42000', "JSON column '" + col.nombre + "' supports indexing only via generated columns on a specified JSON path.");
      return { nombre: col.nombre, prefijo: p.prefijo || null, desc: !!p.desc };
    });

    // Índice imprescindible para una clave ajena (propia o de una tabla hija)
    const necesario = (idx) => {
      const otro = (cols, unico) => t.indices.some((i) => i !== idx && (!unico || (i.unico && i.columnas.length === cols.length))
        && cols.every((c, k) => i.columnas[k] && igual(i.columnas[k].nombre, c)));
      const cubre = (cols) => cols.every((c, k) => idx.columnas[k] && igual(idx.columnas[k].nombre, c));
      if (t.fks.some((f) => cubre(f.columnas) && !otro(f.columnas, false))) return true;
      const deHijas = hijas.map((h) => h.fk).concat(t.fks.filter((f) => f.refBd === bd && f.refTabla === vieja.nombre));
      return deHijas.some((f) => idx.unico && idx.columnas.length === f.refColumnas.length && cubre(f.refColumnas) && !otro(f.refColumnas, true));
    };

    // MySQL borra el índice que creó para una clave ajena cuando otro índice
    // empieza por las mismas columnas
    const sustituirGenerados = (nuevo) => {
      t.indices.filter((i) => i.generadoFk && i !== nuevo).forEach((i) => {
        const cubre = i.columnas.every((c, k) => nuevo.columnas[k] && igual(nuevo.columnas[k].nombre, c.nombre));
        if (cubre) {
          t.indices.splice(t.indices.indexOf(i), 1);
          nombresIndice.delete(i.nombre.toLowerCase());
        }
      });
    };

    const anadirPrimaria = (cols) => {
      if (t.indices.some((i) => i.primaria)) throw new ErrorSQL(1068, '42000', 'Multiple primary key defined');
      const partes = comprobarColumnas(cols);
      partes.forEach((p) => {
        const col = columna(p.nombre);
        if (col.nulo) { col.nulo = false; col.exigeNoNulo = true; }
      });
      const pk = { nombre: 'PRIMARY', primaria: true, unico: true, columnas: partes };
      t.indices.unshift(pk);
      sustituirGenerados(pk);
    };

    const anadirIndice = (r, unico) => {
      const cols = comprobarColumnas(r.columnas);
      const nombre = r.nombreIndice || r.simbolo ? reservarNombre(r.nombreIndice || r.simbolo) : reservarNombre(nombreLibre(cols[0].nombre));
      const idx = { nombre, unico, primaria: false, columnas: cols };
      t.indices.push(idx);
      sustituirGenerados(idx);
    };

    // Columna nueva o redefinida a partir de su definición sintáctica
    const definirColumna = (c, previa) => {
      if (c.nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + c.nombre + "' is too long");
      const tipo = T.normalizarTipo(c.tipo, c.nombre, t, avisos);
      const col = { nombre: c.nombre, tipo, nulo: c.nulo !== false && !c.autoInc, autoInc: c.autoInc, comentario: c.comentario,
        alActualizarAhora: c.alActualizarAhora, origen: previa ? previa.origen : null };
      if (c.alActualizarAhora && !['datetime', 'timestamp'].includes(tipo.base)) {
        throw new ErrorSQL(1294, 'HY000', "Invalid ON UPDATE clause for '" + c.nombre + "' column");
      }
      if (c.autoInc && !['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'float', 'double'].includes(tipo.base)) {
        throw new ErrorSQL(1063, '42000', "Incorrect column specifier for column '" + c.nombre + "'");
      }
      // Las columnas de la clave primaria siguen siendo NOT NULL
      const enPk = previa && t.indices.some((i) => i.primaria && i.columnas.some((p) => igual(p.nombre, previa.nombre)));
      if (enPk) {
        if (c.nulo === true) throw new ErrorSQL(1171, '42000', 'All parts of a PRIMARY KEY must be NOT NULL; if you need NULL in a key, use UNIQUE instead');
        col.nulo = false;
      }
      this.fijarDefecto(col, c.defecto);
      if (previa && previa.origen !== null) {
        const origen = C.columna(vieja, previa.origen);
        if (cambioConCopia(origen.tipo, tipo) || !!origen.autoInc !== !!c.autoInc) e.copia = true;
        if (T.textoTipo(origen.tipo) !== T.textoTipo(tipo) || origen.tipo.charset !== tipo.charset || origen.tipo.collation !== tipo.collation) {
          col.tipoOrigen = origen.tipo;
        }
        if (origen.nulo && !col.nulo) col.exigeNoNulo = true;
      }
      // Una columna NOT NULL no puede estar en una clave ajena ON ... SET NULL
      if (!col.nulo && previa) {
        const fk = t.fks.find((f) => (f.alBorrar === 'SET NULL' || f.alActualizar === 'SET NULL') && f.columnas.some((x) => igual(x, previa.nombre)));
        if (fk) throw new ErrorSQL(1830, 'HY000', "Column '" + col.nombre + "' cannot be NOT NULL: needed in a foreign key constraint '" + fk.nombre + "' SET NULL");
      }
      return col;
    };

    const colocar = (col, pos, indiceActual) => {
      if (indiceActual >= 0) t.columnas.splice(indiceActual, 1);
      if (pos && pos.primera) t.columnas.unshift(col);
      else if (pos && pos.despues) {
        const k = t.columnas.findIndex((x) => igual(x.nombre, pos.despues));
        if (k < 0) throw desconocida(pos.despues);
        t.columnas.splice(k + 1, 0, col);
      } else if (indiceActual >= 0 && !pos) t.columnas.splice(indiceActual, 0, col);
      else t.columnas.push(col);
    };

    const extrasEnLinea = (c, col) => {
      if (c.primaria) anadirPrimaria([{ nombre: col.nombre }]);
      if (c.unico) anadirIndice({ columnas: [{ nombre: col.nombre }] }, true);
      c.checks.forEach((k) => {
        const chk = this.definirCheck(t, k, ctx);
        if (chk.aplicada) e.copia = true;
      });
    };

    // Cambia el nombre de una columna en índices y claves ajenas (MySQL no
    // reescribe los CHECK: no deja renombrar una columna que usen)
    const renombrarReferencias = (viejo, nuevo) => {
      const chk = t.checks.find((k) => columnasDe(k.expr).some((c) => igual(c, viejo)));
      if (chk) throw new ErrorSQL(3959, 'HY000', "Check constraint '" + chk.nombre + "' uses column '" + viejo + "', hence column cannot be dropped or renamed.");
      t.indices.forEach((i) => i.columnas.forEach((p) => { if (igual(p.nombre, viejo)) p.nombre = nuevo; }));
      t.fks.forEach((f) => {
        f.columnas = f.columnas.map((c) => (igual(c, viejo) ? nuevo : c));
        if (f.refBd === bd && f.refTabla === vieja.nombre) f.refColumnas = f.refColumnas.map((c) => (igual(c, viejo) ? nuevo : c));
      });
    };

    // Comprueba que una columna no la necesita una clave ajena ni un CHECK
    const comprobarUsos = (col, borrando) => {
      if (borrando) {
        const propia = t.fks.find((f) => f.columnas.some((c) => igual(c, col.nombre)));
        if (propia) throw new ErrorSQL(1828, 'HY000', "Cannot drop column '" + col.nombre + "': needed in a foreign key constraint '" + propia.nombre + "'");
        const hija = hijas.find((h) => h.fk.refColumnas.some((c) => igual(c, col.nombre)));
        if (hija) {
          throw new ErrorSQL(1829, 'HY000', "Cannot drop column '" + col.nombre + "': needed in a foreign key constraint '" + hija.fk.nombre
            + "' of table '" + hija.tabla.nombre + "'");
        }
        const chk = t.checks.find((k) => columnasDe(k.expr).some((c) => igual(c, col.nombre)));
        if (chk) {
          const solo = columnasDe(chk.expr).every((c) => igual(c, col.nombre));
          if (solo) t.checks.splice(t.checks.indexOf(chk), 1);
          else throw new ErrorSQL(3959, 'HY000', "Check constraint '" + chk.nombre + "' uses column '" + col.nombre + "', hence column cannot be dropped or renamed.");
        }
      }
    };

    // Tipos compatibles con las claves ajenas en las que participa la columna
    const comprobarFksColumna = (col) => {
      if (!this.fkChecks) return;
      t.fks.forEach((f) => f.columnas.forEach((c, k) => {
        if (!igual(c, col.nombre)) return;
        const propia = f.refBd === bd && f.refTabla === vieja.nombre;
        const padre = propia ? t : this.cat.tabla(f.refBd, f.refTabla);
        const ref = padre && C.columna(padre, f.refColumnas[k]);
        if (ref && !M.tiposCompatibles(col.tipo, ref.tipo)) {
          throw new ErrorSQL(3780, 'HY000', "Referencing column '" + col.nombre + "' and referenced column '" + ref.nombre
            + "' in foreign key constraint '" + f.nombre + "' are incompatible.");
        }
      }));
      hijas.forEach((h) => h.fk.refColumnas.forEach((c, k) => {
        if (!igual(c, col.origen || col.nombre)) return;
        const hija = C.columna(h.tabla, h.fk.columnas[k]);
        if (!M.tiposCompatibles(hija.tipo, col.tipo)) {
          throw new ErrorSQL(3780, 'HY000', "Referencing column '" + hija.nombre + "' and referenced column '" + col.nombre
            + "' in foreign key constraint '" + h.fk.nombre + "' are incompatible.");
        }
      }));
    };

    let pkBorrada = false;
    ast.ops.forEach((op) => {
      switch (op.op) {
        case 'anadirColumna': {
          if (columna(op.col.nombre)) throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + op.col.nombre + "'");
          const col = definirColumna(op.col, null);
          colocar(col, op.pos, -1);
          extrasEnLinea(op.col, col);
          break;
        }
        case 'borrarColumna': {
          const col = t.columnas.find((c) => c.origen && igual(c.origen, op.nombre));
          if (!col) throw noExiste(op.nombre);
          comprobarUsos(col, true);
          t.columnas.splice(t.columnas.indexOf(col), 1);
          if (!t.columnas.length) throw new ErrorSQL(1090, '42000', "You can't delete all columns with ALTER TABLE; use DROP TABLE instead");
          break;
        }
        case 'modificarColumna': {
          const previa = columna(op.viejo);
          if (!previa) throw desconocida(op.viejo);
          if (!igual(op.col.nombre, previa.nombre) && columna(op.col.nombre)) {
            throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + op.col.nombre + "'");
          }
          const col = definirColumna(op.col, previa);
          if (col.nombre !== previa.nombre) renombrarReferencias(previa.nombre, col.nombre);
          colocar(col, op.pos, t.columnas.indexOf(previa));
          comprobarFksColumna(col);
          extrasEnLinea(op.col, col);
          break;
        }
        case 'renombrarColumna': {
          const col = columna(op.viejo);
          if (!col) throw desconocida(op.viejo);
          if (!igual(op.viejo, op.nuevo) && columna(op.nuevo)) throw new ErrorSQL(1060, '42S21', "Duplicate column name '" + op.nuevo + "'");
          renombrarReferencias(col.nombre, op.nuevo);
          col.nombre = op.nuevo;
          break;
        }
        case 'defecto': {
          const col = columna(op.nombre);
          if (!col) throw desconocida(op.nombre);
          if (op.defecto === null) {
            delete col.defecto;
            col.sinDefecto = true;
          } else {
            this.fijarDefecto(col, op.defecto);
            delete col.sinDefecto;
          }
          break;
        }
        case 'anadirRestriccion': {
          const r = op.r;
          if (r.tipo === 'pk') anadirPrimaria(r.columnas);
          else if (r.tipo === 'unico') anadirIndice(r, true);
          else if (r.tipo === 'indice') anadirIndice(r, false);
          else if (r.tipo === 'check') {
            const chk = this.definirCheck(t, r, ctx);
            if (chk.aplicada) { e.copia = true; chk.validar = true; }
          } else if (r.tipo === 'fk') {
            const fk = this.definirFk(t, r, ctx);
            if (fk && this.fkChecks) { e.copia = true; e.fksNuevas.push(fk); }
          }
          break;
        }
        case 'borrarPrimaria': {
          const pk = t.indices.find((i) => i.primaria);
          if (!pk) throw noExiste('PRIMARY');
          if (necesario(pk)) throw new ErrorSQL(1553, 'HY000', "Cannot drop index 'PRIMARY': needed in a foreign key constraint");
          t.indices.splice(t.indices.indexOf(pk), 1);
          pkBorrada = true;
          break;
        }
        case 'borrarIndice': {
          const idx = t.indices.find((i) => igual(i.nombre, op.nombre));
          if (!idx) throw noExiste(op.nombre);
          if (necesario(idx)) throw new ErrorSQL(1553, 'HY000', "Cannot drop index '" + idx.nombre + "': needed in a foreign key constraint");
          t.indices.splice(t.indices.indexOf(idx), 1);
          nombresIndice.delete(idx.nombre.toLowerCase());
          if (idx.primaria) pkBorrada = true;
          break;
        }
        case 'borrarFk': {
          const fk = t.fks.find((f) => igual(f.nombre, op.nombre));
          if (!fk) throw noExiste(op.nombre);
          t.fks.splice(t.fks.indexOf(fk), 1);
          break;
        }
        case 'borrarCheck': {
          const chk = t.checks.find((k) => igual(k.nombre, op.nombre));
          if (!chk) throw new ErrorSQL(3821, 'HY000', "Check constraint '" + op.nombre + "' is not found in the table.");
          t.checks.splice(t.checks.indexOf(chk), 1);
          break;
        }
        case 'borrarRestriccion': {
          const chk = t.checks.find((k) => igual(k.nombre, op.nombre));
          const fk = t.fks.find((f) => igual(f.nombre, op.nombre));
          const idx = t.indices.find((i) => i.unico && igual(i.nombre, op.nombre));
          const cuantas = [chk, fk, idx].filter(Boolean).length;
          if (!cuantas) throw new ErrorSQL(3940, 'HY000', "Constraint '" + op.nombre + "' does not exist.");
          if (cuantas > 1) throw new ErrorSQL(3939, 'HY000', "Table has multiple constraints with the name '" + op.nombre + "'. Please use constraint specific 'DROP' clause.");
          if (chk) t.checks.splice(t.checks.indexOf(chk), 1);
          if (fk) t.fks.splice(t.fks.indexOf(fk), 1);
          if (idx) {
            if (necesario(idx)) throw new ErrorSQL(1553, 'HY000', "Cannot drop index '" + idx.nombre + "': needed in a foreign key constraint");
            t.indices.splice(t.indices.indexOf(idx), 1);
            nombresIndice.delete(idx.nombre.toLowerCase());
          }
          break;
        }
        case 'alterarCheck': {
          const chk = t.checks.find((k) => igual(k.nombre, op.nombre));
          if (!chk) throw new ErrorSQL(3821, 'HY000', "Check constraint '" + op.nombre + "' is not found in the table.");
          if (op.aplicada && !chk.aplicada) { e.copia = true; chk.validar = true; }
          chk.aplicada = op.aplicada;
          break;
        }
        case 'renombrarIndice': {
          const idx = t.indices.find((i) => igual(i.nombre, op.viejo));
          if (!idx) throw new ErrorSQL(1176, '42000', "Key '" + op.viejo + "' doesn't exist in table '" + t.nombre + "'");
          if (!igual(op.viejo, op.nuevo)) {
            reservarNombre(op.nuevo);
            nombresIndice.delete(idx.nombre.toLowerCase());
          }
          idx.nombre = op.nuevo;
          break;
        }
        case 'renombrarTabla': {
          const destinoBd = op.destino.bd || this.resolverBD(null);
          if (!this.cat.bd(destinoBd)) throw new ErrorSQL(1049, '42000', "Unknown database '" + destinoBd + "'");
          if (destinoBd !== bd) throw new NoDisponible('mover tablas a otra base de datos');
          if (op.destino.nombre.length > 64) throw new ErrorSQL(1059, '42000', "Identifier name '" + op.destino.nombre + "' is too long");
          if (op.destino.nombre !== vieja.nombre && this.cat.tabla(bd, op.destino.nombre)) {
            throw new ErrorSQL(1050, '42S01', "Table '" + op.destino.nombre + "' already exists");
          }
          e.renombrada = op.destino.nombre;
          break;
        }
        case 'opciones': {
          const o = op.o;
          if (o.motor) {
            const m = o.motor.toLowerCase();
            const motores = { innodb: 'InnoDB', myisam: 'MyISAM' };
            if (!motores[m]) throw new NoDisponible('el motor ' + o.motor);
            if (motores[m] !== t.motor) {
              if (t.fks.length || hijas.length) throw new ErrorSQL(3776, 'HY000', "Cannot change table's storage engine because the table participates in a foreign key constraint.");
              t.motor = motores[m];
              e.copia = true;
            }
          }
          if (o.comentario !== undefined) t.comentario = o.comentario || null;
          if (o.autoInc !== undefined) e.autoInc = o.autoInc;
          if (o.charset || o.collation) {
            const [cs, col] = T.resolverCharset(o.charset, o.collation, t.charset, t.collation, avisos);
            t.charset = cs;
            t.collation = col;
          }
          break;
        }
        default: throw new NoDisponible('ALTER TABLE');
      }
    });

    // Los índices pierden las columnas que ya no existen (si se borra una
    // columna y se añade otra con el mismo nombre, el índice pasa a la nueva)
    t.indices.forEach((i) => { i.columnas = i.columnas.filter((p) => columna(p.nombre)); });
    t.indices = t.indices.filter((i) => i.columnas.length);

    // Validación final de la definición
    const autos = t.columnas.filter((c) => c.autoInc);
    if (autos.length > 1 || (autos.length === 1 && !t.indices.some((i) => igual(i.columnas[0].nombre, autos[0].nombre)))) {
      throw new ErrorSQL(1075, '42000', 'Incorrect table definition; there can be only one auto column and it must be defined as a key');
    }
    if (pkBorrada && !t.indices.some((i) => i.primaria)) e.copia = true;
    t.checks.forEach((k) => {
      const ausente = columnasDe(k.expr).find((c) => !columna(c));
      if (ausente) throw new ErrorSQL(3820, 'HY000', "Check constraint '" + k.nombre + "' refers to non-existing column '" + ausente + "'.");
      k.texto = C.textoExpresion(k.expr);
      k.sql = TR.traducir(k.expr, { srv: this, enCheck: { tabla: t, nombre: k.nombre }, clausula: 'check' }).sql;
    });

    // Nombres de columna de la tabla vieja que cambian (para las tablas hijas)
    const renombres = new Map();
    t.columnas.forEach((c) => { if (c.origen && c.origen !== c.nombre) renombres.set(c.origen.toLowerCase(), c.nombre); });
    const nombreFinal = e.renombrada || vieja.nombre;
    const hijasAfectadas = hijas.filter((h) => h.fk.refColumnas.some((c) => renombres.has(c.toLowerCase())) || nombreFinal !== vieja.nombre);
    t.fks.forEach((f) => {
      if (f.refBd === bd && f.refTabla === vieja.nombre) {
        f.refTabla = nombreFinal;
        f.refColumnas = f.refColumnas.map((c) => renombres.get(c.toLowerCase()) || c);
      }
    });
    if (nombreFinal !== vieja.nombre) {
      t.fks.filter((f) => f.generado).forEach((f) => {
        const n = new RegExp('^' + vieja.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_ibfk_(\\d+)$', 'i').exec(f.nombre);
        if (n) f.nombre = nombreFinal + '_ibfk_' + n[1];
      });
    }
    t.nombre = nombreFinal;

    const filas = this.reconstruir(vieja, t, e);
    // Las tablas hijas apuntan al nuevo nombre de la tabla o de sus columnas
    hijasAfectadas.forEach((h) => {
      const hija = this.cat.tabla(h.tabla.bd, h.tabla.nombre);
      const nueva = structuredClone(hija);
      nueva.fks.forEach((f) => {
        if (f.refBd === bd && f.refTabla === vieja.nombre) {
          f.refTabla = nombreFinal;
          f.refColumnas = f.refColumnas.map((c) => renombres.get(c.toLowerCase()) || c);
        }
      });
      nueva.columnas.forEach((c) => { c.origen = c.nombre; });
      this.reconstruir(hija, nueva, { copia: false, fksNuevas: [] });
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: e.copia ? filas : 0 };
  };

  // Sustituye la tabla de SQLite de 'vieja' por la definición 'nueva' y copia
  // sus filas. Devuelve el número de filas copiadas.
  P.reconstruir = function (vieja, nueva, e) {
    const fisica = nombreTablaSQL(vieja.bd, vieja.nombre);
    const temporal = id('~alter.' + TR.nombreSQLite(vieja.bd, vieja.nombre));
    const pk = vieja.indices.find((i) => i.primaria);
    const orden = pk ? pk.columnas.map((c) => id(c.nombre)).join(', ') : 'rowid';
    let n = 0;
    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('SAVEPOINT alterar');
    try {
      this.db.run('PRAGMA legacy_alter_table = ON');
      this.db.run('ALTER TABLE ' + fisica + ' RENAME TO ' + temporal);
      this.db.run('PRAGMA legacy_alter_table = OFF');
      const indices = this.db.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
        ['~alter.' + TR.nombreSQLite(vieja.bd, vieja.nombre)]);
      if (indices.length) indices[0].values.forEach(([nombre]) => this.db.run('DROP INDEX ' + id(nombre)));
      this.ddlSQLite(nueva).forEach((s) => this.db.run(s));

      const cols = nueva.columnas;
      const st = this.db.prepare('SELECT ' + vieja.columnas.map((c) => id(c.nombre)).join(', ') + ' FROM ' + temporal + ' ORDER BY ' + orden);
      const ins = this.db.prepare('INSERT INTO ' + nombreTablaSQL(nueva.bd, nueva.nombre) + ' (' + cols.map((c) => id(c.nombre)).join(', ')
        + ') VALUES (' + cols.map(() => '?').join(', ') + ')');
      const posicion = new Map(vieja.columnas.map((c, k) => [c.nombre.toLowerCase(), k]));
      try {
        while (st.step()) {
          n++;
          const fila = st.get();
          const valores = cols.map((c) => {
            if (c.origen === null) {
              if (c.autoInc) return n;
              if (c.defecto !== undefined) {
                if (c.defecto.nulo) return null;
                if (c.defecto.ahora) return T.convertir(ahora(), c, n);
                return c.defecto.valor;
              }
              if (c.nulo) return null;
              return valorImplicito(c, n);
            }
            const v = fila[posicion.get(c.origen.toLowerCase())];
            if (v === null || v === undefined) {
              if (!c.nulo) throw new ErrorSQL(1138, '22004', 'Invalid use of NULL value');
              return null;
            }
            if (!c.tipoOrigen) return v;
            const literal = typeof v === 'number' ? String(T.mostrarValor(v, c.tipoOrigen)) : null;
            try {
              return T.convertir(typeof v === 'number' ? literal : v, c, n, null, literal);
            } catch (err) {
              // ALTER informa del texto que no cabe como truncado, no como demasiado largo
              if (err instanceof ErrorSQL && err.codigo === 1406) throw new ErrorSQL(1265, '01000', err.message.replace('Data too long', 'Data truncated'));
              throw err;
            }
          });
          try {
            ins.run(valores);
          } catch (err) {
            const porColumna = (col) => valores[cols.indexOf(col)];
            throw this.errorEscritura(err, nueva, porColumna);
          }
        }
      } finally {
        st.free();
        ins.free();
      }
      this.db.run('DROP TABLE ' + temporal);

      // Las claves ajenas nuevas tienen que cumplirse con los datos existentes
      if (e.fksNuevas.length) {
        const r = this.db.exec('PRAGMA foreign_key_check(' + nombreTablaSQL(nueva.bd, nueva.nombre) + ')');
        if (r.length && r[0].values.length) {
          const fk = e.fksNuevas[0];
          throw new ErrorSQL(1452, '23000', 'Cannot add or update a child row: a foreign key constraint fails (' + C.cita(nueva.bd)
            + '.`#sql-1_1`, CONSTRAINT ' + C.cita(fk.nombre) + ' ' + C.referenciaFk(fk, nueva) + ')');
        }
      }
      this.db.run('RELEASE alterar');
    } catch (err) {
      this.db.run('ROLLBACK TO alterar');
      this.db.run('RELEASE alterar');
      this.db.run('PRAGMA legacy_alter_table = OFF');
      throw err;
    } finally {
      this.db.run('PRAGMA foreign_keys = ' + (this.fkChecks ? 'ON' : 'OFF'));
    }

    // Contador AUTO_INCREMENT
    const auto = nueva.columnas.find((c) => c.autoInc);
    if (!auto) nueva.autoInc = null;
    else {
      const r = this.db.exec('SELECT max(' + id(auto.nombre) + ') FROM ' + nombreTablaSQL(nueva.bd, nueva.nombre));
      const max = r.length ? r[0].values[0][0] : null;
      const minimo = max === null ? 1 : Math.floor(max) + 1;
      if (e.autoInc !== undefined) nueva.autoInc = Math.max(e.autoInc, minimo);
      else if (!vieja.columnas.some((c) => c.autoInc) || nueva.autoInc === null) nueva.autoInc = max === null ? nueva.autoInc : minimo;
      else nueva.autoInc = Math.max(nueva.autoInc, minimo);
    }
    nueva.columnas.forEach((c) => { delete c.origen; delete c.tipoOrigen; delete c.exigeNoNulo; });
    nueva.checks.forEach((k) => delete k.validar);
    const base = this.cat.bd(vieja.bd);
    if (nueva.nombre !== vieja.nombre) base.tablas.delete(vieja.nombre);
    base.tablas.set(nueva.nombre, nueva);
    return n;
  };

  P.vaciarTabla = function (ast) {
    const t = this.tablaExistente(ast.tabla);
    if (this.fkChecks) {
      const hija = this.cat.referenciasA(t).sort((a, b) => (a.tabla.nombre < b.tabla.nombre ? -1 : a.tabla.nombre > b.tabla.nombre ? 1 : 0))[0];
      if (hija) {
        throw new ErrorSQL(1701, '42000', 'Cannot truncate a table referenced in a foreign key constraint (' + C.cita(hija.tabla.bd) + '.'
          + C.cita(hija.tabla.nombre) + ', CONSTRAINT ' + C.cita(hija.fk.nombre) + ')');
      }
    }
    this.db.run('PRAGMA foreign_keys = OFF');
    try {
      this.db.run('DELETE FROM ' + nombreTablaSQL(t.bd, t.nombre));
    } finally {
      this.db.run('PRAGMA foreign_keys = ' + (this.fkChecks ? 'ON' : 'OFF'));
    }
    t.autoInc = null;
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  // RENAME TABLE a TO b, c TO d: todo o nada
  P.renombrarTablas = function (ast, avisos) {
    const copia = this.instantanea();
    try {
      ast.pares.forEach((p) => this.alterarTabla({ tabla: p.de, ops: [{ op: 'renombrarTabla', destino: { bd: p.a.bd || p.de.bd, nombre: p.a.nombre } }] }, avisos));
    } catch (err) {
      this.restaurar(copia);
      throw err;
    }
    return { tipo: 'cambio', afectadas: 0 };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
