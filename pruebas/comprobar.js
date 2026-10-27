'use strict';
// Ejecuta un script en el emulador y pasa una especificación de
// comprobaciones (el mismo formato que usa el laboratorio y la corrección).
//
// Uso: node pruebas/comprobar.js <especificacion.json> <script.sql> [inicial.sql] [--json]
// Escribe una línea por comprobación (OK o FALLO y el motivo) o, con --json,
// la lista de resultados. Sale con código 1 si alguna falla.
const fs = require('fs');
const { cargarMotor } = require('./cargar_motor');

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const [rutaSpec, rutaScript, rutaInicial] = args.filter((a) => !a.startsWith('--'));
  const { M, SQL } = await cargarMotor();
  const srv = new M.Servidor(SQL);
  if (rutaInicial) {
    const r = srv.ejecutarScript(fs.readFileSync(rutaInicial, 'utf8'), { seguir: false });
    const fallo = r.find((x) => !x.ok);
    if (fallo) throw new Error('el estado inicial falla en la línea ' + fallo.sentencia.linea + ': ' + fallo.error.mensaje);
    srv.bdActual = null;
  }
  const spec = JSON.parse(fs.readFileSync(rutaSpec, 'utf8'));
  const script = fs.readFileSync(rutaScript, 'utf8');
  const ejecucion = srv.ejecutarScript(script, { seguir: true });
  const errores = ejecucion.filter((r) => !r.ok);
  const resultados = srv.comprobar(spec, { script });
  if (json) {
    process.stdout.write(JSON.stringify({ errores: errores.map((e) => ({ linea: e.sentencia.linea, codigo: e.error.codigo, mensaje: e.error.mensaje })), resultados }, null, 1) + '\n');
  } else {
    errores.forEach((e) => console.log('ERROR en la línea ' + e.sentencia.linea + ': ' + (e.error.codigo || '') + ' ' + e.error.mensaje));
    resultados.forEach((r) => console.log((r.ok ? 'OK    ' : 'FALLO ') + r.id + (r.ok ? '' : ': ' + r.detalle)));
    console.log(resultados.filter((r) => r.ok).length + '/' + resultados.length + ' comprobaciones superadas, ' + errores.length + ' sentencias con error');
  }
  process.exitCode = resultados.every((r) => r.ok) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(2); });
