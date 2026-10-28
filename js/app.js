'use strict';
/* global CodeMirror, initSqlJs, MotorMySQL */

const VERSION_INFORME = 'INFORME LABORATORIO MYSQL WEB v1';
const VERSION_ENTORNO = 'ENTORNO LABORATORIO MYSQL WEB v1';
const PARAMETROS = new URLSearchParams(location.search);
// El diagnóstico solo se muestra abriendo la página con ?diagnostico
const MODO_PROFESOR = PARAMETROS.has('diagnostico');

// Cada práctica es una carpeta practicas/<id>/ con su manifiesto
// practica.json y se elige con ?p=<id>. Sin parámetro no se carga ninguna:
// cada práctica solo aparece en su cuestionario.
const ID_PRACTICA = PARAMETROS.get('p');
const RE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_CARPETA = /^[a-z0-9_]+$/;
const RE_ARCHIVO = /^[a-z0-9_]+\.(sql|txt)$/;
const ESQUEMA_MAXIMO = 1;
const MAX_FILAS = 1000;

let PRACTICA = null;
let CLAVE = 'diagnostico:';
const ARCHIVOS = {};
const carpetaDe = (n) => (n && n.includes('/') ? n.split('/')[0] : null);
const esSQL = (n) => ARCHIVOS[n] && ARCHIVOS[n].modo === 'sql';

const PRUEBAS = [
  ['carga', 'Carga del servidor'],
  ['entorno', 'Versión de SQLite y núcleos del equipo'],
  ['errores', 'Errores de MySQL con su código'],
  ['integridad', 'Claves ajenas y acciones referenciales'],
  ['diccionario', 'SHOW CREATE TABLE e information_schema'],
  ['rendimiento', 'Inserción de 2000 filas'],
  ['restaurar', 'Reiniciar el servidor'],
  ['tareaScript', 'Tu proyecto: última ejecución'],
];

const estado = {
  plantillas: {},
  docs: {},
  comprobaciones: {},
  activo: null,
  ocupado: false,
  listo: false,
  continuar: false,
  inicioPagina: performance.now(),
  marcas: [],
  numeroSalida: 0,
  resultados: [],
  resultadoActivo: 0,
  abiertos: new Set(),
  seleccion: null,
  diag: {},
  metricas: { carga: null, ejecuciones: 0, conErrores: 0, ultimaEjecucion: 'sin ejecutar', comprobaciones: 0,
    ultimaComprobacion: 'sin comprobar' },
};

let SQL = null;
let srv = null;
let inicial = null;
let editor = null;
let cronometro = null;

const $ = (id) => document.getElementById(id);

function leerAlmacen(clave) {
  try { return localStorage.getItem(CLAVE + clave); } catch (e) { return null; }
}
function escribirAlmacen(clave, valor) {
  try { localStorage.setItem(CLAVE + clave, valor); } catch (e) { /* sin almacenamiento */ }
}

function setEstado(texto) { $('estado').textContent = texto; }

function iniciarCronometro() {
  const inicio = performance.now();
  cronometro = setInterval(() => { $('cronometro').textContent = ((performance.now() - inicio) / 1000).toFixed(0) + ' s'; }, 500);
}
function pararCronometro() {
  clearInterval(cronometro);
  $('cronometro').textContent = '';
}

function mostrarPanel(nombre) {
  document.querySelectorAll('.pestana-salida').forEach((p) => p.classList.toggle('activa', p.dataset.panel === nombre));
  document.querySelectorAll('.contenido-salida').forEach((c) => c.classList.toggle('activo', c.id === 'panel-' + nombre));
}

const ejercicioDe = (carpeta) => (PRACTICA ? PRACTICA.ejercicios.find((ej) => ej.carpeta === carpeta) : null);

function actualizarBotones() {
  const sql = esSQL(estado.activo);
  const libre = estado.listo && !estado.ocupado;
  $('btn-ejecutar').disabled = !libre || !sql;
  $('btn-sentencia').disabled = !libre || !sql;
  const ej = ejercicioDe(carpetaDe(estado.activo));
  $('btn-comprobar').disabled = !libre || !ej || !ej.comprobaciones;
  $('btn-comprobar').title = ej && ej.comprobaciones ? 'Comprobar los requisitos de ' + ej.carpeta : 'Este ejercicio no tiene comprobaciones automáticas';
  $('btn-copiar-codigo').disabled = !ej;
  $('btn-diagnostico').disabled = !libre;
  $('btn-reiniciar').disabled = !libre;
}

async function conBloqueo(fn) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  actualizarBotones();
  iniciarCronometro();
  // Deja que el navegador pinte el estado antes de un trabajo largo
  await new Promise((r) => setTimeout(r, 20));
  try {
    await fn();
  } catch (e) {
    setEstado('Error inesperado: ' + e.message);
    console.error(e);
  } finally {
    pararCronometro();
    estado.ocupado = false;
    actualizarBotones();
  }
}

// ---------- práctica ----------

function validarManifiesto(m) {
  const fallo = (motivo) => { throw new Error('manifiesto no válido: ' + motivo); };
  if (!m || !Number.isInteger(m.esquema)) fallo('falta el número de esquema');
  if (m.esquema > ESQUEMA_MAXIMO) fallo('el esquema ' + m.esquema + ' necesita una versión más reciente del laboratorio');
  if (m.id !== ID_PRACTICA) fallo('el identificador no coincide con la carpeta');
  if (!Number.isInteger(m.version) || m.version < 1) fallo('versión no válida');
  if (!Array.isArray(m.ejercicios) || !m.ejercicios.length) fallo('no hay ejercicios');
  if (m.inicial !== undefined && !RE_ARCHIVO.test(m.inicial)) fallo('script inicial no válido');
  m.ejercicios.forEach((ej) => {
    if (!RE_CARPETA.test(ej.carpeta)) fallo('carpeta no válida');
    if (!ej.archivos.some((a) => a.editable && a.nombre.endsWith('.sql'))) fallo(ej.carpeta + ' no tiene ningún script editable');
    ej.archivos.forEach((a) => { if (!RE_ARCHIVO.test(a.nombre)) fallo('archivo no válido: ' + a.nombre); });
    if (ej.comprobaciones !== undefined && !/^[a-z0-9_]+\.json$/.test(ej.comprobaciones)) fallo('comprobaciones no válidas en ' + ej.carpeta);
  });
  return m;
}

async function cargarPractica() {
  if (!RE_ID.test(ID_PRACTICA)) throw new Error('identificador de práctica no válido');
  const base = 'practicas/' + ID_PRACTICA + '/';
  const r = await fetch(base + 'practica.json', { cache: 'no-cache' });
  if (r.status === 404) throw Object.assign(new Error('práctica no publicada'), { noPublicada: true });
  if (!r.ok) throw new Error('el servidor respondió ' + r.status);
  PRACTICA = validarManifiesto(await r.json());
  CLAVE = PRACTICA.id + ':v' + PRACTICA.version + ':';
  if (PRACTICA.readme) ARCHIVOS[PRACTICA.readme] = { ruta: base + PRACTICA.readme, soloLectura: true, modo: 'text' };
  PRACTICA.ejercicios.forEach((ej) => ej.archivos.forEach((a) => {
    ARCHIVOS[ej.carpeta + '/' + a.nombre] = { ruta: base + ej.carpeta + '/' + a.nombre, soloLectura: !a.editable,
      modo: a.nombre.endsWith('.sql') ? 'sql' : 'text' };
  }));
  estado.activo = PRACTICA.readme || Object.keys(ARCHIVOS)[0];
  document.title = 'Laboratorio MySQL BD · ' + PRACTICA.titulo;
  document.querySelector('.subtitulo').textContent = PRACTICA.titulo;
  if (PRACTICA.inicial) {
    const ri = await fetch(base + PRACTICA.inicial, { cache: 'no-cache' });
    if (!ri.ok) throw new Error(PRACTICA.inicial + ': ' + ri.status);
    PRACTICA.textoInicial = await ri.text();
  }
}

async function cargarFuentes() {
  const nombres = Object.keys(ARCHIVOS);
  const textos = await Promise.all(nombres.map((n) => fetch(ARCHIVOS[n].ruta, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(n + ': ' + r.status);
    return r.text();
  })));
  nombres.forEach((n, i) => { estado.plantillas[n] = textos[i]; });
}

// ---------- servidor ----------

async function arrancarServidor() {
  const t0 = performance.now();
  SQL = await initSqlJs({ locateFile: (f) => 'lib/' + f });
  srv = new MotorMySQL.Servidor(SQL);
  if (PRACTICA && PRACTICA.textoInicial) {
    const r = srv.ejecutarScript(PRACTICA.textoInicial, { seguir: false });
    const fallo = r.find((x) => !x.ok);
    if (fallo) throw new Error('el estado inicial de la práctica falló en la línea ' + fallo.sentencia.linea + ': ' + fallo.error.mensaje);
  }
  srv.bdActual = null;
  inicial = srv.instantanea();
  return (performance.now() - t0) / 1000;
}

function reiniciarServidor() {
  srv.restaurar(inicial);
}

// ---------- editor ----------

// Modo MySQL de CodeMirror con las palabras clave y los tipos de la unidad
function definirModoSQL() {
  const base = CodeMirror.resolveMode('text/x-mysql');
  const conjunto = (s) => s.split(' ').reduce((o, w) => { o[w] = true; return o; }, {});
  CodeMirror.defineMIME('text/x-mysql-lab', Object.assign({}, base, {
    keywords: Object.assign({}, base.keywords, conjunto('primary key foreign references constraint check auto_increment '
      + 'unique default engine charset collate cascade restrict action no if exists not null database schema use show '
      + 'describe desc tables columns index indexes warnings on delete update set create drop alter table insert into '
      + 'values select from where and or in like between is order by group having limit distinct as comment')),
    builtin: Object.assign({}, base.builtin, conjunto('int integer char varchar tinyint smallint mediumint bigint decimal '
      + 'numeric float double real boolean bool bit date datetime timestamp time year enum text tinytext mediumtext '
      + 'longtext blob tinyblob mediumblob longblob binary varbinary json unsigned zerofill innodb myisam utf8mb4 utf8mb3 latin1')),
  }));
}

function crearEditor() {
  definirModoSQL();
  Object.keys(ARCHIVOS).forEach((n) => {
    const guardado = ARCHIVOS[n].soloLectura ? null : leerAlmacen('archivo:' + n);
    estado.docs[n] = CodeMirror.Doc(guardado !== null ? guardado : estado.plantillas[n], ARCHIVOS[n].modo === 'sql' ? 'text/x-mysql-lab' : 'text/plain');
  });
  const ultimo = leerAlmacen('activo');
  if (ultimo && ARCHIVOS[ultimo]) estado.activo = ultimo;
  editor = CodeMirror($('contenedor-editor'), {
    value: estado.docs[estado.activo],
    theme: 'workbench',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    gutters: ['marcas', 'CodeMirror-linenumbers'],
    extraKeys: {
      'Ctrl-Enter': () => { if (!$('btn-sentencia').disabled) accionSentencia(); },
      'Shift-Ctrl-Enter': () => { if (!$('btn-ejecutar').disabled) accionEjecutar(); },
      'Ctrl-/': 'toggleComment',
      'Ctrl-Space': (cm) => cm.showHint({ hint: CodeMirror.hint.sql, tables: tablasParaAyuda(), completeSingle: false }),
      Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    ')),
      'Shift-Tab': 'indentLess',
    },
  });
  construirPestanas();
  abrirArchivo(estado.activo);
  editor.on('change', () => {
    if (!ARCHIVOS[estado.activo].soloLectura) escribirAlmacen('archivo:' + estado.activo, editor.getValue());
  });
}

// Tablas y columnas del servidor para el autocompletado (Ctrl+Espacio)
function tablasParaAyuda() {
  const tablas = {};
  if (!srv) return tablas;
  srv.esquemas().forEach((b) => b.tablas.forEach((t) => {
    const cols = t.columnas.map((c) => c.nombre);
    tablas[t.nombre] = cols;
    tablas[b.nombre + '.' + t.nombre] = cols;
  }));
  return tablas;
}

function construirPestanas() {
  const cont = $('pestanas-editor');
  cont.innerHTML = '';
  Object.keys(ARCHIVOS).forEach((n) => {
    const b = document.createElement('button');
    b.className = 'pestana-editor';
    b.dataset.archivo = n;
    b.setAttribute('role', 'tab');
    const ico = document.createElement('span');
    ico.className = 'ico-sql';
    b.append(ico, document.createTextNode(n));
    if (ARCHIVOS[n].soloLectura) {
      const s = document.createElement('span');
      s.className = 'solo-lectura';
      s.textContent = '(solo lectura)';
      b.append(' ', s);
    }
    b.addEventListener('click', () => abrirArchivo(n));
    cont.appendChild(b);
  });
}

function abrirArchivo(nombre) {
  if (!ARCHIVOS[nombre]) return;
  limpiarMarcas();
  estado.activo = nombre;
  escribirAlmacen('activo', nombre);
  editor.swapDoc(estado.docs[nombre]);
  editor.setOption('readOnly', ARCHIVOS[nombre].soloLectura);
  $('ruta-archivo').textContent = nombre + (ARCHIVOS[nombre].soloLectura ? ' (solo lectura)' : '');
  document.querySelectorAll('.pestana-editor').forEach((b) => b.classList.toggle('activa', b.dataset.archivo === nombre));
  actualizarBotones();
  pintarComprobaciones();
  editor.focus();
}

function limpiarMarcas() {
  estado.marcas.forEach(({ doc, linea, error }) => {
    doc.setGutterMarker(linea, 'marcas', null);
    if (error) doc.removeLineClass(linea, 'background', 'linea-error');
  });
  estado.marcas = [];
}

function marcarLinea(linea, clase, titulo) {
  const doc = estado.docs[estado.activo];
  const l = Math.min(Math.max(linea - 1, 0), doc.lineCount() - 1);
  const m = document.createElement('span');
  m.className = 'marca-sentencia ' + clase;
  m.title = titulo || '';
  doc.setGutterMarker(l, 'marcas', m);
  const error = clase === 'marca-error';
  if (error) doc.addLineClass(l, 'background', 'linea-error');
  estado.marcas.push({ doc, linea: l, error });
}

function irALinea(linea) {
  editor.setCursor({ line: linea - 1, ch: 0 });
  editor.scrollIntoView({ line: linea - 1, ch: 0 }, 80);
  editor.focus();
}

// ---------- salida y resultados ----------

const horaCorta = () => new Date().toTimeString().slice(0, 8);

function mensajeWorkbench(r) {
  if (r.omitida) return 'No se ejecutó: el script se detuvo en el error anterior.';
  if (r.noDisponible) return r.error.mensaje;
  if (!r.ok) return r.error.codigo ? 'Error Code: ' + r.error.codigo + '. ' + r.error.mensaje : r.error.mensaje;
  let m;
  if (r.tipo === 'filas') m = r.filas.length + ' row(s) returned';
  else m = r.mensaje || r.afectadas + ' row(s) affected';
  if (r.avisos) {
    m += ', ' + r.avisos + ' warning(s): ' + r.listaAvisos.map((a) => a[1] + ' ' + a[2]).join(' ');
  }
  if (r.info) m += ' ' + r.info;
  return m;
}

function anotarSalida(r, desplazamiento = 0) {
  const fila = document.createElement('tr');
  const estadoClase = r.omitida ? 'estado-omitida' : !r.ok ? (r.noDisponible ? 'estado-aviso' : 'estado-error') : r.avisos ? 'estado-aviso' : 'estado-ok';
  if (!r.ok && !r.omitida && !r.noDisponible) fila.className = 'fila-error';
  if (r.noDisponible) fila.className = 'no-disponible';
  const celdas = [];
  const icono = document.createElement('span');
  icono.className = estadoClase;
  celdas.push(icono);
  estado.numeroSalida++;
  celdas.push(String(estado.numeroSalida), horaCorta(), r.sentencia.texto.replace(/\s+/g, ' ').slice(0, 200), mensajeWorkbench(r),
    r.omitida ? '' : r.duracion.toFixed(3) + ' sec');
  celdas.forEach((c, i) => {
    const td = document.createElement('td');
    if (i === 3) td.className = 'accion';
    if (i === 4) td.className = 'mensaje';
    if (c instanceof Node) td.appendChild(c); else td.textContent = c;
    if (i === 3) td.title = r.sentencia.texto;
    fila.appendChild(td);
  });
  const linea = r.sentencia.linea + desplazamiento;
  fila.addEventListener('click', () => irALinea(linea));
  $('lista-salida').appendChild(fila);
  $('panel-salida').scrollTop = $('panel-salida').scrollHeight;
}

function mostrarResultados(lista) {
  estado.resultados = lista;
  const cont = $('pestanas-resultado');
  cont.innerHTML = '';
  lista.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'pestana-resultado';
    b.textContent = 'Result ' + (i + 1);
    b.title = r.sentencia.texto;
    b.addEventListener('click', () => pintarRejilla(i));
    cont.appendChild(b);
  });
  if (lista.length) pintarRejilla(lista.length - 1);
  else $('rejilla').innerHTML = '<p class="nota-panel">Las consultas que devuelven filas aparecen aquí (Result Grid).</p>';
}

function pintarRejilla(i) {
  estado.resultadoActivo = i;
  document.querySelectorAll('.pestana-resultado').forEach((b, k) => b.classList.toggle('activa', k === i));
  const r = estado.resultados[i];
  const tabla = document.createElement('table');
  const cab = document.createElement('tr');
  r.columnas.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c;
    cab.appendChild(th);
  });
  const thead = document.createElement('thead');
  thead.appendChild(cab);
  tabla.appendChild(thead);
  const cuerpo = document.createElement('tbody');
  r.filas.slice(0, MAX_FILAS).forEach((f) => {
    const tr = document.createElement('tr');
    f.forEach((v) => {
      const td = document.createElement('td');
      if (v === null) { td.textContent = 'NULL'; td.className = 'nulo'; }
      else {
        td.textContent = v;
        if (/^-?\d+(\.\d+)?$/.test(v)) td.className = 'num';
        if (v.includes('\n')) td.style.maxWidth = 'none';
      }
      tr.appendChild(td);
    });
    cuerpo.appendChild(tr);
  });
  tabla.appendChild(cuerpo);
  const rejilla = $('rejilla');
  rejilla.innerHTML = '';
  rejilla.appendChild(tabla);
  if (r.filas.length > MAX_FILAS) {
    const p = document.createElement('p');
    p.className = 'resumen';
    p.textContent = 'Se muestran ' + MAX_FILAS + ' de ' + r.filas.length + ' filas.';
    rejilla.appendChild(p);
  }
}

// ---------- navegador de esquemas ----------

function pintarNavegador() {
  const arbol = $('arbol-esquemas');
  arbol.innerHTML = '';
  if (!srv) return;
  const filtro = $('filtro').value.trim().toLowerCase();
  const esquemas = srv.esquemas().sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
  $('bd-actual').textContent = srv.bdActual ? 'Default schema: ' + srv.bdActual : 'Sin base de datos por defecto';
  if (!esquemas.length) {
    const li = document.createElement('li');
    li.className = 'vacio';
    li.textContent = 'No hay bases de datos';
    arbol.appendChild(li);
  }
  esquemas.forEach((b) => {
    const pasa = (n) => !filtro || b.nombre.toLowerCase().includes(filtro) || n.toLowerCase().includes(filtro);
    const tablas = b.tablas.filter((t) => pasa(t.nombre));
    const vistas = (b.vistas || []).filter((v) => pasa(v.nombre));
    if (filtro && !tablas.length && !vistas.length && !b.nombre.toLowerCase().includes(filtro)) return;
    const liBD = nodo(arbol, 'bd:' + b.nombre, 'ico-esquema', b.nombre, true, 'nodo-esquema' + (srv.bdActual === b.nombre ? ' por-defecto' : ''));
    liBD.querySelector('.nodo').addEventListener('dblclick', () => usarEsquema(b.nombre));
    liBD.querySelector('.nodo').addEventListener('click', () => informarEsquema(b));
    const ulBD = liBD.querySelector('ul');
    const carpetaTablas = nodo(ulBD, 'tablas:' + b.nombre, 'ico-carpeta', 'Tables', true);
    const ulT = carpetaTablas.querySelector('ul');
    if (!tablas.length) vacio(ulT);
    tablas.sort((x, y) => (x.nombre < y.nombre ? -1 : 1)).forEach((t) => {
      const liT = nodo(ulT, 't:' + b.nombre + '.' + t.nombre, 'ico-tabla', t.nombre, true);
      liT.querySelector('.nodo').addEventListener('click', () => informarTabla(b, t));
      liT.querySelector('.nodo').addEventListener('dblclick', () => insertarTexto(t.nombre));
      const ul = liT.querySelector('ul');
      const cols = nodo(ul, 'c:' + b.nombre + '.' + t.nombre, 'ico-carpeta', 'Columns', true).querySelector('ul');
      t.columnas.forEach((c) => {
        const li = nodo(cols, null, c.pk ? 'ico-clave' : c.fk ? 'ico-ajena' : 'ico-columna', c.nombre, false);
        const tipo = document.createElement('span');
        tipo.className = 'tipo-nodo';
        tipo.textContent = c.tipo;
        li.querySelector('.nodo').appendChild(tipo);
        li.querySelector('.nodo').addEventListener('dblclick', () => insertarTexto(c.nombre));
      });
      const idx = nodo(ul, 'i:' + b.nombre + '.' + t.nombre, 'ico-carpeta', 'Indexes', true).querySelector('ul');
      if (!t.indices.length) vacio(idx);
      t.indices.forEach((i) => nodo(idx, null, 'ico-indice', i.nombre + ' (' + i.columnas.join(', ') + ')', false));
      const fks = nodo(ul, 'f:' + b.nombre + '.' + t.nombre, 'ico-carpeta', 'Foreign Keys', true).querySelector('ul');
      if (!t.fks.length) vacio(fks);
      t.fks.forEach((f) => nodo(fks, null, 'ico-ajena', f.nombre + ' → ' + f.ref, false));
      const chk = nodo(ul, 'k:' + b.nombre + '.' + t.nombre, 'ico-carpeta', 'Checks', true).querySelector('ul');
      if (!t.checks.length) vacio(chk);
      t.checks.forEach((k) => nodo(chk, null, 'ico-check', k.nombre, false));
    });
    const ulV = nodo(ulBD, 'vistas:' + b.nombre, 'ico-carpeta', 'Views', true).querySelector('ul');
    if (!vistas.length) vacio(ulV);
    vistas.sort((x, y) => (x.nombre < y.nombre ? -1 : 1)).forEach((v) => {
      const liV = nodo(ulV, 'v:' + b.nombre + '.' + v.nombre, 'ico-vista', v.nombre, true);
      liV.querySelector('.nodo').addEventListener('click', () => informarVista(v));
      liV.querySelector('.nodo').addEventListener('dblclick', () => insertarTexto(v.nombre));
      const cols = nodo(liV.querySelector('ul'), 'vc:' + b.nombre + '.' + v.nombre, 'ico-carpeta', 'Columns', true).querySelector('ul');
      v.columnas.forEach((c) => {
        const li = nodo(cols, null, 'ico-columna', c.nombre, false);
        const tipo = document.createElement('span');
        tipo.className = 'tipo-nodo';
        tipo.textContent = c.tipo;
        li.querySelector('.nodo').appendChild(tipo);
        li.querySelector('.nodo').addEventListener('dblclick', () => insertarTexto(c.nombre));
      });
    });
    ['Stored Procedures', 'Functions'].forEach((n) => vacio(nodo(ulBD, null, 'ico-carpeta', n, true).querySelector('ul')));
  });
}

function nodo(padre, clave, icono, texto, conHijos, claseExtra) {
  const li = document.createElement('li');
  if (claseExtra) li.className = claseExtra;
  if (clave && estado.abiertos.has(clave)) li.classList.add('abierto');
  const fila = document.createElement('div');
  fila.className = 'nodo';
  const flecha = document.createElement('span');
  flecha.className = conHijos ? 'flecha' : 'sin-flecha';
  const ico = document.createElement('span');
  ico.className = 'ico ' + icono;
  const nombre = document.createElement('span');
  nombre.className = 'nombre-nodo';
  nombre.textContent = texto;
  fila.append(flecha, ico, nombre);
  li.appendChild(fila);
  if (conHijos) {
    li.appendChild(document.createElement('ul'));
    const alternar = () => {
      li.classList.toggle('abierto');
      if (clave) {
        if (li.classList.contains('abierto')) estado.abiertos.add(clave); else estado.abiertos.delete(clave);
      }
    };
    flecha.addEventListener('click', (ev) => { ev.stopPropagation(); alternar(); });
    if (!claseExtra || !claseExtra.includes('nodo-esquema')) fila.addEventListener('dblclick', (ev) => { if (ev.target === nombre || ev.target === ico) alternar(); });
  }
  fila.addEventListener('click', () => {
    document.querySelectorAll('.nodo.seleccionado').forEach((n) => n.classList.remove('seleccionado'));
    fila.classList.add('seleccionado');
  });
  padre.appendChild(li);
  return li;
}

function vacio(ul) {
  const li = document.createElement('li');
  li.className = 'vacio';
  li.textContent = 'n/a';
  ul.appendChild(li);
}

function insertarTexto(t) {
  if (ARCHIVOS[estado.activo] && !ARCHIVOS[estado.activo].soloLectura) {
    editor.replaceSelection(t);
    editor.focus();
  }
}

function informarEsquema(b) {
  const info = $('info-objeto');
  info.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'info-titulo';
  t.textContent = 'Schema: ' + b.nombre;
  const p = document.createElement('div');
  p.textContent = b.tablas.length + ' tabla(s)';
  info.append(t, p);
}

function informarTabla(b, tabla) {
  const info = $('info-objeto');
  info.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'info-titulo';
  t.textContent = 'Table: ' + tabla.nombre + ' (' + tabla.motor + ')';
  const tab = document.createElement('table');
  tabla.columnas.forEach((c) => {
    const tr = document.createElement('tr');
    [c.nombre, c.tipo + (c.nulo ? '' : ' NOT NULL'), c.clave].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    tab.appendChild(tr);
  });
  info.append(t, tab);
}

function informarVista(vista) {
  const info = $('info-objeto');
  info.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'info-titulo';
  t.textContent = 'View: ' + vista.nombre + (vista.actualizable ? ' (updatable)' : ' (read only)')
    + (vista.opcion !== 'NONE' ? ', ' + vista.opcion + ' CHECK OPTION' : '');
  const tab = document.createElement('table');
  vista.columnas.forEach((c) => {
    const tr = document.createElement('tr');
    [c.nombre, c.tipo + (c.nulo ? '' : ' NOT NULL')].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    tab.appendChild(tr);
  });
  const def = document.createElement('pre');
  def.className = 'info-definicion';
  def.textContent = vista.texto;
  info.append(t, tab, def);
}

function usarEsquema(nombre) {
  if (estado.ocupado || !estado.listo) return;
  const r = srv.ejecutar({ texto: 'USE `' + nombre.replace(/`/g, '``') + '`', linea: 1 });
  anotarSalida(r);
  pintarNavegador();
}

// ---------- acciones ----------

// Ejecuta el script completo sobre un servidor recién reiniciado: el script
// debe poder lanzarse de nuevo con el mismo resultado
async function accionEjecutar() {
  if (!esSQL(estado.activo)) return;
  await conBloqueo(async () => {
    mostrarPanel('salida');
    limpiarMarcas();
    reiniciarServidor();
    $('lista-salida').innerHTML = '';
    estado.numeroSalida = 0;
    const t0 = performance.now();
    const resultados = srv.ejecutarScript(editor.getValue(), { seguir: estado.continuar });
    const segundos = (performance.now() - t0) / 1000;
    resultados.forEach((r) => anotarSalida(r));
    marcarResultados(resultados, 0);
    mostrarResultados(resultados.filter((r) => r.ok && r.tipo === 'filas'));
    pintarNavegador();
    const errores = resultados.filter((r) => !r.ok && !r.omitida);
    estado.metricas.ejecuciones++;
    if (errores.length) estado.metricas.conErrores++;
    estado.metricas.ultimaEjecucion = carpetaDe(estado.activo) + ': ' + resultados.filter((r) => !r.omitida).length + ' sentencias, '
      + errores.length + ' errores';
    estado.diag.tareaScript = { texto: estado.metricas.ultimaEjecucion, valor: errores.length ? 'aviso' : 'ok' };
    pintarDiagnostico();
    if (errores.length) {
      const primero = errores[0];
      irALinea(primero.sentencia.linea);
      setEstado('Script ejecutado con ' + errores.length + ' error(es). El primero, en la línea ' + primero.sentencia.linea + ': '
        + (primero.error.codigo ? 'Error Code ' + primero.error.codigo : primero.error.mensaje));
    } else {
      setEstado('Script ejecutado desde un servidor limpio: ' + resultados.length + ' sentencias sin errores (' + segundos.toFixed(2) + ' s).');
    }
  });
}

// Ejecuta la sentencia del cursor (o la selección) sobre el estado actual
async function accionSentencia() {
  if (!esSQL(estado.activo)) return;
  await conBloqueo(async () => {
    mostrarPanel('salida');
    const doc = editor.getDoc();
    let texto;
    let desplazamiento = 0;
    if (doc.somethingSelected()) {
      texto = doc.getSelection();
      desplazamiento = doc.getCursor('from').line;
    } else {
      const todo = doc.getValue();
      const pos = doc.indexFromPos(doc.getCursor());
      const sentencias = MotorMySQL.lexico.dividir(todo);
      let elegida = sentencias.find((s) => pos >= s.desde && pos <= s.hasta + 1);
      if (!elegida) elegida = sentencias.filter((s) => s.desde <= pos).pop() || sentencias[0];
      if (!elegida) { setEstado('No hay ninguna sentencia en el cursor.'); return; }
      texto = elegida.texto;
      desplazamiento = elegida.linea - 1;
    }
    const resultados = srv.ejecutarScript(texto, { seguir: estado.continuar });
    limpiarMarcas();
    resultados.forEach((r) => anotarSalida(r, desplazamiento));
    marcarResultados(resultados, desplazamiento);
    const filas = resultados.filter((r) => r.ok && r.tipo === 'filas');
    if (filas.length) mostrarResultados(filas);
    pintarNavegador();
    const error = resultados.find((r) => !r.ok && !r.omitida);
    setEstado(error ? 'La sentencia falló: ' + mensajeWorkbench(error) : 'Sentencia ejecutada sobre el estado actual del servidor.');
  });
}

function marcarResultados(resultados, desplazamiento) {
  resultados.forEach((r) => {
    if (r.omitida) return;
    const linea = r.sentencia.linea + desplazamiento;
    if (!r.ok) marcarLinea(linea, r.noDisponible ? 'marca-aviso' : 'marca-error', mensajeWorkbench(r));
    else marcarLinea(linea, r.avisos ? 'marca-aviso' : 'marca-ok', mensajeWorkbench(r));
  });
}

async function accionReiniciar() {
  await conBloqueo(async () => {
    reiniciarServidor();
    limpiarMarcas();
    $('lista-salida').innerHTML = '';
    estado.numeroSalida = 0;
    mostrarResultados([]);
    pintarNavegador();
    setEstado('Servidor reiniciado: vuelve al estado inicial de la práctica.');
  });
}

// ---------- comprobaciones ----------

async function especificacion(carpeta) {
  const ej = ejercicioDe(carpeta);
  if (!estado.comprobaciones[carpeta]) {
    const r = await fetch('practicas/' + ID_PRACTICA + '/' + carpeta + '/' + ej.comprobaciones, { cache: 'no-cache' });
    if (!r.ok) throw new Error('no se pueden leer las comprobaciones (' + r.status + ')');
    estado.comprobaciones[carpeta] = { spec: await r.json(), resultados: null, errores: 0 };
  }
  return estado.comprobaciones[carpeta];
}

function pintarComprobaciones() {
  const carpeta = carpetaDe(estado.activo);
  const ej = carpeta ? ejercicioDe(carpeta) : null;
  const lista = $('lista-comprobaciones');
  const nota = $('nota-comprobaciones');
  lista.innerHTML = '';
  $('contador-comprobaciones').textContent = '';
  if (!ej || !ej.comprobaciones) {
    nota.textContent = carpeta ? 'Este ejercicio no tiene comprobaciones automáticas.' : 'Abre el script de un ejercicio y pulsa Comprobar.';
    return;
  }
  const datos = estado.comprobaciones[carpeta];
  if (!datos || !datos.resultados) {
    nota.textContent = 'Pulsa Comprobar para revisar los requisitos de ' + carpeta + '.';
    return;
  }
  const bien = datos.resultados.filter((r) => r.ok).length;
  $('contador-comprobaciones').textContent = '(' + bien + '/' + datos.resultados.length + ')';
  nota.textContent = (datos.errores ? 'Tu script tiene ' + datos.errores + ' sentencia(s) con error: revisa la vista Output. ' : '')
    + 'Que se cumplan todas no garantiza la nota máxima: la corrección revisa más casos.';
  datos.resultados.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'cumple' : 'no-cumple';
    const texto = document.createElement('span');
    texto.className = 'texto-comprobacion';
    texto.textContent = r.texto;
    if (!r.ok && r.detalle) {
      const d = document.createElement('span');
      d.className = 'detalle-comprobacion';
      d.textContent = r.detalle;
      texto.appendChild(d);
    }
    const marca = document.createElement('span');
    marca.className = 'estado-comprobacion';
    marca.textContent = r.ok ? 'Cumple' : 'Pendiente';
    li.append(texto, marca);
    lista.appendChild(li);
  });
}

async function accionComprobar() {
  const carpeta = carpetaDe(estado.activo);
  const ej = carpeta ? ejercicioDe(carpeta) : null;
  if (!ej || !ej.comprobaciones) return;
  await conBloqueo(async () => {
    const datos = await especificacion(carpeta);
    mostrarPanel('comprobaciones');
    reiniciarServidor();
    // Como en la corrección: el script completo, aunque falle alguna sentencia
    const script = editor.getValue();
    const resultados = srv.ejecutarScript(script, { seguir: true });
    datos.errores = resultados.filter((r) => !r.ok).length;
    datos.resultados = srv.comprobar(datos.spec, { script });
    pintarNavegador();
    estado.metricas.comprobaciones++;
    const bien = datos.resultados.filter((r) => r.ok).length;
    estado.metricas.ultimaComprobacion = carpeta + ' ' + bien + '/' + datos.resultados.length;
    pintarComprobaciones();
    setEstado(carpeta + ': se cumplen ' + bien + ' de ' + datos.resultados.length + ' comprobaciones.');
  });
}

// ---------- entrega ----------

// Incrustado en otro sitio (Moodle), navigator.clipboard puede no responder:
// se recurre a execCommand si no termina en un segundo y medio
async function copiarTexto(texto) {
  const respaldo = () => {
    const area = document.createElement('textarea');
    area.value = texto;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  };
  try {
    await Promise.race([
      navigator.clipboard.writeText(texto),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('sin respuesta')), 1500)),
    ]);
  } catch (e) {
    respaldo();
  }
}

const MARCA_ARCHIVO = '-- ===== Archivo: ';
const MARCA_INFORME = '-- Informe del entorno (no borrar):';

function informeEntorno() {
  const m = estado.metricas;
  return [
    VERSION_ENTORNO,
    'fecha=' + new Date().toISOString(),
    'navegador=' + navigator.userAgent,
    'nucleos=' + (navigator.hardwareConcurrency || '?'),
    'carga_s=' + (m.carga === null ? '?' : m.carga.toFixed(1)),
    'ejecuciones=' + m.ejecuciones,
    'ejecuciones_con_error=' + m.conErrores,
    'ultima_ejecucion=' + m.ultimaEjecucion,
    'comprobaciones=' + m.comprobaciones,
    'ultima_comprobacion=' + m.ultimaComprobacion,
  ].join('\n') + '\n';
}

function textoEntrega(carpeta) {
  const editables = Object.keys(ARCHIVOS).filter((n) => carpetaDe(n) === carpeta && !ARCHIVOS[n].soloLectura);
  const codigo = editables.map((n) => MARCA_ARCHIVO + n + ' =====\n' + estado.docs[n].getValue().replace(/\s*$/, '\n')).join('\n');
  const informe = informeEntorno().trim().split('\n').slice(1).join(' | ');
  return codigo + '\n' + MARCA_INFORME + ' ' + informe + '\n';
}

async function copiarCodigo() {
  const carpeta = carpetaDe(estado.activo);
  if (!carpeta) return;
  await copiarTexto(textoEntrega(carpeta));
  setEstado('Código de ' + carpeta + ' copiado. Pégalo en su pregunta del cuestionario.');
}

function restaurarPlantilla() {
  if (!ARCHIVOS[estado.activo] || ARCHIVOS[estado.activo].soloLectura) return;
  if (!confirm('Se perderán los cambios de ' + estado.activo + '. ¿Continuar?')) return;
  editor.setValue(estado.plantillas[estado.activo]);
}

// ---------- diagnóstico ----------

function registrar(id, texto, valor) {
  estado.diag[id] = { texto, valor };
  pintarDiagnostico();
}

function pintarDiagnostico() {
  const cuerpo = $('lista-diag');
  cuerpo.innerHTML = '';
  const etiquetas = { ok: 'Correcto', aviso: 'Revisar', fallo: 'Fallo', pendiente: 'Pendiente' };
  PRUEBAS.forEach(([id, nombre]) => {
    const r = estado.diag[id] || { texto: '', valor: 'pendiente' };
    const fila = document.createElement('tr');
    [nombre, r.texto, etiquetas[r.valor]].forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (i === 2) td.className = 'val-' + r.valor;
      fila.appendChild(td);
    });
    cuerpo.appendChild(fila);
  });
}

// Script de prueba con los errores esperados en cada sentencia (0 = correcta)
const DIAG_ERRORES = [
  ['CREATE DATABASE diag', 0],
  ['USE diag', 0],
  ['CREATE TABLE p (id INT PRIMARY KEY, nombre VARCHAR(5) NOT NULL, precio DECIMAL(6,2) CHECK (precio > 0))', 0],
  ["INSERT INTO p VALUES (1, 'uno', 10)", 0],
  ["INSERT INTO p VALUES (1, 'dos', 10)", 1062],
  ["INSERT INTO p VALUES (2, 'largo!', 10)", 1406],
  ["INSERT INTO p VALUES (3, 'tres', -1)", 3819],
  ['INSERT INTO p (id) VALUES (4)', 1364],
  ['CREATE TABLE order (id INT)', 1064],
  ['SELECT * FROM no_existe', 1146],
];

async function accionDiagnostico() {
  await conBloqueo(async () => {
    mostrarPanel('diagnostico');
    const s = new MotorMySQL.Servidor(SQL);
    const v = s.db.exec('SELECT sqlite_version()')[0].values[0][0];
    registrar('entorno', 'SQLite ' + v + ', MySQL ' + MotorMySQL.VERSION + ' emulado, ' + (navigator.hardwareConcurrency || '?') + ' núcleos', 'ok');
    const codigos = DIAG_ERRORES.map(([sql]) => { const r = s.ejecutar(sql); return r.ok ? 0 : r.error.codigo; });
    const malos = DIAG_ERRORES.filter(([, c], i) => c !== codigos[i]).length;
    registrar('errores', malos ? malos + ' sentencias con otro resultado: ' + codigos.join(', ') : DIAG_ERRORES.length + ' sentencias con el resultado esperado', malos ? 'fallo' : 'ok');
    const integridad = s.ejecutarScript([
      'CREATE TABLE h (id INT PRIMARY KEY, p INT, FOREIGN KEY (p) REFERENCES p (id) ON DELETE CASCADE)',
      'INSERT INTO h VALUES (1, 1)', 'INSERT INTO h VALUES (2, 9)', 'DELETE FROM p WHERE id = 1', 'SELECT COUNT(*) FROM h',
    ].join(';\n'), { seguir: true });
    const okIntegridad = integridad[2].error && integridad[2].error.codigo === 1452 && integridad[4].filas[0][0] === '0';
    registrar('integridad', okIntegridad ? 'error 1452 y borrado en cascada' : 'resultado inesperado', okIntegridad ? 'ok' : 'fallo');
    const dic = s.ejecutarScript("SHOW CREATE TABLE p; SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'diag'", { seguir: true });
    const okDic = dic[0].ok && /CONSTRAINT `p_chk_1` CHECK/.test(dic[0].filas[0][1]) && dic[1].ok && dic[1].filas[0][0] === '4';
    registrar('diccionario', okDic ? 'nombres de restricciones y diccionario correctos' : 'resultado inesperado', okDic ? 'ok' : 'fallo');
    const filas = [];
    for (let i = 1; i <= 2000; i++) filas.push('(' + i + ", 'n" + (i % 100) + "', " + (i % 50 + 1) + ')');
    s.ejecutar('CREATE TABLE r (id INT PRIMARY KEY, nombre VARCHAR(10), precio DECIMAL(6,2))');
    const t0 = performance.now();
    const ins = s.ejecutar('INSERT INTO r VALUES ' + filas.join(', '));
    const ms = performance.now() - t0;
    registrar('rendimiento', ins.ok ? Math.round(ms) + ' ms' : ins.error.mensaje, !ins.ok ? 'fallo' : ms < 1500 ? 'ok' : 'aviso');
    const t1 = performance.now();
    const foto = s.instantanea();
    s.ejecutar('DROP DATABASE diag');
    s.restaurar(foto);
    const vuelve = s.ejecutar('SELECT COUNT(*) FROM diag.r');
    const okRest = vuelve.ok && vuelve.filas[0][0] === '2000';
    registrar('restaurar', okRest ? Math.round(performance.now() - t1) + ' ms' : 'no se recuperó el estado', okRest ? 'ok' : 'fallo');
    s.db.close();
    setEstado('Diagnóstico terminado.');
  });
}

function textoInforme() {
  const lineas = [VERSION_INFORME, 'navegador=' + navigator.userAgent];
  PRUEBAS.forEach(([id]) => {
    const r = estado.diag[id];
    lineas.push(id + '=' + (r ? r.valor + ' | ' + r.texto : 'pendiente'));
  });
  return lineas.join('\n');
}

// ---------- arranque ----------

function enlazarUI() {
  document.querySelectorAll('.pestana-salida').forEach((p) => p.addEventListener('click', () => mostrarPanel(p.dataset.panel)));
  $('btn-ejecutar').addEventListener('click', accionEjecutar);
  $('btn-sentencia').addEventListener('click', accionSentencia);
  $('btn-comprobar').addEventListener('click', accionComprobar);
  $('btn-copiar-codigo').addEventListener('click', copiarCodigo);
  $('btn-plantilla').addEventListener('click', restaurarPlantilla);
  $('btn-reiniciar').addEventListener('click', accionReiniciar);
  $('btn-diagnostico').addEventListener('click', accionDiagnostico);
  $('btn-copiar-informe').addEventListener('click', async () => { await copiarTexto(textoInforme()); setEstado('Informe copiado.'); });
  $('btn-refrescar').addEventListener('click', pintarNavegador);
  $('filtro').addEventListener('input', pintarNavegador);
  estado.continuar = leerAlmacen('continuar') === '1';
  $('btn-continuar').setAttribute('aria-pressed', String(estado.continuar));
  $('btn-continuar').addEventListener('click', () => {
    estado.continuar = !estado.continuar;
    $('btn-continuar').setAttribute('aria-pressed', String(estado.continuar));
    escribirAlmacen('continuar', estado.continuar ? '1' : '0');
    setEstado(estado.continuar ? 'El script seguirá aunque falle una sentencia.' : 'El script se detendrá en la primera sentencia con error.');
  });
  if (window.self !== window.top && document.fullscreenEnabled) {
    $('btn-pantalla-completa').hidden = false;
    $('btn-pantalla-completa').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => setEstado('El navegador no permite la pantalla completa.'));
    });
    document.addEventListener('fullscreenchange', () => {
      $('btn-pantalla-completa').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
    });
  }
  // Separador entre el editor y los resultados
  const separador = $('separador');
  separador.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const centro = document.querySelector('.centro');
    const zona = document.querySelector('.zona-editor');
    const mover = (e) => {
      const r = centro.getBoundingClientRect();
      const alto = Math.min(Math.max(e.clientY - r.top, 120), r.height - 160);
      zona.style.flex = '0 0 ' + alto + 'px';
      if (editor) editor.refresh();
    };
    const soltar = () => { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); };
    document.addEventListener('mousemove', mover);
    document.addEventListener('mouseup', soltar);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); setEstado('Guardado automático activo.'); }
  });
}

function avisar(texto) {
  setEstado(texto);
  $('contenedor-editor').innerHTML = '<p class="aviso-practica"></p>';
  document.querySelector('.aviso-practica').textContent = texto;
}

async function iniciar() {
  document.body.classList.toggle('modo-profesor', MODO_PROFESOR);
  enlazarUI();
  pintarDiagnostico();
  if (ID_PRACTICA) {
    try {
      await cargarPractica();
      await cargarFuentes();
    } catch (e) {
      avisar(e.noPublicada
        ? 'Esta práctica todavía no está disponible. Espera a que el profesor la abra y recarga la página.'
        : 'No se pudo cargar la práctica (' + e.message + '). Recarga la página y, si sigue igual, avisa al profesor.');
      return;
    }
  } else if (MODO_PROFESOR) {
    ARCHIVOS['diagnostico/prueba.sql'] = { soloLectura: false, modo: 'sql' };
    estado.plantillas['diagnostico/prueba.sql'] = '-- Script libre para probar el laboratorio\nCREATE DATABASE prueba;\nUSE prueba;\n';
    estado.activo = 'diagnostico/prueba.sql';
  } else {
    avisar('Abre la práctica desde su cuestionario del Aula Virtual.');
    return;
  }
  crearEditor();
  try {
    const segundos = await arrancarServidor();
    estado.metricas.carga = (performance.now() - estado.inicioPagina) / 1000;
    registrar('carga', estado.metricas.carga.toFixed(1) + ' s (servidor ' + segundos.toFixed(1) + ' s)', estado.metricas.carga < 10 ? 'ok' : 'aviso');
  } catch (e) {
    setEstado('No se pudo iniciar el servidor: ' + e.message);
    registrar('carga', 'error: ' + e.message, 'fallo');
    return;
  }
  estado.listo = true;
  pintarNavegador();
  actualizarBotones();
  setEstado('Servidor listo (MySQL ' + MotorMySQL.VERSION + ' emulado en el navegador). Ejecutar lanza el script completo desde un servidor limpio.');
}

iniciar();
