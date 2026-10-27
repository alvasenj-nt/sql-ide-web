-- INSERT, UPDATE, DELETE y consultas sencillas, con el formato de los resultados
CREATE DATABASE club;
USE club;
CREATE TABLE socio (
  dni CHAR(9) PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  ciudad VARCHAR(30),
  cuota DECIMAL(6,2) NOT NULL DEFAULT 20,
  alta DATE NOT NULL,
  puntos INT DEFAULT 0
);
INSERT INTO socio VALUES ('11111111A', 'Ana', 'Madrid', 20, '2025-01-10', 15);
INSERT INTO socio (dni, nombre, ciudad, alta) VALUES ('22222222B', 'Luis', 'Getafe', '2025-03-01'), ('33333333C', 'Eva', 'madrid', '2026-02-14');
INSERT INTO socio SET dni = '44444444D', nombre = 'Raúl', alta = '2026-05-05', puntos = NULL;
INSERT INTO socio (dni, nombre, ciudad, cuota, alta) VALUES ('55555555E', 'Sara', 'Toledo', DEFAULT, '2026-06-01');
INSERT INTO socio (dni, nombre) VALUES ('66666666F', 'Sin alta');
INSERT INTO socio (dni, nombre, alta) VALUES ('66666666F', NULL, '2026-01-01');
INSERT INTO socio (dni, nombre, alta) VALUES ('66666666F', 'Dos', '2026-01-01', 3);
INSERT INTO socio (dni, nombre, alta, nombre) VALUES ('66666666F', 'Dos', '2026-01-01', 'x');
INSERT INTO socio (dni, apellido) VALUES ('66666666F', 'x');
INSERT INTO socio VALUES ('77777777G', 'Lola', 'Madrid', 31.5, '2026-07-07', 2), ('77777777G', 'Lola', 'Madrid', 31.5, '2026-07-07', 2);
INSERT INTO noexiste VALUES (1);
SELECT * FROM socio ORDER BY dni;
SELECT nombre, cuota FROM socio WHERE ciudad = 'MADRID' ORDER BY nombre;
SELECT nombre FROM socio WHERE ciudad IS NULL;
SELECT nombre FROM socio WHERE ciudad IN ('getafe', 'toledo') ORDER BY nombre DESC;
SELECT nombre FROM socio WHERE nombre LIKE 'r%';
SELECT nombre FROM socio WHERE nombre = 'raul';
SELECT nombre FROM socio WHERE alta BETWEEN '2026-01-01' AND '2026-12-31' ORDER BY alta LIMIT 2;
SELECT nombre FROM socio ORDER BY alta DESC LIMIT 1, 2;
SELECT DISTINCT ciudad FROM socio ORDER BY ciudad;
SELECT nombre AS socio, cuota * 12 AS anual, cuota / 3, cuota + 0.5, puntos * 2, puntos / 4, 10 DIV 3, 10 % 3 FROM socio WHERE dni = '11111111A';
SELECT 1 + 1, 7 / 2, 2.50 * 3, 1.5 + 1, 10 / 4, -3 / 2, 5 DIV 2, 0.1 + 0.2;
SELECT COUNT(*), COUNT(ciudad), SUM(cuota), AVG(cuota), MIN(alta), MAX(cuota), AVG(puntos), SUM(puntos) FROM socio;
SELECT ciudad, COUNT(*) AS n, SUM(cuota) FROM socio GROUP BY ciudad HAVING COUNT(*) >= 1 ORDER BY n DESC, ciudad;
SELECT UPPER(nombre), LOWER(ciudad), LENGTH(nombre), CHAR_LENGTH(nombre), CONCAT(nombre, ' (', ciudad, ')'), SUBSTRING(nombre, 2, 2), LEFT(nombre, 1), RIGHT(dni, 1) FROM socio WHERE dni = '44444444D';
SELECT CONCAT(nombre, ' - ', IFNULL(ciudad, 'sin ciudad')), COALESCE(ciudad, 'n/d'), IF(cuota > 20, 'alta', 'normal') FROM socio ORDER BY dni;
SELECT YEAR(alta), MONTH(alta), DAY(alta), DATEDIFF('2026-12-31', alta), DATE_FORMAT(alta, '%d/%m/%Y') FROM socio WHERE dni = '33333333C';
SELECT ROUND(2.5), ROUND(-2.5), ROUND(1.2345, 2), TRUNCATE(1.789, 1), ABS(-4), CEIL(1.2), FLOOR(-1.2), MOD(10, 4), GREATEST(1, 5, 3), LEAST('b', 'a');
SELECT 'abc' = 'ABC', 'a' < 'B', NULL = NULL, NULL <=> NULL, 1 = 1.0, 'ñ' = 'n', 'José' LIKE 'jose';
SELECT nombre FROM socio WHERE puntos IS NOT NULL AND (cuota > 20 OR ciudad = 'Getafe') ORDER BY nombre;
SELECT nombre FROM socio WHERE NOT (ciudad = 'Madrid') ORDER BY nombre;
SELECT nombre, CASE WHEN puntos IS NULL THEN 'sin datos' WHEN puntos > 10 THEN 'muchos' ELSE 'pocos' END AS nivel FROM socio ORDER BY dni;
SELECT s.nombre FROM socio AS s WHERE s.cuota = (SELECT MAX(cuota) FROM socio);
SELECT nombre FROM socio WHERE dni IN (SELECT dni FROM socio WHERE ciudad = 'Madrid') ORDER BY nombre;
SELECT nombre FROM socio ORDER BY 1 LIMIT 3;
SELECT socio.nombre FROM socio WHERE socio.dni = '11111111A';
SELECT club.socio.nombre FROM club.socio WHERE dni = '11111111A';
SELECT nombre FROM socio WHERE apellido = 'x';
SELECT x.nombre FROM socio AS s;
SELECT nombre, COUNT(*) FROM socio;
SELECT * FROM socio WHERE COUNT(*) > 1;
UPDATE socio SET cuota = cuota * 1.1 WHERE ciudad = 'Madrid';
SELECT dni, cuota FROM socio ORDER BY dni;
UPDATE socio SET cuota = 22 WHERE dni = '11111111A';
UPDATE socio SET ciudad = 'Madrid' WHERE ciudad = 'Madrid';
UPDATE socio SET puntos = puntos + 1;
UPDATE socio SET nombre = NULL WHERE dni = '11111111A';
UPDATE socio SET cuota = 99999 WHERE dni = '11111111A';
UPDATE socio SET dni = '22222222B' WHERE dni = '11111111A';
UPDATE socio SET cuota = DEFAULT WHERE dni = '11111111A';
UPDATE socio SET puntos = 0 ORDER BY alta DESC LIMIT 2;
UPDATE socio SET apellido = 'x';
SELECT dni, cuota, puntos FROM socio ORDER BY dni;
DELETE FROM socio WHERE ciudad = 'Toledo';
DELETE FROM socio ORDER BY alta LIMIT 1;
DELETE FROM socio WHERE dni = 'nadie';
SELECT dni FROM socio ORDER BY dni;
SELECT COUNT(*) FROM socio WHERE cuota > 20;
DELETE FROM socio;
SELECT COUNT(*) FROM socio;
SELECT 'hola' AS saludo, 3 AS numero, NULL AS nada;
SELECT DATABASE();
USE noexiste;
