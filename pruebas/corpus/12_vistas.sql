-- Vistas: creación, consulta, texto canónico, actualizables, WITH CHECK OPTION y errores
CREATE DATABASE club;
USE club;
CREATE TABLE sede (codigo TINYINT UNSIGNED PRIMARY KEY, nombre VARCHAR(40) NOT NULL);
CREATE TABLE socio (
  dni CHAR(9) PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL,
  ciudad VARCHAR(40),
  cuota DECIMAL(6,2) NOT NULL DEFAULT 20.00,
  alta DATE,
  sede TINYINT UNSIGNED,
  CONSTRAINT fk_socio_sede FOREIGN KEY (sede) REFERENCES sede (codigo)
);
INSERT INTO sede VALUES (1, 'Centro'), (2, 'Norte');
INSERT INTO socio VALUES ('11111111A', 'Ana Gil', 'Madrid', 30.00, '2024-01-10', 1), ('22222222B', 'Luis Mora', 'Getafe', 15.00, '2023-05-02', 2),
  ('33333333C', 'Eva Ruiz', 'Madrid', 12.50, NULL, NULL);
-- Crear y consultar
CREATE VIEW socios_madrid AS SELECT dni, nombre, cuota FROM socio WHERE ciudad = 'Madrid';
SELECT * FROM socios_madrid ORDER BY dni;
SELECT nombre FROM socios_madrid WHERE cuota > 20;
SELECT COUNT(*), SUM(cuota) FROM socios_madrid;
SHOW CREATE VIEW socios_madrid;
SHOW CREATE TABLE socios_madrid;
DESCRIBE socios_madrid;
SHOW TABLES;
SHOW FULL TABLES;
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'club' ORDER BY TABLE_NAME;
SELECT TABLE_NAME, VIEW_DEFINITION, CHECK_OPTION, IS_UPDATABLE, DEFINER, SECURITY_TYPE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'club' ORDER BY TABLE_NAME;
SELECT COLUMN_NAME, ORDINAL_POSITION, IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'club' AND TABLE_NAME = 'socios_madrid' ORDER BY ORDINAL_POSITION;
-- Nombres de columna, alias, expresiones y uniones
CREATE VIEW resumen (ciudad, socios, total) AS SELECT ciudad, COUNT(*), SUM(cuota) FROM socio GROUP BY ciudad;
SELECT * FROM resumen ORDER BY ciudad;
SHOW CREATE VIEW resumen;
CREATE VIEW socio_sede AS SELECT s.dni, s.nombre AS socio, d.nombre AS sede FROM socio s JOIN sede d ON d.codigo = s.sede;
SELECT * FROM socio_sede ORDER BY dni;
SHOW CREATE VIEW socio_sede;
CREATE VIEW cuota_anual AS SELECT dni, cuota * 12 AS anual, UPPER(nombre) AS mayusculas, 'fija' AS tipo FROM socio;
SHOW CREATE VIEW cuota_anual;
SELECT * FROM cuota_anual ORDER BY dni;
CREATE VIEW madrid_ordenado AS SELECT DISTINCT ciudad FROM socio WHERE ciudad IS NOT NULL ORDER BY ciudad DESC LIMIT 5;
SHOW CREATE VIEW madrid_ordenado;
CREATE VIEW con_alias AS SELECT dni AS id, nombre FROM socio WHERE cuota BETWEEN 10 AND 20 AND ciudad IN ('Madrid', 'Getafe') OR alta IS NULL;
SHOW CREATE VIEW con_alias;
-- Errores al crear
CREATE VIEW socios_madrid AS SELECT dni FROM socio;
CREATE VIEW socio AS SELECT 1;
CREATE TABLE socios_madrid (a INT);
CREATE VIEW malo1 AS SELECT dni, nombre AS dni FROM socio;
CREATE VIEW malo2 (a, b) AS SELECT dni FROM socio;
CREATE VIEW malo3 AS SELECT x FROM socio;
CREATE VIEW malo4 AS SELECT * FROM no_existe;
CREATE VIEW malo5 AS SELECT * FROM socio s JOIN sede d ON d.codigo = s.sede;
-- El * se congela al crear la vista
CREATE VIEW todo AS SELECT * FROM socio;
ALTER TABLE socio ADD COLUMN telefono VARCHAR(15);
SELECT * FROM todo ORDER BY dni;
SHOW CREATE VIEW todo;
ALTER TABLE socio DROP COLUMN alta;
SELECT * FROM todo;
SELECT dni FROM todo ORDER BY dni;
ALTER TABLE socio ADD COLUMN alta DATE;
SELECT COUNT(*) FROM todo;
-- Vistas actualizables
SELECT TABLE_NAME, IS_UPDATABLE FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'club' ORDER BY TABLE_NAME;
INSERT INTO socios_madrid VALUES ('44444444D', 'Raúl Ortiz', 25.00);
SELECT * FROM socios_madrid WHERE dni = '44444444D';
SELECT dni, nombre, ciudad, cuota FROM socio WHERE dni = '44444444D';
INSERT INTO socios_madrid (dni, nombre) VALUES ('45454545E', 'Pilar Sanz');
SELECT dni, cuota FROM socio WHERE dni = '45454545E';
UPDATE socios_madrid SET cuota = cuota + 1;
SELECT dni, cuota FROM socio ORDER BY dni;
UPDATE socios_madrid SET cuota = 99 WHERE dni = '22222222B';
DELETE FROM socios_madrid WHERE cuota < 15;
SELECT dni FROM socio ORDER BY dni;
CREATE VIEW solo_ciudad AS SELECT dni, ciudad FROM socio;
INSERT INTO solo_ciudad VALUES ('99999999R', 'Madrid');
UPDATE resumen SET total = 0;
INSERT INTO resumen VALUES ('Toledo', 1, 1);
DELETE FROM resumen;
UPDATE cuota_anual SET anual = 100;
UPDATE cuota_anual SET dni = 'X' WHERE dni = 'nadie';
INSERT INTO cuota_anual (dni) VALUES ('77777777G');
UPDATE socio_sede SET socio = 'Ana G.' WHERE dni = '11111111A';
SELECT nombre FROM socio WHERE dni = '11111111A';
UPDATE socio_sede SET socio = 'X', sede = 'Y';
DELETE FROM socio_sede WHERE dni = '11111111A';
INSERT INTO socio_sede (dni, socio) VALUES ('88888888H', 'Nuevo');
INSERT INTO socios_madrid VALUES ('11111111A', 'Repetido', 10);
INSERT INTO socios_madrid VALUES ('12121212K', 'Cuota mala', 'mucho');
-- WITH CHECK OPTION
CREATE OR REPLACE VIEW socios_madrid AS SELECT dni, nombre, ciudad, cuota FROM socio WHERE ciudad = 'Madrid' WITH CHECK OPTION;
SHOW CREATE VIEW socios_madrid;
INSERT INTO socios_madrid VALUES ('55555555K', 'Sara Gómez', 'Toledo', 25.00);
INSERT INTO socios_madrid VALUES ('56565656L', 'Sara Gómez', 'madrid', 25.00);
INSERT INTO socios_madrid (dni, nombre, cuota) VALUES ('57575757M', 'Sin ciudad', 25.00);
UPDATE socios_madrid SET ciudad = 'Toledo' WHERE dni = '11111111A';
UPDATE socios_madrid SET cuota = 50 WHERE dni = '11111111A';
CREATE VIEW socios_con_cuota AS SELECT * FROM socio WHERE cuota > 10;
CREATE VIEW madrid_cuota AS SELECT * FROM socios_con_cuota WHERE ciudad = 'Madrid' WITH LOCAL CHECK OPTION;
INSERT INTO madrid_cuota (dni, nombre, ciudad, cuota) VALUES ('66666666Q', 'Pablo Ruiz', 'Madrid', 5.00);
INSERT INTO madrid_cuota (dni, nombre, ciudad, cuota) VALUES ('67676767Q', 'Pablo Ruiz', 'Toledo', 50.00);
CREATE OR REPLACE VIEW madrid_cuota AS SELECT * FROM socios_con_cuota WHERE ciudad = 'Madrid' WITH CASCADED CHECK OPTION;
INSERT INTO madrid_cuota (dni, nombre, ciudad, cuota) VALUES ('77777777B', 'Lola Sanz', 'Madrid', 5.00);
INSERT INTO madrid_cuota (dni, nombre, ciudad, cuota) VALUES ('78787878B', 'Lola Sanz', 'Madrid', 50.00);
CREATE VIEW sobre_madrid AS SELECT * FROM socios_madrid WHERE cuota < 100;
INSERT INTO sobre_madrid (dni, nombre, ciudad, cuota) VALUES ('79797979C', 'Toni', 'Toledo', 50.00);
CREATE VIEW sobre_madrid_local AS SELECT * FROM socios_madrid WHERE cuota < 100 WITH LOCAL CHECK OPTION;
INSERT INTO sobre_madrid_local (dni, nombre, ciudad, cuota) VALUES ('80808080D', 'Toni', 'Toledo', 50.00);
CREATE VIEW resumen_check AS SELECT ciudad, COUNT(*) AS n FROM socio GROUP BY ciudad WITH CHECK OPTION;
SELECT TABLE_NAME, CHECK_OPTION, IS_UPDATABLE FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'club' ORDER BY TABLE_NAME;
-- ALTER VIEW, DROP VIEW y tablas borradas
ALTER VIEW socios_con_cuota AS SELECT dni, cuota FROM socio WHERE cuota > 15;
SELECT * FROM socios_con_cuota ORDER BY dni;
SELECT * FROM madrid_cuota;
ALTER VIEW no_existe AS SELECT 1;
DROP VIEW socio;
DROP TABLE socios_madrid;
DROP VIEW no_existe;
DROP VIEW IF EXISTS no_existe, socio_sede;
DROP VIEW todo, sobre_madrid_local, sobre_madrid;
SHOW TABLES;
CREATE TABLE temporal (a INT);
CREATE VIEW sobre_temporal AS SELECT a FROM temporal;
DROP TABLE temporal;
SELECT * FROM sobre_temporal;
SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'club' ORDER BY TABLE_NAME;
DROP DATABASE club;
