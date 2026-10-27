/* Demostraciones de la UT-3 (profesor): motores, juegos de caracteres y tipos de datos.
   Ejecutar como root con --force, porque varias sentencias fallan a propósito:
     docker exec -i <contenedor> mysql -uroot -p --force -t < demo_UT3_almacenamiento_tipos.sql
   Cada sentencia que debe fallar lleva el error esperado en el comentario anterior.
   Verificado con MySQL 8.0.46. */

DROP DATABASE IF EXISTS demo;
CREATE DATABASE demo CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE demo;

-- Motores (presentación A, 6-8)
SHOW ENGINES;
CREATE TABLE t_innodb (id INT PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE t_myisam (id INT PRIMARY KEY) ENGINE=MyISAM;
-- En el contenedor: ls /var/lib/mysql/demo  ->  t_innodb.ibd, t_myisam.MYD, .MYI y .sdi
-- Clave ajena en MyISAM: se acepta, se descarta y no avisa
CREATE TABLE hija_myisam (id INT PRIMARY KEY, padre INT,
  FOREIGN KEY (padre) REFERENCES t_innodb (id)) ENGINE=MyISAM;
SHOW CREATE TABLE hija_myisam\G
-- ERROR 1824: Failed to open the referenced table 't_myisam'
CREATE TABLE hija_de_myisam (id INT PRIMARY KEY, padre INT,
  FOREIGN KEY (padre) REFERENCES t_myisam (id)) ENGINE=InnoDB;

-- Juegos de caracteres y colaciones (presentación A, 9)
CREATE TABLE c3 (txt VARCHAR(20) CHARACTER SET utf8);
SHOW WARNINGS;
-- ERROR 1366: Incorrect string value '\xF0\x9F\x98\x80' (carácter de 4 bytes en utf8mb3)
INSERT INTO c3 VALUES (CONCAT('hola ', _utf8mb4 0xF09F9880));
CREATE TABLE c4 (txt VARCHAR(20));
INSERT INTO c4 VALUES (CONCAT('hola ', _utf8mb4 0xF09F9880));
SELECT LENGTH(txt) AS bytes, CHAR_LENGTH(txt) AS caracteres FROM c4;
SELECT 'José' = 'jose' AS ai_ci, 'José' = 'jose' COLLATE utf8mb4_0900_as_cs AS as_cs;

-- Nombres de tabla en Linux (presentación A, 14)
SELECT @@lower_case_table_names;
CREATE TABLE Socio (id INT PRIMARY KEY);
CREATE TABLE socio_tmp (id INT PRIMARY KEY);
SHOW TABLES LIKE '%ocio%';
DROP TABLE Socio, socio_tmp;

-- Tipos de datos (presentación A, 15-19)
CREATE TABLE tipos (v VARCHAR(5), t TINYINT, b BOOLEAN, ts TIMESTAMP NULL, dt DATETIME,
  e ENUM('a','b'), c CHAR(5), n INT(11));
SHOW WARNINGS;
-- ERROR 1406: Data too long for column 'v'
INSERT INTO tipos (v) VALUES ('abcdefg');
-- ERROR 1264: Out of range value for column 't'
INSERT INTO tipos (t) VALUES (300);
INSERT INTO tipos (b) VALUES (5);
-- ERROR 1292: Incorrect datetime value (TIMESTAMP termina en 2038)
INSERT INTO tipos (ts) VALUES ('2040-01-01 00:00:00');
INSERT INTO tipos (dt) VALUES ('2040-01-01 00:00:00');
-- ERROR 1265: Data truncated for column 'e'
INSERT INTO tipos (e) VALUES ('c');
INSERT INTO tipos (c) VALUES ('ab   ');
SELECT b, CONCAT('[', c, ']') AS c_entre_corchetes FROM tipos WHERE b IS NOT NULL OR c IS NOT NULL;
DESCRIBE tipos;

CREATE TABLE dinero (f FLOAT, d DECIMAL(10,2));
INSERT INTO dinero VALUES (0.1,0.1),(0.1,0.1),(0.1,0.1),(0.1,0.1),(0.1,0.1),
                          (0.1,0.1),(0.1,0.1),(0.1,0.1),(0.1,0.1),(0.1,0.1);
SELECT SUM(f), SUM(d) FROM dinero;

CREATE TABLE zonas (ts TIMESTAMP, dt DATETIME);
SET time_zone = '+00:00';
INSERT INTO zonas VALUES ('2026-10-28 10:00:00', '2026-10-28 10:00:00');
SET time_zone = '+01:00';
SELECT ts, dt FROM zonas;
SET time_zone = SYSTEM;

-- ERROR 1101: BLOB, TEXT, GEOMETRY or JSON column 't' can't have a default value
CREATE TABLE txt_defecto (t TEXT DEFAULT 'x');

-- Diccionario de datos (presentación A, 10)
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'demo';
