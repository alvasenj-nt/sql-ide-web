# Laboratorio MySQL BD

Entorno de trabajo con aspecto de MySQL Workbench que funciona en el navegador, sin servidor, para prácticas y exámenes de Bases de datos (1º DAM, IES Pío Baroja).

- Imita un servidor MySQL 8.0 sobre SQLite ([sql.js](https://sql.js.org) 1.15.2, SQLite 3.54 compilado a WebAssembly, servido desde `lib/`). El motor (`js/motor/`) analiza el SQL de MySQL, mantiene su propio diccionario de datos (tipos, nombres de restricciones, motores, juegos de caracteres) y devuelve los resultados y los errores con los códigos y mensajes de MySQL.
- Lo que MySQL acepta y el motor no imita se avisa como "no disponible en el laboratorio", nunca como un error falso de MySQL.
- Ejecutar reinicia el servidor y ejecuta el script completo; Sentencia ejecuta la del cursor sobre el estado actual. El panel SCHEMAS muestra en todo momento las bases de datos, tablas, columnas, índices, claves ajenas y restricciones del servidor.
- Comprobaciones visibles opcionales por ejercicio: el mismo formato que usa la corrección, que se hace siempre en un MySQL 8.0 real.
- Entrega por cuestionario: "Copiar código" copia el script del ejercicio tras su marca `-- ===== Archivo: <carpeta>/<archivo> =====` y añade al final una línea `-- Informe del entorno (no borrar): ...` con métricas del entorno.
- Pensado para incrustarse en un cuestionario de Moodle con un `iframe` (`allowfullscreen` activa el botón "Pantalla completa").
- Abriendo la página con `?diagnostico` aparece un diagnóstico para el profesor: carga, errores de MySQL con su código, integridad referencial, diccionario de datos, rendimiento y reinicio del servidor.

## Fidelidad

`pruebas/corpus/` contiene scripts que cubren lo que imita el motor. `pruebas/grabar_mysql.js` graba lo que responde un MySQL 8.0 real a cada sentencia (`pruebas/esperado/`) y `pruebas/diferencial.js` compara el emulador con esa grabación: si funciona o falla, el código de error, el mensaje y las filas. GitHub Actions lo ejecuta en cada push.

Diferencias conocidas con MySQL:

- Las restricciones `UNIQUE` y las agrupaciones distinguen acentos (MySQL, con `utf8mb4_0900_ai_ci`, no los distingue); las comparaciones en `WHERE` sí siguen la colación.
- No implementa todavía `ALTER TABLE`, `TRUNCATE`, `RENAME`, índices con `CREATE INDEX`, vistas, cuentas, roles ni privilegios, transacciones explícitas, procedimientos ni disparadores.
- Una sola sesión: no hay bloqueos entre conexiones ni niveles de aislamiento.

## Prácticas

Cada práctica es una carpeta `practicas/<id>/` con un manifiesto `practica.json`, y se abre con `?p=<id>`. Sin parámetro no se carga ninguna.

```json
{
  "esquema": 1,
  "id": "bd-ut3-veterinaria-3vz13l",
  "version": 1,
  "titulo": "UT3 · Clínica veterinaria Huellas",
  "proyecto": "veterinaria",
  "readme": "README.txt",
  "inicial": "inicial.sql",
  "ejercicios": [
    { "carpeta": "ejercicio1", "comprobaciones": "comprobaciones.json",
      "archivos": [ { "nombre": "enunciado.txt", "editable": false },
                    { "nombre": "script.sql", "editable": true } ] }
  ]
}
```

| Campo | Uso |
|---|---|
| `esquema` | Versión del formato del manifiesto |
| `id` | Igual que el nombre de la carpeta: `bd-ut<n>-<tema>-<sufijo>` |
| `version` | Forma parte del prefijo del almacenamiento local (`<id>:v<version>:`) |
| `readme` | Texto de solo lectura abierto al entrar (opcional) |
| `inicial` | Script que prepara el estado del servidor antes del del alumno, por ejemplo bases de datos ya cargadas (opcional) |
| `ejercicios` | Una carpeta por ejercicio con sus archivos `.sql` o `.txt`, editables o de solo lectura, y opcionalmente sus comprobaciones visibles |

Las comprobaciones son `{ "esquema": 1, "comprobaciones": [ { "id", "texto", "pasos": [ { "sql", "espera" } ] } ] }`. `espera` es `"ok"`, `"error"`, `{ "error": [códigos] }`, `{ "valor": "..." }`, `{ "filas": [[...]], "orden": false }` o `{ "nfilas": n }`. Cada comprobación se ejecuta después del script, en una transacción que se deshace al terminar; `"repetirScript": true` vuelve a ejecutar el script y después sus pasos.

Una práctica usada con alumnado no se modifica: un cambio posterior se publica como práctica nueva. Cada publicación lleva la etiqueta Git `practica/<id>`.

## Publicación en GitHub Pages

Settings > Pages > Source: Deploy from a branch, rama `main`, carpeta `/ (root)`. Las rutas son relativas, así que funciona en cualquier subdirectorio.

## Estructura

| Ruta | Contenido |
|---|---|
| `index.html`, `css/`, `js/app.js` | Interfaz |
| `js/motor/` | Motor que imita MySQL: análisis léxico y sintáctico, tipos, diccionario de datos, traducción a SQLite, funciones y servidor |
| `lib/` | sql.js (SQLite en WebAssembly) |
| `practicas/<id>/` | Una práctica |
| `pruebas/` | Corpus y comparación con MySQL real, comprobaciones en Node (`comprobar.js`) y regresión en Chrome sin interfaz (`regresion.js`) |

## Licencias de terceros

| Componente | Origen | Licencia |
|---|---|---|
| sql.js 1.15.2 (`lib/`) | sql.js | MIT (`lib/LICENSE-sql.js.txt`) |
| SQLite 3.54 (dentro de sql.js) | SQLite | Dominio público |
| CodeMirror 5.65.16 (cargado desde cdnjs) | CodeMirror | MIT |
