-- ALTER TABLE: casos límite (CHECK y columnas, conversiones, claves e índices de claves ajenas)
CREATE DATABASE tienda;
USE tienda;
CREATE TABLE categoria (id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(30) NOT NULL, padre SMALLINT UNSIGNED,
  FOREIGN KEY (padre) REFERENCES categoria (id) ON DELETE SET NULL);
CREATE TABLE producto (
  ref CHAR(6) PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL,
  precio DECIMAL(7,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  codigo VARCHAR(10),
  id_categoria SMALLINT UNSIGNED,
  CONSTRAINT chk_precio CHECK (precio >= 0),
  CONSTRAINT chk_stock_precio CHECK (stock >= 0 AND precio < 10000),
  CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria) REFERENCES categoria (id)
);
INSERT INTO categoria (nombre, padre) VALUES ('Deporte', NULL), ('Running', 1), ('Montaña', 1);
INSERT INTO producto VALUES ('A00001', 'Zapatilla', 89.95, 10, '123', 2), ('A00002', 'Mochila', 45.50, 0, 'X12', 3), ('A00003', 'Gorra', 12.00, 4, NULL, NULL);
-- Columnas usadas por CHECK
ALTER TABLE producto DROP COLUMN stock;
ALTER TABLE producto RENAME COLUMN precio TO pvp;
SHOW CREATE TABLE producto;
ALTER TABLE producto DROP CHECK chk_stock_precio;
ALTER TABLE producto DROP COLUMN stock;
ALTER TABLE producto DROP COLUMN pvp;
SHOW CREATE TABLE producto;
ALTER TABLE producto DROP CONSTRAINT no_existe;
-- Conversiones al cambiar el tipo
ALTER TABLE producto MODIFY codigo INT;
UPDATE producto SET codigo = '999' WHERE ref = 'A00002';
ALTER TABLE producto MODIFY codigo INT;
SELECT ref, codigo FROM producto ORDER BY ref;
ALTER TABLE producto MODIFY codigo VARCHAR(10);
ALTER TABLE producto MODIFY pvp DECIMAL(5,1) NOT NULL;
SELECT ref, pvp FROM producto ORDER BY ref;
ALTER TABLE producto MODIFY pvp DECIMAL(3,1) NOT NULL;
ALTER TABLE producto MODIFY pvp INT NOT NULL;
SELECT ref, pvp FROM producto ORDER BY ref;
ALTER TABLE producto MODIFY nombre CHAR(40) NOT NULL;
ALTER TABLE producto MODIFY nombre VARCHAR(60) NOT NULL;
ALTER TABLE producto MODIFY nombre VARCHAR(70) NOT NULL;
-- DROP DEFAULT en una columna que admite NULL
ALTER TABLE producto ALTER codigo DROP DEFAULT;
INSERT INTO producto (ref, nombre, pvp) VALUES ('A00004', 'Calcetines', 6);
INSERT INTO producto (ref, nombre, pvp, codigo) VALUES ('A00004', 'Calcetines', 6, NULL);
DESCRIBE producto;
-- Columnas nuevas con restricciones en línea y filas existentes
ALTER TABLE producto ADD COLUMN ean CHAR(13) UNIQUE;
ALTER TABLE producto ADD COLUMN lote INT NOT NULL DEFAULT 1 UNIQUE;
ALTER TABLE producto ADD COLUMN orden INT AUTO_INCREMENT;
ALTER TABLE producto ADD COLUMN num INT AUTO_INCREMENT UNIQUE;
SELECT ref, num FROM producto ORDER BY ref;
ALTER TABLE producto ADD COLUMN alta DATETIME NOT NULL;
ALTER TABLE producto ADD COLUMN hora TIME NOT NULL, ADD COLUMN activo BOOLEAN NOT NULL, ADD COLUMN talla ENUM('S', 'M', 'L') NOT NULL;
SELECT ref, hora, activo, talla FROM producto ORDER BY ref;
ALTER TABLE producto ADD UNIQUE (activo);
ALTER TABLE producto ADD CHECK (talla <> 'S');
ALTER TABLE producto MODIFY ref CHAR(6) NULL;
ALTER TABLE producto MODIFY ref CHAR(8);
SHOW CREATE TABLE producto;
-- Índices que necesitan las claves ajenas
ALTER TABLE producto DROP INDEX fk_producto_categoria;
CREATE INDEX idx_cat_nombre ON producto (id_categoria, nombre);
ALTER TABLE producto DROP INDEX fk_producto_categoria;
SHOW CREATE TABLE producto;
ALTER TABLE producto DROP INDEX idx_cat_nombre;
ALTER TABLE producto MODIFY id_categoria INT;
ALTER TABLE producto MODIFY id_categoria SMALLINT UNSIGNED NOT NULL;
UPDATE producto SET id_categoria = 1 WHERE id_categoria IS NULL;
ALTER TABLE producto MODIFY id_categoria SMALLINT UNSIGNED NOT NULL;
ALTER TABLE categoria MODIFY padre SMALLINT UNSIGNED NOT NULL;
-- Tabla con clave ajena a sí misma
ALTER TABLE categoria RENAME COLUMN id TO id_cat;
SHOW CREATE TABLE categoria;
RENAME TABLE categoria TO seccion;
SHOW CREATE TABLE seccion;
SHOW CREATE TABLE producto;
DELETE FROM seccion WHERE id_cat = 2;
SELECT * FROM producto ORDER BY ref;
INSERT INTO seccion (nombre, padre) VALUES ('Trail', 3);
DELETE FROM seccion WHERE id_cat = 3;
SELECT id_cat, nombre, padre FROM seccion ORDER BY id_cat;
-- Varias operaciones: el orden importa
ALTER TABLE producto DROP COLUMN ean, ADD COLUMN ean VARCHAR(13) AFTER ref;
ALTER TABLE producto ADD COLUMN a INT, ADD COLUMN b INT AFTER a, DROP COLUMN a;
ALTER TABLE producto ADD COLUMN c INT AFTER no_existe;
ALTER TABLE producto ADD PRIMARY KEY (nombre);
ALTER TABLE producto DROP PRIMARY KEY, ADD PRIMARY KEY (ref, nombre);
SHOW CREATE TABLE producto;
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'tienda' ORDER BY TABLE_NAME, CONSTRAINT_NAME;
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'tienda' ORDER BY TABLE_NAME, ORDINAL_POSITION;
DROP DATABASE tienda;
