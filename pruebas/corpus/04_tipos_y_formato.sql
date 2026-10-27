-- Tipos de datos, formato de SHOW CREATE TABLE y DESCRIBE, conversión de valores
CREATE DATABASE tienda;
USE tienda;
CREATE TABLE producto (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  referencia CHAR(8) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(8,2) NOT NULL DEFAULT 0,
  peso_g SMALLINT UNSIGNED,
  valoracion TINYINT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modificado TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  entrega DATE,
  hora TIME,
  anio YEAR,
  categoria ENUM('ropa','calzado','material') NOT NULL DEFAULT 'material',
  etiquetas SET('oferta','nuevo','eco'),
  foto MEDIUMBLOB,
  medida FLOAT,
  ratio DOUBLE,
  codigo BIGINT,
  pequeno MEDIUMINT,
  ceros INT(6) ZEROFILL,
  UNIQUE (referencia)
);
SHOW WARNINGS;
SHOW CREATE TABLE producto;
DESCRIBE producto;
SHOW FULL COLUMNS FROM producto;
INSERT INTO producto (referencia, nombre, precio, peso_g, valoracion, entrega, hora, anio, etiquetas, medida, ratio, codigo, pequeno, ceros)
  VALUES ('ZAP-0001', 'Zapatilla trail', 89.9, 320, 5, '2026-11-02', '09:30', 2026, 'nuevo,oferta', 3.14159265, 2.5, 9007199254740993, -8000000, 42);
SELECT id, referencia, precio, peso_g, valoracion, activo, entrega, hora, anio, categoria, etiquetas, medida, ratio, codigo, pequeno, ceros FROM producto;
INSERT INTO producto (referencia, nombre, precio) VALUES ('ZAP-0002', 'Calcetín', 4.999);
SHOW WARNINGS;
SELECT precio FROM producto WHERE referencia = 'ZAP-0002';
INSERT INTO producto (referencia, nombre, precio) VALUES ('ZAP-0003', 'Mochila', 1000000);
INSERT INTO producto (referencia, nombre, peso_g) VALUES ('ZAP-0003', 'Mochila', -1);
INSERT INTO producto (referencia, nombre, peso_g) VALUES ('ZAP-0003', 'Mochila', 70000);
INSERT INTO producto (referencia, nombre, valoracion) VALUES ('ZAP-0003', 'Mochila', 'cinco');
INSERT INTO producto (referencia, nombre, valoracion) VALUES ('ZAP-0003', 'Mochila', '5 estrellas');
INSERT INTO producto (referencia, nombre, valoracion) VALUES ('ZAP-0003', 'Mochila', '4');
INSERT INTO producto (referencia, nombre, precio) VALUES ('ZAP-0004', 'Gorra', 'gratis');
INSERT INTO producto (referencia, nombre) VALUES ('ZAP-0005-LARGA', 'Gorra');
INSERT INTO producto (referencia, nombre, entrega) VALUES ('ZAP-0005', 'Gorra', '2026-02-30');
INSERT INTO producto (referencia, nombre, entrega) VALUES ('ZAP-0005', 'Gorra', '30/11/2026');
INSERT INTO producto (referencia, nombre, entrega) VALUES ('ZAP-0005', 'Gorra', '2026/11/30');
INSERT INTO producto (referencia, nombre, entrega) VALUES ('ZAP-0006', 'Gorra', 20261201);
INSERT INTO producto (referencia, nombre, categoria) VALUES ('ZAP-0007', 'Gorra', 'joyeria');
INSERT INTO producto (referencia, nombre, categoria) VALUES ('ZAP-0007', 'Gorra', 'ROPA');
INSERT INTO producto (referencia, nombre, categoria) VALUES ('ZAP-0008', 'Gorra', 2);
INSERT INTO producto (referencia, nombre, etiquetas) VALUES ('ZAP-0009', 'Gorra', 'eco,barato');
INSERT INTO producto (referencia, nombre, anio) VALUES ('ZAP-0009', 'Gorra', 1800);
INSERT INTO producto (referencia, nombre, anio) VALUES ('ZAP-0009', 'Gorra', 26);
INSERT INTO producto (referencia, nombre, hora) VALUES ('ZAP-0010', 'Gorra', '25:61:00');
INSERT INTO producto (referencia, nombre, activo) VALUES ('ZAP-0011', 'Gorra', 7);
INSERT INTO producto (referencia, nombre) VALUES ('zap-0011 ', 'Gorra');
SELECT referencia, nombre, categoria, entrega, anio, activo FROM producto ORDER BY id;
SELECT CONCAT('[', referencia, ']') FROM producto WHERE nombre = 'gorra' ORDER BY id;
CREATE TABLE textos (c CHAR(3), v VARCHAR(3), t TINYTEXT, b VARBINARY(4));
INSERT INTO textos VALUES ('ab ', 'ab ', 'x', 'abcd');
INSERT INTO textos (v) VALUES ('abc   ');
SHOW WARNINGS;
INSERT INTO textos (v) VALUES ('abcd ');
INSERT INTO textos (b) VALUES ('abcde');
SELECT CONCAT('[', c, ']'), CONCAT('[', v, ']'), LENGTH(c), LENGTH(v) FROM textos;
CREATE TABLE numeros (d DECIMAL(5,2), d0 DECIMAL, f FLOAT(7,3), u DECIMAL(4,1) UNSIGNED);
SHOW WARNINGS;
SHOW CREATE TABLE numeros;
INSERT INTO numeros VALUES (123.456, 12345.6, 1.23456, 0);
SHOW WARNINGS;
INSERT INTO numeros VALUES (-999.995, 0, 0, 0);
INSERT INTO numeros VALUES (999.994, 0, 0, -1);
SELECT * FROM numeros;
CREATE TABLE errores1 (a VARCHAR);
CREATE TABLE errores2 (a CHAR(256));
CREATE TABLE errores3 (a VARCHAR(20000));
CREATE TABLE errores4 (a DECIMAL(70,2));
CREATE TABLE errores5 (a DECIMAL(5,6));
CREATE TABLE errores6 (a INT DEFAULT 'abc');
CREATE TABLE errores7 (a TINYINT DEFAULT 300);
CREATE TABLE errores8 (a ENUM('x','y') DEFAULT 'z');
CREATE TABLE errores9 (a INT NOT NULL DEFAULT NULL);
CREATE TABLE errores10 (a DATE DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE errores11 (a ENUM('si','SI'));
CREATE TABLE errores12 (a INT, A INT);
CREATE TABLE errores13 (a TEXT DEFAULT '');
CREATE TABLE errores14 (a VARCHAR(10) AUTO_INCREMENT PRIMARY KEY);
CREATE TABLE errores15 (a INT AUTO_INCREMENT PRIMARY KEY DEFAULT 1);
CREATE TABLE errores16 (a INT ON UPDATE CURRENT_TIMESTAMP);
CREATE TABLE errores17 ();
CREATE TABLE defectos (n INT DEFAULT -5, d DECIMAL(6,2) DEFAULT 3, s VARCHAR(10) DEFAULT 'it''s', f DATE DEFAULT '2026-01-01', b BOOL DEFAULT FALSE, e ENUM('a','b') DEFAULT 'B');
SHOW CREATE TABLE defectos;
DESCRIBE defectos;
INSERT INTO defectos () VALUES ();
SELECT * FROM defectos;
