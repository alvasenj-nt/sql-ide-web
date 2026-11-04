/* Recorrido guiado por el laboratorio e inspección de la base de datos club.
   Sigue los pasos de ejercicio1/enunciado.txt. */

-- Paso 2: consultas iniciales sobre el servidor y la base de datos club
SELECT VERSION(), CURRENT_USER();
SHOW ENGINES;

USE club;
SELECT * FROM sede;

-- Paso 3: descomenta las tres sentencias siguientes quitando los dos guiones
-- SHOW TABLES;
-- DESCRIBE socio;
-- SELECT * FROM actividad;

-- Paso 4: descomenta las consultas del diccionario de datos y la creación de la tabla
-- SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'club';
-- SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'club' AND TABLE_NAME = 'comentario_antiguo';
-- CREATE TABLE socio_revisado LIKE socio;


/* Respuestas: completa cada punto a partir de lo observado en el laboratorio.
   1. ¿Qué motor de almacenamiento (ENGINE) usan las tablas de club y a qué tabla apunta la clave ajena de monitor?

   2. ¿Qué juego de caracteres usa la columna texto de comentario_antiguo y qué problema tiene frente a utf8mb4?

   3. Al crear socio_revisado con CREATE TABLE ... LIKE socio, ¿cuántas filas contiene la nueva tabla?
*/

