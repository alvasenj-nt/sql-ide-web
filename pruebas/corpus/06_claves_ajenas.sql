-- Claves ajenas: requisitos, nombres, acciones referenciales y mensajes
CREATE DATABASE cines;
USE cines;
CREATE TABLE cine (distrito VARCHAR(30) PRIMARY KEY, direccion VARCHAR(100) NOT NULL);
CREATE TABLE sala (
  distrito_cine VARCHAR(30),
  numero TINYINT UNSIGNED,
  aforo SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (distrito_cine, numero),
  FOREIGN KEY (distrito_cine) REFERENCES cine (distrito) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE pelicula (titulo VARCHAR(100) PRIMARY KEY, anio YEAR, categoria VARCHAR(10));
CREATE TABLE sesion (
  distrito_cine VARCHAR(30),
  numero_sala TINYINT UNSIGNED,
  hora_ini TIME,
  titulo_pelicula VARCHAR(100),
  vo BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (distrito_cine, numero_sala, hora_ini),
  CONSTRAINT fk_sesion_sala FOREIGN KEY (distrito_cine, numero_sala) REFERENCES sala (distrito_cine, numero) ON UPDATE CASCADE,
  CONSTRAINT fk_sesion_pelicula FOREIGN KEY (titulo_pelicula) REFERENCES pelicula (titulo) ON DELETE SET NULL ON UPDATE CASCADE
);
SHOW CREATE TABLE sala;
SHOW CREATE TABLE sesion;
SHOW INDEX FROM sesion;
SELECT CONSTRAINT_NAME, UNIQUE_CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE, TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'cines' ORDER BY CONSTRAINT_NAME;
SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'cines' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION;
INSERT INTO cine VALUES ('Centro', 'Gran Vía 1'), ('Retiro', 'Alcalá 200');
INSERT INTO sala VALUES ('Centro', 1, 120), ('Centro', 2, 80), ('Retiro', 1, 200);
INSERT INTO pelicula VALUES ('Vértigo', 1958, 'drama'), ('Cantando bajo la lluvia', 1952, 'musical');
INSERT INTO sesion VALUES ('Centro', 1, '18:00', 'Vértigo', TRUE), ('Centro', 2, '20:00', 'Cantando bajo la lluvia', FALSE);
INSERT INTO sesion VALUES ('Centro', 3, '18:00', 'Vértigo', TRUE);
INSERT INTO sesion VALUES ('Centro', 1, '22:00', 'Psicosis', TRUE);
INSERT INTO sala VALUES ('Moncloa', 1, 100);
INSERT INTO sesion (distrito_cine, numero_sala, hora_ini) VALUES ('Retiro', 1, '17:00');
DELETE FROM sala WHERE distrito_cine = 'Centro' AND numero = 1;
DELETE FROM pelicula WHERE titulo = 'Vértigo';
SELECT distrito_cine, numero_sala, hora_ini, titulo_pelicula FROM sesion ORDER BY hora_ini;
UPDATE pelicula SET titulo = 'Singin in the Rain' WHERE titulo = 'Cantando bajo la lluvia';
SELECT titulo_pelicula FROM sesion ORDER BY hora_ini;
UPDATE cine SET distrito = 'Sol' WHERE distrito = 'Centro';
SELECT * FROM sala ORDER BY distrito_cine, numero;
SELECT distrito_cine, numero_sala FROM sesion ORDER BY hora_ini;
DELETE FROM cine WHERE distrito = 'Sol';
DELETE FROM sesion;
DELETE FROM cine WHERE distrito = 'Sol';
SELECT COUNT(*) FROM sala;
CREATE TABLE autor (id INT PRIMARY KEY, mentor INT, FOREIGN KEY (mentor) REFERENCES autor (id));
INSERT INTO autor VALUES (1, NULL), (2, 1);
INSERT INTO autor VALUES (3, 9);
DELETE FROM autor WHERE id = 1;
SHOW CREATE TABLE autor;
CREATE TABLE f1 (a INT PRIMARY KEY);
CREATE TABLE f2 (a INT, b INT, FOREIGN KEY (a) REFERENCES f1 (a), FOREIGN KEY (b) REFERENCES f1 (a), CONSTRAINT mio FOREIGN KEY (b) REFERENCES f1 (a));
SHOW CREATE TABLE f2;
CREATE TABLE f3 (a INT, CONSTRAINT mio FOREIGN KEY (a) REFERENCES f1 (a));
CREATE TABLE f4 (a INT, b INT, FOREIGN KEY (a, b) REFERENCES f1 (a));
CREATE TABLE f5 (a INT, FOREIGN KEY (a) REFERENCES f1 (z));
CREATE TABLE f6 (a INT UNSIGNED, FOREIGN KEY (a) REFERENCES f1 (a));
CREATE TABLE f7 (a INT REFERENCES f1 (a));
SHOW CREATE TABLE f7;
INSERT INTO f7 VALUES (99);
CREATE TABLE cadenas (c CHAR(9) PRIMARY KEY);
CREATE TABLE ref_cadena (v VARCHAR(20), FOREIGN KEY (v) REFERENCES cadenas (c));
CREATE TABLE ref_latin (v VARCHAR(9) CHARACTER SET latin1, FOREIGN KEY (v) REFERENCES cadenas (c));
CREATE TABLE ref_unico (x INT UNIQUE, y INT);
CREATE TABLE apunta_unico (x INT, FOREIGN KEY (x) REFERENCES ref_unico (x));
INSERT INTO ref_unico VALUES (1, 1);
INSERT INTO apunta_unico VALUES (1);
INSERT INTO apunta_unico VALUES (2);
DROP TABLE f1;
DROP TABLE f2, f1;
DROP TABLE noexiste;
DROP TABLE IF EXISTS noexiste, f7;
SHOW WARNINGS;
CREATE DATABASE otra;
CREATE TABLE otra.hija (id INT, cine VARCHAR(30), FOREIGN KEY (cine) REFERENCES cines.cine (distrito));
SHOW CREATE TABLE otra.hija;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE huerfana (id INT, padre INT, FOREIGN KEY (padre) REFERENCES no_existe_aun (id));
INSERT INTO autor VALUES (5, 77);
DROP TABLE cine;
SET FOREIGN_KEY_CHECKS = 1;
SELECT * FROM autor ORDER BY id;
SHOW TABLES;
DROP DATABASE otra;
DROP DATABASE cines;
