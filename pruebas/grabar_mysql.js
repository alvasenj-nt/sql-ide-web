'use strict';
// Graba lo que responde un MySQL 8 real a cada sentencia del corpus, para
// compararlo después con el emulador (diferencial.js).
//
// Uso: node pruebas/grabar_mysql.js [archivo.sql ...]
//   Sin argumentos graba todo pruebas/corpus/. Necesita mysql2 en NODE_PATH
//   y un MySQL 8.0 en MYSQL_HOST:MYSQL_PORT (127.0.0.1:3399) con usuario
//   root y contraseña MYSQL_PWD (root_pass_2026). Antes de cada archivo
//   borra todas las bases de datos y cuentas que no son del sistema.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { cargarMotor } = require('./cargar_motor');

const CORPUS = path.join(__dirname, 'corpus');
const ESPERADO = path.join(__dirname, 'esperado');
const SISTEMA = ['information_schema', 'mysql', 'performance_schema', 'sys'];

async function limpiar(con) {
  await con.query('SET FOREIGN_KEY_CHECKS = 1');
  const [bases] = await con.query('SHOW DATABASES');
  for (const b of bases) {
    const n = Object.values(b)[0];
    if (!SISTEMA.includes(n)) await con.query('DROP DATABASE `' + n + '`');
  }
  // Cuentas y roles creados por los archivos anteriores
  const [cuentas] = await con.query("SELECT user, host FROM mysql.user WHERE user NOT IN ('root', 'mysql.infoschema', 'mysql.session', 'mysql.sys')");
  for (const c of cuentas) await con.query('DROP USER ?@?', [c.user, c.host]);
}

async function grabarArchivo(con, M, archivo) {
  const texto = fs.readFileSync(path.join(CORPUS, archivo), 'utf8');
  const sentencias = M.lexico.dividir(texto);
  await limpiar(con);
  await con.changeUser({ database: undefined }).catch(() => {});
  const resultados = [];
  for (const s of sentencias) {
    try {
      const [r, campos] = await con.query({ sql: s.texto, rowsAsArray: true, typeCast: (f) => f.string() });
      if (Array.isArray(r)) {
        resultados.push({ linea: s.linea, texto: s.texto, ok: true, tipo: 'filas', columnas: campos.map((c) => c.name),
          filas: r.map((f) => f.map((v) => (v === null ? null : String(v)))) });
      } else {
        resultados.push({ linea: s.linea, texto: s.texto, ok: true, tipo: 'cambio', afectadas: r.affectedRows,
          info: r.info || '', avisos: r.warningStatus || 0 });
      }
    } catch (e) {
      resultados.push({ linea: s.linea, texto: s.texto, ok: false, codigo: e.errno, mensaje: e.sqlMessage || e.message });
    }
  }
  fs.mkdirSync(ESPERADO, { recursive: true });
  fs.writeFileSync(path.join(ESPERADO, archivo.replace(/\.sql$/, '.json')), JSON.stringify(resultados, null, 1) + '\n');
  return resultados.length;
}

async function main() {
  const { M } = await cargarMotor();
  const con = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3399),
    user: 'root', password: process.env.MYSQL_PWD || 'root_pass_2026', charset: 'utf8mb4', timezone: 'Z',
    // Como el cliente mysql: filas cambiadas (no encontradas) y sin IGNORE_SPACE
    flags: ['-FOUND_ROWS', '-IGNORE_SPACE'],
  });
  const archivos = process.argv.slice(2).length ? process.argv.slice(2).map((a) => path.basename(a))
    : fs.readdirSync(CORPUS).filter((a) => a.endsWith('.sql')).sort();
  for (const a of archivos) {
    const n = await grabarArchivo(con, M, a);
    console.log(a + ': ' + n + ' sentencias grabadas');
  }
  await con.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
