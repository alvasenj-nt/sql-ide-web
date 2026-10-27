-- Claves primarias, únicas, CHECK, AUTO_INCREMENT y su reflejo en el diccionario
CREATE DATABASE academia;
USE academia;
CREATE TABLE persona (
  dni CHAR(9) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  email VARCHAR(120) UNIQUE,
  telefono VARCHAR(15),
  CONSTRAINT uq_persona_nombre_tel UNIQUE (nombre, telefono)
);
SHOW CREATE TABLE persona;
DESCRIBE persona;
SHOW INDEX FROM persona;
INSERT INTO persona VALUES ('11111111A', 'Ana Gil', 'ana@ies.es', '600000001');
INSERT INTO persona VALUES ('11111111A', 'Luis Mora', NULL, NULL);
INSERT INTO persona VALUES ('11111111a', 'Luis Mora', NULL, NULL);
INSERT INTO persona VALUES ('22222222B', 'Luis Mora', 'ANA@IES.ES', NULL);
INSERT INTO persona VALUES ('33333333C', 'Ana Gil', NULL, '600000001');
INSERT INTO persona VALUES ('44444444D', 'Eva Ruiz', NULL, NULL), ('55555555E', 'Eva Ruiz', NULL, NULL);
INSERT INTO persona (dni, nombre) VALUES (NULL, 'Sin DNI');
INSERT INTO persona (nombre) VALUES ('Sin DNI');
CREATE TABLE curso (
  codigo CHAR(6),
  nombre VARCHAR(80) NOT NULL,
  horas SMALLINT UNSIGNED NOT NULL DEFAULT 20 CHECK (horas BETWEEN 10 AND 2000),
  nivel VARCHAR(10) NOT NULL,
  inicio DATE,
  fin DATE,
  precio DECIMAL(7,2) CONSTRAINT chk_curso_precio CHECK (precio >= 0),
  PRIMARY KEY (codigo),
  CONSTRAINT chk_curso_nivel CHECK (nivel IN ('basico', 'medio', 'avanzado')),
  CHECK (fin >= inicio),
  CONSTRAINT chk_curso_nombre CHECK (CHAR_LENGTH(nombre) > 3 AND nombre NOT LIKE '%prueba%'),
  CHECK (precio IS NULL OR precio < 5000 OR NOT (nivel = 'basico'))
);
SHOW CREATE TABLE curso;
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'academia' ORDER BY CONSTRAINT_NAME;
SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'academia' AND TABLE_NAME = 'curso' ORDER BY CONSTRAINT_NAME;
INSERT INTO curso (codigo, nombre, horas, nivel) VALUES ('BD0001', 'Bases de datos', 200, 'medio');
INSERT INTO curso (codigo, nombre, horas, nivel) VALUES ('BD0002', 'Bases de datos', 5, 'medio');
INSERT INTO curso (codigo, nombre, nivel) VALUES ('BD0003', 'Bases de datos', 'experto');
INSERT INTO curso (codigo, nombre, nivel) VALUES ('BD0004', 'Bases de datos', 'MEDIO');
INSERT INTO curso (codigo, nombre, nivel, inicio, fin) VALUES ('BD0005', 'Bases de datos', 'medio', '2026-10-01', '2026-09-01');
INSERT INTO curso (codigo, nombre, nivel, inicio) VALUES ('BD0006', 'Bases de datos', 'medio', '2026-10-01');
INSERT INTO curso (codigo, nombre, nivel) VALUES ('BD0007', 'SQL', 'medio');
INSERT INTO curso (codigo, nombre, nivel) VALUES ('BD0008', 'Curso de prueba', 'medio');
INSERT INTO curso (codigo, nombre, nivel, precio) VALUES ('BD0009', 'Bases de datos', 'basico', 6000);
INSERT INTO curso (codigo, nombre, nivel, precio) VALUES ('BD0010', 'Bases de datos', 'avanzado', -1);
SELECT codigo, horas, nivel FROM curso ORDER BY codigo;
CREATE TABLE matricula (
  dni_alumno CHAR(9),
  codigo_curso CHAR(6),
  anio YEAR,
  nota DECIMAL(4,2) CHECK (nota BETWEEN 0 AND 10),
  PRIMARY KEY (dni_alumno, codigo_curso, anio)
);
SHOW CREATE TABLE matricula;
DESCRIBE matricula;
INSERT INTO matricula VALUES ('11111111A', 'BD0001', 2026, 7.5), ('11111111A', 'BD0001', 2025, NULL);
INSERT INTO matricula VALUES ('11111111A', 'BD0001', 2026, 9);
INSERT INTO matricula VALUES ('11111111A', 'BD0001', 2024, 10.01);
INSERT INTO matricula VALUES ('11111111A', 'BD0001', 2024, 10.001);
SELECT * FROM matricula ORDER BY anio;
CREATE TABLE contador (id INT AUTO_INCREMENT PRIMARY KEY, txt VARCHAR(5), CHECK (txt <> 'x'));
INSERT INTO contador (txt) VALUES ('a'), ('b');
SELECT LAST_INSERT_ID();
INSERT INTO contador (id, txt) VALUES (10, 'c');
INSERT INTO contador (txt) VALUES ('d');
INSERT INTO contador (txt) VALUES ('x');
INSERT INTO contador (txt) VALUES ('e');
INSERT INTO contador VALUES (NULL, 'f'), (0, 'g');
SELECT * FROM contador ORDER BY id;
SELECT LAST_INSERT_ID();
SHOW CREATE TABLE contador;
CREATE TABLE inicio (id INT AUTO_INCREMENT, PRIMARY KEY (id)) AUTO_INCREMENT = 100;
INSERT INTO inicio VALUES ();
SELECT * FROM inicio;
CREATE TABLE dos_pk (a INT PRIMARY KEY, b INT PRIMARY KEY);
CREATE TABLE dos_pk2 (a INT PRIMARY KEY, b INT, PRIMARY KEY (b));
CREATE TABLE pk_nula (a INT NULL PRIMARY KEY);
CREATE TABLE pk_falta (a INT, PRIMARY KEY (b));
CREATE TABLE unico_falta (a INT, UNIQUE KEY (b));
CREATE TABLE texto_pk (a TEXT PRIMARY KEY);
CREATE TABLE chk_falta (a INT, CHECK (b > 0));
CREATE TABLE chk_dup (a INT, CONSTRAINT chk_curso_precio CHECK (a > 0));
CREATE TABLE idx_dup (a INT, b INT, KEY k (a), KEY k (b));
CREATE TABLE sin_pk (a INT NOT NULL, b INT, UNIQUE (a), KEY (b));
DESCRIBE sin_pk;
CREATE TABLE nombres_auto (a INT, b INT, UNIQUE (a), UNIQUE (a, b), KEY (a), INDEX (b), UNIQUE KEY mi_clave (b));
SHOW CREATE TABLE nombres_auto;
SHOW INDEX FROM nombres_auto;
CREATE TABLE IF NOT EXISTS persona (x INT);
SHOW WARNINGS;
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_TYPE, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'academia' ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'academia' ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'academia' ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
