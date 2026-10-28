'use strict';
// Carga el motor del laboratorio en Node con sql.js, en el mismo orden que
// index.html. Requiere sql.js en NODE_PATH (npm install sql.js@1.15.2).
const path = require('path');

const ARCHIVOS = ['lexico', 'sintaxis', 'tipos', 'catalogo', 'traductor', 'funciones', 'servidor', 'alterar'];

async function cargarMotor() {
  ARCHIVOS.forEach((a) => require(path.join(__dirname, '..', 'js', 'motor', a + '.js')));
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  return { M: globalThis.MotorMySQL, SQL };
}

module.exports = { cargarMotor };
