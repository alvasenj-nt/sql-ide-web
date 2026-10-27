'use strict';
// Compara el emulador con lo que respondió MySQL real (pruebas/esperado/,
// generado con grabar_mysql.js), sentencia a sentencia: si funciona o falla,
// el código de error y las filas devueltas.
//
// Uso: node pruebas/diferencial.js [--detalle] [archivo.sql ...]
// Sale con código 1 si hay discrepancias. Las sentencias que el laboratorio
// no implementa se cuentan aparte. Una sentencia que contiene /*ignorar*/
// solo compara si funciona o falla; la columna Cardinality de SHOW INDEX no
// se compara (es una estimación del servidor).
const fs = require('fs');
const path = require('path');
const { cargarMotor } = require('./cargar_motor');

const CORPUS = path.join(__dirname, 'corpus');
const ESPERADO = path.join(__dirname, 'esperado');

function compararFilas(esperado, obtenido) {
  if (JSON.stringify(esperado.columnas) !== JSON.stringify(obtenido.columnas)) {
    return 'columnas ' + JSON.stringify(obtenido.columnas) + ' en lugar de ' + JSON.stringify(esperado.columnas);
  }
  const ignorar = esperado.columnas.indexOf('Cardinality');
  const limpiar = (f) => f.map((v, i) => (i === ignorar ? '*' : v));
  const a = esperado.filas.map((f) => JSON.stringify(limpiar(f)));
  const b = obtenido.filas.map((f) => JSON.stringify(limpiar(f)));
  if (a.length !== b.length) return b.length + ' filas en lugar de ' + a.length + '\n      esperado: ' + a.join('\n                ') + '\n      obtenido: ' + b.join('\n                ');
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return 'fila ' + (i + 1) + '\n      esperado: ' + a[i] + '\n      obtenido: ' + b[i];
  }
  return null;
}

function comparar(esperado, r) {
  if (r.noDisponible) return { tipo: 'nodisponible' };
  if (r.interno) return { tipo: 'discrepancia', motivo: r.error.mensaje };
  if (esperado.ok !== r.ok) {
    return { tipo: 'discrepancia', motivo: esperado.ok ? 'MySQL la acepta y el emulador da ' + (r.error.codigo || '') + ': ' + r.error.mensaje
      : 'MySQL da ' + esperado.codigo + ' (' + esperado.mensaje + ') y el emulador la acepta' };
  }
  if (!r.ok) {
    if (esperado.codigo !== r.error.codigo) return { tipo: 'discrepancia', motivo: 'error ' + r.error.codigo + ' en lugar de ' + esperado.codigo + ' (' + esperado.mensaje + ')' };
    if (esperado.codigo !== 1064 && esperado.mensaje !== r.error.mensaje) {
      return { tipo: 'mensaje', motivo: 'mismo código, otro mensaje\n      esperado: ' + esperado.mensaje + '\n      obtenido: ' + r.error.mensaje };
    }
    return { tipo: 'igual' };
  }
  if (esperado.texto.includes('/*ignorar*/')) return { tipo: 'igual' };
  if (esperado.tipo === 'filas') {
    if (r.tipo !== 'filas') return { tipo: 'discrepancia', motivo: 'MySQL devuelve filas y el emulador no' };
    const motivo = compararFilas(esperado, r);
    return motivo ? { tipo: 'discrepancia', motivo } : { tipo: 'igual' };
  }
  if (r.tipo === 'filas') return { tipo: 'discrepancia', motivo: 'el emulador devuelve filas y MySQL no' };
  if (esperado.afectadas !== r.afectadas) return { tipo: 'discrepancia', motivo: r.afectadas + ' filas afectadas en lugar de ' + esperado.afectadas };
  if (esperado.avisos !== r.avisos) return { tipo: 'discrepancia', motivo: r.avisos + ' avisos en lugar de ' + esperado.avisos };
  return { tipo: 'igual' };
}

async function main() {
  const args = process.argv.slice(2);
  const detalle = args.includes('--detalle');
  const { M, SQL } = await cargarMotor();
  const archivos = args.filter((a) => !a.startsWith('--')).map((a) => path.basename(a));
  const lista = archivos.length ? archivos : fs.readdirSync(CORPUS).filter((a) => a.endsWith('.sql')).sort();
  const total = { igual: 0, mensaje: 0, discrepancia: 0, nodisponible: 0 };
  for (const archivo of lista) {
    const ruta = path.join(ESPERADO, archivo.replace(/\.sql$/, '.json'));
    if (!fs.existsSync(ruta)) { console.log(archivo + ': sin grabación de MySQL (grabar_mysql.js)'); continue; }
    const esperados = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const srv = new M.Servidor(SQL);
    const cuenta = { igual: 0, mensaje: 0, discrepancia: 0, nodisponible: 0 };
    const lineas = [];
    esperados.forEach((esp) => {
      const r = srv.ejecutar({ texto: esp.texto, linea: esp.linea });
      const c = comparar(esp, r);
      cuenta[c.tipo]++;
      if (c.tipo === 'discrepancia' || (detalle && c.tipo !== 'igual')) {
        lineas.push('  línea ' + esp.linea + ' [' + c.tipo + '] ' + esp.texto.split('\n')[0].slice(0, 90) + (c.motivo ? '\n      ' + c.motivo : ''));
      }
    });
    Object.keys(total).forEach((k) => { total[k] += cuenta[k]; });
    console.log(archivo + ': ' + cuenta.igual + ' iguales, ' + cuenta.mensaje + ' con otro mensaje, ' + cuenta.discrepancia
      + ' discrepancias, ' + cuenta.nodisponible + ' no disponibles');
    lineas.forEach((l) => console.log(l));
  }
  console.log('\nTotal: ' + total.igual + ' iguales, ' + total.mensaje + ' con otro mensaje, ' + total.discrepancia
    + ' discrepancias, ' + total.nodisponible + ' no disponibles');
  process.exit(total.discrepancia ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
