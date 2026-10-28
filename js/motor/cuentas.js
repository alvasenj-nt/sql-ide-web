'use strict';
// Cuentas, privilegios y roles del servidor emulado: CREATE, ALTER, DROP y
// RENAME USER, CREATE y DROP ROLE, GRANT y REVOKE (global, de base de datos,
// de tabla y de columna, y de roles), SET DEFAULT ROLE, SHOW GRANTS y las
// tablas mysql.user, mysql.db, mysql.tables_priv, mysql.columns_priv,
// mysql.role_edges y mysql.default_roles. El laboratorio tiene una sola
// sesión, la de root: los privilegios se guardan y se muestran, pero no se
// comprueban al ejecutar sentencias.
(function (global) {
  const M = global.MotorMySQL;
  const { ErrorSQL, NoDisponible } = M;
  const TR = M.traductor;
  const { id } = TR;
  const P = M.Servidor.prototype;

  // Orden de los privilegios en SHOW GRANTS
  const ORDEN = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'RELOAD', 'SHUTDOWN', 'PROCESS', 'FILE', 'REFERENCES',
    'INDEX', 'ALTER', 'SHOW DATABASES', 'SUPER', 'CREATE TEMPORARY TABLES', 'LOCK TABLES', 'EXECUTE', 'REPLICATION SLAVE',
    'REPLICATION CLIENT', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'CREATE USER', 'EVENT', 'TRIGGER',
    'CREATE TABLESPACE', 'CREATE ROLE', 'DROP ROLE'];
  const DE_BD = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'REFERENCES', 'INDEX', 'ALTER', 'CREATE TEMPORARY TABLES',
    'LOCK TABLES', 'EXECUTE', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EVENT', 'TRIGGER'];
  const DE_TABLA = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'REFERENCES', 'INDEX', 'ALTER', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER'];
  const DE_COLUMNA = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
  const ordenar = (lista) => lista.slice().sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b));
  // Nombre del privilegio en las columnas SET de mysql.tables_priv y columns_priv
  const NOMBRE_SET = { SELECT: 'Select', INSERT: 'Insert', UPDATE: 'Update', DELETE: 'Delete', CREATE: 'Create', DROP: 'Drop',
    REFERENCES: 'References', INDEX: 'Index', ALTER: 'Alter', 'CREATE VIEW': 'Create View', 'SHOW VIEW': 'Show view', TRIGGER: 'Trigger' };
  // Columnas *_priv de mysql.user y mysql.db
  const COLUMNAS_USER = [['Select_priv', 'SELECT'], ['Insert_priv', 'INSERT'], ['Update_priv', 'UPDATE'], ['Delete_priv', 'DELETE'],
    ['Create_priv', 'CREATE'], ['Drop_priv', 'DROP'], ['Reload_priv', 'RELOAD'], ['Shutdown_priv', 'SHUTDOWN'], ['Process_priv', 'PROCESS'],
    ['File_priv', 'FILE'], ['Grant_priv', 'GRANT OPTION'], ['References_priv', 'REFERENCES'], ['Index_priv', 'INDEX'], ['Alter_priv', 'ALTER'],
    ['Show_db_priv', 'SHOW DATABASES'], ['Super_priv', 'SUPER'], ['Create_tmp_table_priv', 'CREATE TEMPORARY TABLES'],
    ['Lock_tables_priv', 'LOCK TABLES'], ['Execute_priv', 'EXECUTE'], ['Repl_slave_priv', 'REPLICATION SLAVE'],
    ['Repl_client_priv', 'REPLICATION CLIENT'], ['Create_view_priv', 'CREATE VIEW'], ['Show_view_priv', 'SHOW VIEW'],
    ['Create_routine_priv', 'CREATE ROUTINE'], ['Alter_routine_priv', 'ALTER ROUTINE'], ['Create_user_priv', 'CREATE USER'],
    ['Event_priv', 'EVENT'], ['Trigger_priv', 'TRIGGER'], ['Create_tablespace_priv', 'CREATE TABLESPACE']];
  const COLUMNAS_DB = [['Select_priv', 'SELECT'], ['Insert_priv', 'INSERT'], ['Update_priv', 'UPDATE'], ['Delete_priv', 'DELETE'],
    ['Create_priv', 'CREATE'], ['Drop_priv', 'DROP'], ['Grant_priv', 'GRANT OPTION'], ['References_priv', 'REFERENCES'],
    ['Index_priv', 'INDEX'], ['Alter_priv', 'ALTER'], ['Create_tmp_table_priv', 'CREATE TEMPORARY TABLES'],
    ['Lock_tables_priv', 'LOCK TABLES'], ['Create_view_priv', 'CREATE VIEW'], ['Show_view_priv', 'SHOW VIEW'],
    ['Create_routine_priv', 'CREATE ROUTINE'], ['Alter_routine_priv', 'ALTER ROUTINE'], ['Execute_priv', 'EXECUTE'],
    ['Event_priv', 'EVENT'], ['Trigger_priv', 'TRIGGER']];

  // Cuentas del servidor recién instalado (imagen mysql:8.0 de Docker)
  const SISTEMA = [['root', '%'], ['root', 'localhost'], ['mysql.infoschema', 'localhost'], ['mysql.session', 'localhost'],
    ['mysql.sys', 'localhost']];

  const clave = (c) => c.usuario + '@' + c.host.toLowerCase();
  const texto = (c) => "'" + c.usuario + "'@'" + c.host + "'";
  const citada = (c) => '`' + c.usuario + '`@`' + c.host + '`';
  const listaTexto = (l) => l.map(texto).join(',');
  const yaExiste = (c) => ['Note', 3163, 'Authorization ID ' + texto(c) + ' already exists.'];
  const noExisteNota = (c) => ['Note', 3162, 'Authorization ID ' + texto(c) + ' does not exist.'];
  const desconocida = (c) => new ErrorSQL(3523, 'HY000', 'Unknown authorization ID ' + citada(c));
  const sinGrant = (c) => new ErrorSQL(1141, '42000', "There is no such grant defined for user '" + c.usuario + "' on host '" + c.host + "'");
  // --skip-name-resolve: GRANT y REVOKE avisan si el host es un nombre de máquina
  const avisoNombre = (c) => /[a-z]/i.test(c.host) && c.host !== '%'
    ? ['Warning', 1285, 'MySQL is started in --skip-name-resolve mode; you must restart it without this switch for this grant to work'] : null;

  function nuevaCuenta(usuario, host, rol, sistema) {
    return { usuario, host: host.toLowerCase(), rol: !!rol, sistema: !!sistema, bloqueada: !!rol || (sistema && usuario.startsWith('mysql.')),
      global: [], globalGrant: false, bds: {}, tablas: {}, roles: {}, rolesDefecto: [] };
  }

  P.cuentasIniciales = function () {
    const m = new Map();
    SISTEMA.forEach(([u, h]) => m.set(u + '@' + h, nuevaCuenta(u, h, false, true)));
    return m;
  };

  P.cuentas = function () {
    if (!this.cat.cuentas) this.cat.cuentas = this.cuentasIniciales();
    return this.cat.cuentas;
  };

  P.cuenta = function (c) {
    if (c.actual) return this.cuentas().get('root@%');
    return this.cuentas().get(clave(c)) || null;
  };

  const comprobarNombre = (c) => {
    if (c.actual) return;
    if (c.usuario.length > 32) throw new ErrorSQL(1470, 'HY000', "String '" + c.usuario + "' is too long for user name (should be no longer than 32)");
    if (c.host.length > 255) throw new ErrorSQL(1470, 'HY000', "String '" + c.host + "' is too long for host name (should be no longer than 255)");
  };

  // ---------- cuentas y roles ----------

  P.crearCuenta = function (ast, avisos) {
    const operacion = ast.rol ? 'CREATE ROLE' : 'CREATE USER';
    ast.cuentas.forEach(comprobarNombre);
    const fallan = ast.cuentas.filter((c) => this.cuenta(c));
    if (fallan.length && !ast.siNoExiste) throw new ErrorSQL(1396, 'HY000', 'Operation ' + operacion + ' failed for ' + listaTexto(fallan));
    ast.cuentas.forEach((c) => {
      if (this.cuenta(c)) { avisos.push(yaExiste(c)); return; }
      const nueva = nuevaCuenta(c.usuario, c.host, ast.rol, false);
      if (ast.bloqueo !== undefined) nueva.bloqueada = ast.bloqueo;
      this.cuentas().set(clave(nueva), nueva);
    });
    // DEFAULT ROLE en CREATE USER: los roles tienen que existir, pero no se conceden
    if (ast.rolesDefecto) {
      const claves = ast.rolesDefecto.map((r) => {
        const rol = this.cuenta(r);
        if (!rol) throw desconocida(r);
        return clave(rol);
      });
      ast.cuentas.forEach((c) => { this.cuenta(c).rolesDefecto = claves.slice(); });
    }
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.alterarCuenta = function (ast, avisos) {
    const fallan = ast.cuentas.filter((c) => !this.cuenta(c));
    if (fallan.length && !ast.siExiste) throw new ErrorSQL(1396, 'HY000', 'Operation ALTER USER failed for ' + listaTexto(fallan));
    fallan.forEach((c) => avisos.push(noExisteNota(c)));
    ast.cuentas.map((c) => this.cuenta(c)).filter(Boolean).forEach((c) => {
      if (c.sistema) throw new NoDisponible('modificar las cuentas del sistema');
      if (ast.bloqueo !== undefined) c.bloqueada = ast.bloqueo;
    });
    if (ast.rolesDefecto) this.rolesDefecto({ roles: ast.rolesDefecto, cuentas: ast.cuentas });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.borrarCuenta = function (ast, avisos) {
    const operacion = ast.rol ? 'DROP ROLE' : 'DROP USER';
    const fallan = ast.cuentas.filter((c) => !this.cuenta(c));
    if (fallan.length && !ast.siExiste) throw new ErrorSQL(1396, 'HY000', 'Operation ' + operacion + ' failed for ' + listaTexto(fallan));
    fallan.forEach((c) => avisos.push(noExisteNota(c)));
    ast.cuentas.map((c) => this.cuenta(c)).filter(Boolean).forEach((c) => {
      if (c.sistema) throw new NoDisponible('borrar las cuentas del sistema');
      const k = clave(c);
      this.cuentas().delete(k);
      // Deja de estar concedido como rol
      this.cuentas().forEach((otra) => {
        delete otra.roles[k];
        otra.rolesDefecto = otra.rolesDefecto.filter((r) => r !== k);
      });
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.renombrarCuentas = function (ast) {
    const copia = structuredClone(this.cuentas());
    try {
      ast.pares.forEach((p) => {
        const c = this.cuenta(p.de);
        if (!c || this.cuenta(p.a)) throw new ErrorSQL(1396, 'HY000', 'Operation RENAME USER failed for ' + texto(p.de));
        if (c.sistema) throw new NoDisponible('renombrar las cuentas del sistema');
        const viejo = clave(c);
        this.cuentas().delete(viejo);
        c.usuario = p.a.usuario;
        c.host = p.a.host.toLowerCase();
        const nuevo = clave(c);
        this.cuentas().set(nuevo, c);
        this.cuentas().forEach((otra) => {
          if (otra.roles[viejo]) { otra.roles[nuevo] = otra.roles[viejo]; delete otra.roles[viejo]; }
          otra.rolesDefecto = otra.rolesDefecto.map((r) => (r === viejo ? nuevo : r));
        });
      });
    } catch (e) {
      this.cat.cuentas = copia;
      throw e;
    }
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  // ---------- GRANT y REVOKE de privilegios ----------

  // Comprueba el objeto del privilegio y devuelve { nivel, bd, tabla }
  P.objetoPrivilegio = function (o) {
    if (o.nivel === 'global') return o;
    const bd = o.bd || this.resolverBD(null);
    if (o.nivel === 'bd') return { nivel: 'bd', bd };
    const t = this.cat.tabla(bd, o.tabla) || this.cat.vista(bd, o.tabla);
    return { nivel: 'tabla', bd, tabla: o.tabla, objeto: t };
  };

  // Lista de privilegios con ALL expandido al nivel; comprueba que valen en él
  function privilegiosDeNivel(lista, nivel) {
    const validos = nivel === 'global' ? ORDEN : nivel === 'bd' ? DE_BD : DE_TABLA;
    const salida = [];
    lista.forEach((p) => {
      if (p.privilegio === 'ALL PRIVILEGES') {
        if (nivel === 'global') throw new NoDisponible('GRANT ALL ON *.* (privilegios dinámicos)');
        validos.forEach((v) => salida.push({ privilegio: v, columnas: null }));
        return;
      }
      if (p.privilegio === 'USAGE') return;
      if (p.privilegio === 'GRANT OPTION') { salida.push(p); return; }
      if (!validos.includes(p.privilegio)) {
        if (nivel === 'bd') throw new ErrorSQL(1221, 'HY000', 'Incorrect usage of DB GRANT and GLOBAL PRIVILEGES');
        throw new ErrorSQL(1144, '42000', 'Illegal GRANT/REVOKE command; please consult the manual to see which privileges can be used');
      }
      salida.push(p);
    });
    return salida;
  }

  const anadir = (lista, p) => { if (!lista.includes(p)) lista.push(p); };

  P.conceder = function (ast, avisos) {
    const obj = this.objetoPrivilegio(ast.objeto);
    const cuentas = ast.cuentas.map((c) => {
      const cuenta = this.cuenta(c);
      if (!cuenta) throw new ErrorSQL(1410, '42000', 'You are not allowed to create a user with GRANT');
      if (cuenta.sistema) throw new NoDisponible('dar privilegios a las cuentas del sistema');
      return cuenta;
    });
    if (obj.nivel === 'tabla' && !obj.objeto) throw new ErrorSQL(1146, '42S02', "Table '" + obj.bd + '.' + obj.tabla + "' doesn't exist");
    const privs = privilegiosDeNivel(ast.privilegios, obj.nivel);
    if (obj.nivel === 'tabla') {
      privs.filter((p) => p.columnas).forEach((p) => p.columnas.forEach((col) => {
        const c = obj.objeto.columnas.find((x) => x.nombre.toLowerCase() === col.toLowerCase());
        if (!c) throw new ErrorSQL(1054, '42S22', "Unknown column '" + col + "' in '" + obj.tabla + "'");
      }));
    }
    cuentas.forEach((c) => {
      if (obj.nivel === 'global') {
        privs.forEach((p) => { if (p.privilegio === 'GRANT OPTION') c.globalGrant = true; else anadir(c.global, p.privilegio); });
        if (ast.opcion) c.globalGrant = true;
      } else if (obj.nivel === 'bd') {
        const r = c.bds[obj.bd] || (c.bds[obj.bd] = { privs: [], grant: false });
        privs.forEach((p) => { if (p.privilegio === 'GRANT OPTION') r.grant = true; else anadir(r.privs, p.privilegio); });
        if (ast.opcion) r.grant = true;
      } else {
        const k = obj.bd + '.' + obj.tabla;
        const r = c.tablas[k] || (c.tablas[k] = { bd: obj.bd, tabla: obj.tabla, privs: [], grant: false, columnas: {} });
        privs.forEach((p) => {
          if (p.privilegio === 'GRANT OPTION') { r.grant = true; return; }
          if (!p.columnas) { anadir(r.privs, p.privilegio); return; }
          p.columnas.forEach((col) => {
            const nombre = obj.objeto.columnas.find((x) => x.nombre.toLowerCase() === col.toLowerCase()).nombre;
            anadir(r.columnas[nombre] || (r.columnas[nombre] = []), p.privilegio);
          });
        });
        if (ast.opcion) r.grant = true;
      }
      const aviso = avisoNombre(c);
      if (aviso) avisos.push(aviso);
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  const vacia = (r) => !r.privs.length && !r.grant && !(r.columnas && Object.keys(r.columnas).length);

  P.revocar = function (ast, avisos) {
    const obj = this.objetoPrivilegio(ast.objeto);
    const privs = privilegiosDeNivel(ast.privilegios, obj.nivel);
    ast.cuentas.forEach((datos) => {
      const c = this.cuenta(datos);
      const sinTabla = () => new ErrorSQL(1147, '42000', "There is no such grant defined for user '" + datos.usuario + "' on host '"
        + datos.host + "' on table '" + obj.tabla + "'");
      if (!c) throw obj.nivel === 'tabla' ? sinTabla() : sinGrant(datos);
      if (c.sistema) throw new NoDisponible('quitar privilegios a las cuentas del sistema');
      if (obj.nivel === 'global') {
        privs.forEach((p) => {
          if (p.privilegio === 'GRANT OPTION') c.globalGrant = false;
          else c.global = c.global.filter((x) => x !== p.privilegio);
        });
      } else if (obj.nivel === 'bd') {
        const r = c.bds[obj.bd];
        if (!r) throw sinGrant(datos);
        privs.forEach((p) => {
          if (p.privilegio === 'GRANT OPTION') r.grant = false;
          else r.privs = r.privs.filter((x) => x !== p.privilegio);
        });
        if (vacia(r)) delete c.bds[obj.bd];
      } else {
        const k = obj.bd + '.' + obj.tabla;
        const r = c.tablas[k];
        if (!r) throw sinTabla();
        privs.forEach((p) => {
          if (p.privilegio === 'GRANT OPTION') { r.grant = false; return; }
          if (!p.columnas) { r.privs = r.privs.filter((x) => x !== p.privilegio); return; }
          p.columnas.forEach((col) => {
            const nombre = Object.keys(r.columnas).find((x) => x.toLowerCase() === col.toLowerCase());
            if (!nombre || !r.columnas[nombre].includes(p.privilegio)) throw sinTabla();
            r.columnas[nombre] = r.columnas[nombre].filter((x) => x !== p.privilegio);
            if (!r.columnas[nombre].length) delete r.columnas[nombre];
          });
        });
        if (vacia(r)) delete c.tablas[k];
      }
      const aviso = avisoNombre(c);
      if (aviso) avisos.push(aviso);
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.revocarTodo = function (ast) {
    ast.cuentas.forEach((datos) => {
      const c = this.cuenta(datos);
      if (!c) throw sinGrant(datos);
      if (c.sistema) throw new NoDisponible('quitar privilegios a las cuentas del sistema');
      c.global = [];
      c.globalGrant = false;
      c.bds = {};
      c.tablas = {};
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  // ---------- roles ----------

  P.concederRoles = function (ast) {
    const roles = ast.roles.map((r) => {
      const c = this.cuenta(r);
      if (!c) throw desconocida(r);
      return c;
    });
    const cuentas = ast.cuentas.map((d) => {
      const c = this.cuenta(d);
      if (!c) throw desconocida(d);
      if (c.sistema) throw new NoDisponible('dar roles a las cuentas del sistema');
      return c;
    });
    cuentas.forEach((c) => roles.forEach((r) => {
      const k = clave(r);
      c.roles[k] = { admin: ast.admin || !!(c.roles[k] && c.roles[k].admin) };
    }));
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.revocarRoles = function (ast) {
    const roles = ast.roles.map((r) => {
      const c = this.cuenta(r);
      if (!c) throw desconocida(r);
      return c;
    });
    ast.cuentas.forEach((d) => {
      const c = this.cuenta(d);
      if (!c) throw desconocida(d);
      roles.forEach((r) => {
        const k = clave(r);
        delete c.roles[k];
        c.rolesDefecto = c.rolesDefecto.filter((x) => x !== k);
      });
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  P.rolesDefecto = function (ast) {
    const cuentas = ast.cuentas.map((d) => {
      const c = this.cuenta(d);
      if (!c) throw desconocida(d);
      return c;
    });
    cuentas.forEach((c) => {
      if (ast.roles === 'NONE') { c.rolesDefecto = []; return; }
      if (ast.roles === 'ALL') { c.rolesDefecto = Object.keys(c.roles); return; }
      c.rolesDefecto = ast.roles.map((r) => {
        const rol = this.cuenta(r);
        if (!rol) throw desconocida(r);
        if (!c.roles[clave(rol)]) throw new ErrorSQL(3530, 'HY000', citada(rol) + ' is not granted to ' + citada(c));
        return clave(rol);
      });
    });
    this.cambioCatalogo();
    return { tipo: 'cambio', afectadas: 0 };
  };

  // ---------- SHOW GRANTS ----------

  // Une los privilegios de una cuenta con los de los roles indicados
  function unir(base, roles) {
    const u = structuredClone(base);
    roles.forEach((r) => {
      r.global.forEach((p) => anadir(u.global, p));
      Object.entries(r.bds).forEach(([bd, x]) => {
        const d = u.bds[bd] || (u.bds[bd] = { privs: [], grant: false });
        x.privs.forEach((p) => anadir(d.privs, p));
        d.grant = d.grant || x.grant;
      });
      Object.entries(r.tablas).forEach(([k, x]) => {
        const d = u.tablas[k] || (u.tablas[k] = { bd: x.bd, tabla: x.tabla, privs: [], grant: false, columnas: {} });
        x.privs.forEach((p) => anadir(d.privs, p));
        d.grant = d.grant || x.grant;
        Object.entries(x.columnas).forEach(([col, ps]) => ps.forEach((p) => anadir(d.columnas[col] || (d.columnas[col] = []), p)));
      });
    });
    return u;
  }

  function lineaPrivilegios(privs, todos) {
    if (todos.every((p) => privs.includes(p))) return 'ALL PRIVILEGES';
    return ordenar(privs).join(', ');
  }

  P.mostrarPrivilegios = function (ast) {
    if (!ast.cuenta || ast.cuenta.actual) throw new NoDisponible('SHOW GRANTS de la cuenta root');
    const c = this.cuenta(ast.cuenta);
    if (!c) throw sinGrant(ast.cuenta);
    if (c.sistema) throw new NoDisponible('SHOW GRANTS de las cuentas del sistema');
    const roles = (ast.roles || []).map((r) => {
      const rol = this.cuenta(r);
      if (!rol || !c.roles[clave(rol)]) throw new ErrorSQL(3530, 'HY000', citada(rol || r) + ' is not granted to ' + citada(c));
      return rol;
    });
    const u = unir(c, roles);
    const destino = ' TO ' + citada(c);
    const lineas = [];
    const conGrant = (s, g) => s + (g ? ' WITH GRANT OPTION' : '');
    lineas.push(conGrant('GRANT ' + (u.global.length ? ordenar(u.global).join(', ') : 'USAGE') + ' ON *.*' + destino, u.globalGrant));
    Object.keys(u.bds).sort().forEach((bd) => {
      const r = u.bds[bd];
      lineas.push(conGrant('GRANT ' + (r.privs.length ? lineaPrivilegios(r.privs, DE_BD) : 'USAGE') + ' ON `' + bd + '`.*' + destino, r.grant));
    });
    Object.keys(u.tablas).sort().forEach((k) => {
      const r = u.tablas[k];
      const partes = [];
      const porPrivilegio = {};
      Object.keys(r.columnas).forEach((col) => r.columnas[col].forEach((p) => (porPrivilegio[p] || (porPrivilegio[p] = [])).push(col)));
      if (r.privs.length && DE_TABLA.every((p) => r.privs.includes(p))) partes.push('ALL PRIVILEGES');
      else {
        ordenar(Array.from(new Set(r.privs.concat(Object.keys(porPrivilegio))))).forEach((p) => {
          const cols = porPrivilegio[p];
          if (r.privs.includes(p) && cols) partes.push(p);
          if (cols) partes.push(p + ' (' + cols.map((x) => '`' + x + '`').join(', ') + ')');
          else partes.push(p);
        });
      }
      lineas.push(conGrant('GRANT ' + (partes.length ? partes.join(', ') : 'USAGE') + ' ON `' + r.bd + '`.`' + r.tabla + '`' + destino, r.grant));
    });
    const concedidos = Object.keys(c.roles).sort().map((k) => ({ cuenta: this.cuentas().get(k), admin: c.roles[k].admin })).filter((x) => x.cuenta);
    const sinAdmin = concedidos.filter((x) => !x.admin);
    const conAdmin = concedidos.filter((x) => x.admin);
    if (sinAdmin.length) lineas.push('GRANT ' + sinAdmin.map((x) => citada(x.cuenta)).join(',') + destino);
    if (conAdmin.length) lineas.push('GRANT ' + conAdmin.map((x) => citada(x.cuenta)).join(',') + destino + ' WITH ADMIN OPTION');
    return { tipo: 'filas', columnas: ['Grants for ' + c.usuario + '@' + c.host], filas: lineas.map((l) => [l]) };
  };

  // ---------- tablas de privilegios ----------

  const TABLAS_MYSQL = {
    user: [['Host', 'v'], ['User', 'v']].concat(COLUMNAS_USER.map(([n]) => [n, 'v']), [['plugin', 'v'], ['authentication_string', 'v'],
      ['password_expired', 'v'], ['password_lifetime', 'i'], ['account_locked', 'v'], ['Create_role_priv', 'v'], ['Drop_role_priv', 'v']]),
    db: [['Host', 'v'], ['Db', 'v'], ['User', 'v']].concat(COLUMNAS_DB.map(([n]) => [n, 'v'])),
    tables_priv: [['Host', 'v'], ['Db', 'v'], ['User', 'v'], ['Table_name', 'v'], ['Grantor', 'v'], ['Timestamp', 'v'], ['Table_priv', 'v'],
      ['Column_priv', 'v']],
    columns_priv: [['Host', 'v'], ['Db', 'v'], ['User', 'v'], ['Table_name', 'v'], ['Column_name', 'v'], ['Timestamp', 'v'], ['Column_priv', 'v']],
    role_edges: [['FROM_HOST', 'v'], ['FROM_USER', 'v'], ['TO_HOST', 'v'], ['TO_USER', 'v'], ['WITH_ADMIN_OPTION', 'v']],
    default_roles: [['HOST', 'v'], ['USER', 'v'], ['DEFAULT_ROLE_HOST', 'v'], ['DEFAULT_ROLE_USER', 'v']],
  };
  const INFO_PRIVILEGIOS = {
    USER_PRIVILEGES: [['GRANTEE', 'v'], ['TABLE_CATALOG', 'v'], ['PRIVILEGE_TYPE', 'v'], ['IS_GRANTABLE', 'v']],
    SCHEMA_PRIVILEGES: [['GRANTEE', 'v'], ['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['PRIVILEGE_TYPE', 'v'], ['IS_GRANTABLE', 'v']],
    TABLE_PRIVILEGES: [['GRANTEE', 'v'], ['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['PRIVILEGE_TYPE', 'v'],
      ['IS_GRANTABLE', 'v']],
    COLUMN_PRIVILEGES: [['GRANTEE', 'v'], ['TABLE_CATALOG', 'v'], ['TABLE_SCHEMA', 'v'], ['TABLE_NAME', 'v'], ['COLUMN_NAME', 'v'],
      ['PRIVILEGE_TYPE', 'v'], ['IS_GRANTABLE', 'v']],
  };
  Object.assign(M.catalogo.INFO, INFO_PRIVILEGIOS);

  const yn = (b) => (b ? 'Y' : 'N');
  const conjunto = (lista) => ordenar(lista).map((p) => NOMBRE_SET[p] || p).join(',');

  P.filasPrivilegios = function (nombre) {
    const cuentas = Array.from(this.cuentas().values());
    const propias = cuentas.filter((c) => !c.sistema);
    const filas = [];
    switch (nombre) {
      case 'user':
        cuentas.forEach((c) => {
          const todo = c.sistema && c.usuario === 'root';
          filas.push([c.host, c.usuario].concat(COLUMNAS_USER.map(([, p]) => yn(todo || (p === 'GRANT OPTION' ? c.globalGrant : c.global.includes(p)))),
            ['caching_sha2_password', '', 'N', null, yn(c.bloqueada), yn(todo || c.global.includes('CREATE ROLE')), yn(todo || c.global.includes('DROP ROLE'))]));
        });
        break;
      case 'db':
        propias.forEach((c) => Object.entries(c.bds).forEach(([bd, r]) => filas.push([c.host, bd, c.usuario]
          .concat(COLUMNAS_DB.map(([, p]) => yn(p === 'GRANT OPTION' ? r.grant : r.privs.includes(p)))))));
        break;
      case 'tables_priv':
        propias.forEach((c) => Object.values(c.tablas).forEach((r) => {
          const deColumnas = new Set();
          Object.values(r.columnas).forEach((ps) => ps.forEach((p) => deColumnas.add(p)));
          const tabla = conjunto(r.privs) + (r.grant ? (r.privs.length ? ',' : '') + 'Grant' : '');
          filas.push([c.host, r.bd, c.usuario, r.tabla, 'root@%', '0000-00-00 00:00:00', tabla, conjunto(Array.from(deColumnas))]);
        }));
        break;
      case 'columns_priv':
        propias.forEach((c) => Object.values(c.tablas).forEach((r) => Object.entries(r.columnas).forEach(([col, ps]) => {
          filas.push([c.host, r.bd, c.usuario, r.tabla, col, '0000-00-00 00:00:00', conjunto(ps)]);
        })));
        break;
      case 'role_edges':
        propias.forEach((c) => Object.entries(c.roles).forEach(([k, r]) => {
          const rol = this.cuentas().get(k);
          if (rol) filas.push([rol.host, rol.usuario, c.host, c.usuario, yn(r.admin)]);
        }));
        break;
      case 'default_roles':
        propias.forEach((c) => c.rolesDefecto.forEach((k) => {
          const rol = this.cuentas().get(k);
          if (rol) filas.push([c.host, c.usuario, rol.host, rol.usuario]);
        }));
        break;
      case 'USER_PRIVILEGES':
        propias.forEach((c) => {
          const g = "'" + c.usuario + "'@'" + c.host + "'";
          if (!c.global.length) filas.push([g, 'def', 'USAGE', 'NO']);
          ordenar(c.global).forEach((p) => filas.push([g, 'def', p, c.globalGrant ? 'YES' : 'NO']));
        });
        break;
      case 'SCHEMA_PRIVILEGES':
        propias.forEach((c) => Object.entries(c.bds).forEach(([bd, r]) => ordenar(r.privs).forEach((p) => filas.push(["'" + c.usuario + "'@'" + c.host + "'", 'def', bd, p, r.grant ? 'YES' : 'NO']))));
        break;
      case 'TABLE_PRIVILEGES':
        propias.forEach((c) => Object.values(c.tablas).forEach((r) => ordenar(r.privs).forEach((p) => filas.push(["'" + c.usuario + "'@'" + c.host + "'", 'def', r.bd, r.tabla, p, r.grant ? 'YES' : 'NO']))));
        break;
      case 'COLUMN_PRIVILEGES':
        propias.forEach((c) => Object.values(c.tablas).forEach((r) => Object.entries(r.columnas).forEach(([col, ps]) => ordenar(ps).forEach((p) => {
          filas.push(["'" + c.usuario + "'@'" + c.host + "'", 'def', r.bd, r.tabla, col, p, r.grant ? 'YES' : 'NO']);
        }))));
        break;
      default: break;
    }
    // Las tablas de mysql se recorren en el orden de su clave primaria
    const clavePrimaria = { user: 2, db: 3, tables_priv: 4, columns_priv: 5, role_edges: 4, default_roles: 4 }[nombre];
    if (clavePrimaria) {
      const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      filas.sort((x, y) => {
        for (let k = 0; k < clavePrimaria; k++) { const r = comparar(String(x[k]), String(y[k])); if (r) return r; }
        return 0;
      });
    }
    return filas;
  };

  // Fuente del FROM para las tablas de privilegios de la base de datos mysql
  P.fuenteMysql = function (r) {
    const nombre = r.nombre.toLowerCase();
    const cols = TABLAS_MYSQL[nombre];
    if (!cols) throw new NoDisponible('la tabla mysql.' + r.nombre);
    const fisica = 'mysql.' + nombre;
    if (this.infoMaterializada[fisica] !== this.versionCatalogo) {
      this.db.run('DROP TABLE IF EXISTS ' + id(fisica));
      // Usuarios y bases de datos distinguen mayúsculas; los hosts, no
      const binaria = (n) => /^(User|Db|Table_name|Column_name|FROM_USER|TO_USER|USER|DEFAULT_ROLE_USER)$/.test(n);
      this.db.run('CREATE TABLE ' + id(fisica) + ' (' + cols.map(([n, t]) => id(n) + (t === 'i' ? ' INTEGER'
        : ' TEXT COLLATE ' + (binaria(n) ? 'BINARY' : 'NOCASE'))).join(', ') + ')');
      const filas = this.filasPrivilegios(nombre);
      if (filas.length) {
        const st = this.db.prepare('INSERT INTO ' + id(fisica) + ' VALUES (' + cols.map(() => '?').join(', ') + ')');
        filas.forEach((f) => st.run(f));
        st.free();
      }
      this.infoMaterializada[fisica] = this.versionCatalogo;
    }
    const alias = r.alias || r.nombre;
    return { alias, conAlias: !!r.alias, bd: 'mysql', nombre: r.alias ? r.nombre : nombre,
      columnas: cols.map(([n, t]) => ({ nombre: n, tipo: t === 'i' ? TR.TIPO_ENTERO : TR.TIPO_TEXTO })),
      sql: id(alias), desde: id(fisica) + ' AS ' + id(alias) };
  };

  // Cuentas y roles creados, con su SHOW GRANTS (pestaña Administration)
  P.resumenCuentas = function () {
    return Array.from(this.cuentas().values()).filter((c) => !c.sistema)
      .sort((a, b) => (a.usuario < b.usuario ? -1 : a.usuario > b.usuario ? 1 : a.host < b.host ? -1 : 1))
      .map((c) => ({ nombre: c.usuario + '@' + c.host, rol: c.rol, bloqueada: c.bloqueada,
        privilegios: this.mostrarPrivilegios({ cuenta: { usuario: c.usuario, host: c.host } }).filas.map((f) => f[0]) }));
  };

  M.cuentas = { ORDEN, DE_BD, DE_TABLA, DE_COLUMNA };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
