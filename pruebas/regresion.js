// Regresión del laboratorio: abre cada práctica publicada en Chrome sin
// interfaz y comprueba, para cada ejercicio, que el esqueleto se ejecuta sin
// errores internos del motor, que Comprobar devuelve un resultado por cada
// comprobación y que "Copiar código" genera la entrega con sus marcas de
// archivo y el informe del entorno. Comprueba además la raíz sin parámetro,
// el aviso de una práctica sin publicar, el diagnóstico completo
// (?diagnostico) y el laboratorio incrustado en una página de otro origen,
// como en Moodle.
//
// Uso: node pruebas/regresion.js [id...]   (por defecto, todas las prácticas)
// Requisitos: puppeteer-core y Google Chrome (variable CHROME si no está en
// la ruta habitual). Lo ejecuta GitHub Actions en cada push.
'use strict';
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PUERTO = 8768;
const PUERTO_EXTERNO = 8769;
const PREFIJO = '/sql-ide-web/';
const BASE = 'http://localhost:' + PUERTO + PREFIJO;
const CHROME = process.env.CHROME || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');

const practicas = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(RAIZ, 'practicas')).filter((d) => fs.existsSync(path.join(RAIZ, 'practicas', d, 'practica.json')));

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.sql': 'text/plain; charset=utf-8' };
function servidor() {
  return http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(PREFIJO) || url.includes('..')) { res.writeHead(404); return res.end(); }
    url = url.slice(PREFIJO.length - 1);
    if (url.endsWith('/')) url += 'index.html';
    const fichero = path.join(RAIZ, url);
    fs.stat(fichero, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(fichero)] || 'application/octet-stream' });
      fs.createReadStream(fichero).pipe(res);
    });
  }).listen(PUERTO);
}

function servidorExterno(id) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Cuestionario</title><iframe src="' + BASE + '?p=' + id
      + '" style="width:100%;height:85vh;min-height:720px" allowfullscreen></iframe><textarea id="respuesta"></textarea>');
  }).listen(PUERTO_EXTERNO);
}

const fallos = [];
const comprobar = (id, prueba, ok, detalle) => {
  console.log((ok ? '  ok    ' : '  FALLO ') + prueba + (detalle ? ' | ' + detalle : ''));
  if (!ok) fallos.push(id + ': ' + prueba + (detalle ? ' (' + detalle + ')' : ''));
};

const estado = (marco) => marco.$eval('#estado', (e) => e.textContent);
const esperarEstado = (marco, patron, ms = 30000) => marco.waitForFunction(
  (p) => new RegExp(p).test(document.getElementById('estado').textContent), { timeout: ms }, patron);

async function probarPractica(navegador, id) {
  console.log('Práctica ' + id);
  const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'practicas', id, 'practica.json'), 'utf8'));
  const pagina = await navegador.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  await pagina.goto(BASE + '?p=' + id, { waitUntil: 'networkidle0' });
  await esperarEstado(pagina, 'Servidor listo');
  comprobar(id, 'carga', true);
  for (const ej of manifiesto.ejercicios) {
    const script = ej.archivos.find((a) => a.editable && a.nombre.endsWith('.sql'));
    const clave = ej.carpeta + '/' + script.nombre;
    await pagina.evaluate((c) => document.querySelector('.pestana-editor[data-archivo="' + c + '"]').click(), clave);
    await pagina.click('#btn-ejecutar');
    await esperarEstado(pagina, 'Script ejecutado');
    const internos = await pagina.$$eval('#lista-salida td.mensaje', (tds) => tds.filter((t) => /Error interno/.test(t.textContent)).length);
    comprobar(id, ej.carpeta + ': el esqueleto se ejecuta sin errores internos', internos === 0, await estado(pagina));
    if (ej.comprobaciones) {
      const spec = JSON.parse(fs.readFileSync(path.join(RAIZ, 'practicas', id, ej.carpeta, ej.comprobaciones), 'utf8'));
      await pagina.click('#btn-comprobar');
      await esperarEstado(pagina, 'comprobaciones');
      const n = await pagina.$$eval('#lista-comprobaciones li', (l) => l.length);
      comprobar(id, ej.carpeta + ': Comprobar da un resultado por comprobación', n === spec.comprobaciones.length, n + ' de ' + spec.comprobaciones.length);
      const internosComp = await pagina.$$eval('.detalle-comprobacion', (l) => l.filter((d) => /interno|no admite/.test(d.textContent)).length);
      comprobar(id, ej.carpeta + ': las comprobaciones no usan nada que el laboratorio no admita', internosComp === 0);
    }
    const texto = await pagina.evaluate((c) => textoEntrega(c), ej.carpeta);
    comprobar(id, ej.carpeta + ': Copiar código lleva marca de archivo e informe',
      texto.startsWith('-- ===== Archivo: ' + clave + ' =====') && /\n-- Informe del entorno \(no borrar\): fecha=/.test(texto));
  }
  comprobar(id, 'sin errores de JavaScript', !errores.length, errores.join('; '));
  await pagina.close();
}

async function probarIncrustado(navegador, id) {
  const externo = servidorExterno(id);
  try {
    const pagina = await navegador.newPage();
    await pagina.goto('http://localhost:' + PUERTO_EXTERNO + '/', { waitUntil: 'networkidle0' });
    const marco = pagina.frames().find((f) => f.url().startsWith(BASE));
    await esperarEstado(marco, 'Servidor listo');
    const visible = await marco.$eval('#btn-pantalla-completa', (b) => !b.hidden);
    comprobar(id, 'incrustado: botón Pantalla completa visible', visible);
    await marco.evaluate(() => {
      const b = document.querySelector('.pestana-editor[data-archivo$=".sql"]');
      if (b) b.click();
    });
    await marco.click('#btn-ejecutar');
    await esperarEstado(marco, 'Script ejecutado');
    comprobar(id, 'incrustado: ejecuta el script', true);
    await pagina.close();
  } finally {
    externo.close();
  }
}

async function main() {
  const http1 = servidor();
  const navegador = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    console.log('Raíz y avisos');
    const p = await navegador.newPage();
    await p.goto(BASE, { waitUntil: 'networkidle0' });
    comprobar('raiz', 'sin práctica remite al cuestionario', /cuestionario/.test(await estado(p)));
    await p.goto(BASE + '?p=no-existe-abc123', { waitUntil: 'networkidle0' });
    await p.waitForFunction(() => /todavía no está disponible/.test(document.getElementById('estado').textContent), { timeout: 15000 });
    comprobar('raiz', 'práctica sin publicar avisa', true);
    console.log('Diagnóstico');
    await p.goto(BASE + '?diagnostico', { waitUntil: 'networkidle0' });
    await esperarEstado(p, 'Servidor listo');
    await p.click('#btn-diagnostico');
    await esperarEstado(p, 'Diagnóstico terminado', 60000);
    const filas = await p.$$eval('#lista-diag tr', (trs) => trs.map((tr) => [tr.cells[0].textContent, tr.cells[2].textContent]));
    filas.filter(([n]) => !/Tu proyecto/.test(n)).forEach(([n, v]) => comprobar('diagnostico', n, v === 'Correcto', v));
    await p.close();
    for (const id of practicas) await probarPractica(navegador, id);
    if (practicas.length) await probarIncrustado(navegador, practicas[0]);
  } finally {
    await navegador.close();
    http1.close();
  }
  console.log(fallos.length ? '\n' + fallos.length + ' fallos:\n' + fallos.join('\n') : '\nRegresión correcta.');
  process.exitCode = fallos.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
