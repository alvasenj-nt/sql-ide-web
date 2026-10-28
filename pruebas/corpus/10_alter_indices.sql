-- ALTER TABLE, índices, TRUNCATE y RENAME: estructura, datos existentes, claves ajenas y mensajes
CREATE DATABASE cine;
USE cine;
CREATE TABLE sala (numero TINYINT UNSIGNED PRIMARY KEY, aforo SMALLINT UNSIGNED NOT NULL);
CREATE TABLE pelicula (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(60) NOT NULL,
  anio SMALLINT,
  duracion SMALLINT UNSIGNED
);
CREATE TABLE sesion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_pelicula INT NOT NULL,
  numero_sala TINYINT UNSIGNED NOT NULL,
  hora DATETIME NOT NULL,
  CONSTRAINT fk_sesion_pelicula FOREIGN KEY (id_pelicula) REFERENCES pelicula (id),
  FOREIGN KEY (numero_sala) REFERENCES sala (numero) ON DELETE CASCADE
);
INSERT INTO sala VALUES (1, 120), (2, 80);
INSERT INTO pelicula (titulo, anio, duracion) VALUES ('Vértigo', 1958, 128), ('Psicosis', 1960, NULL), ('Los pájaros', 1963, 119);
INSERT INTO sesion (id_pelicula, numero_sala, hora) VALUES (1, 1, '2026-11-02 18:00:00'), (2, 2, '2026-11-02 20:00:00');
-- Añadir columnas: posición, valor por defecto y NOT NULL en una tabla con filas
ALTER TABLE pelicula ADD COLUMN pais VARCHAR(30);
ALTER TABLE pelicula ADD clasificacion CHAR(3) NOT NULL DEFAULT 'TP' AFTER titulo;
ALTER TABLE pelicula ADD COLUMN codigo INT NOT NULL FIRST;
ALTER TABLE pelicula ADD COLUMN estreno DATE NOT NULL;
ALTER TABLE pelicula ADD COLUMN notas TEXT NOT NULL;
ALTER TABLE pelicula ADD COLUMN titulo VARCHAR(10);
SELECT * FROM pelicula ORDER BY id;
SHOW CREATE TABLE pelicula;
-- Quitar columnas
ALTER TABLE pelicula DROP COLUMN codigo, DROP notas;
ALTER TABLE pelicula DROP COLUMN no_existe;
ALTER TABLE sesion DROP COLUMN id_pelicula;
ALTER TABLE pelicula DROP COLUMN id;
DESCRIBE pelicula;
-- MODIFY y CHANGE: tipos, NULL y datos existentes
ALTER TABLE pelicula MODIFY titulo VARCHAR(5);
ALTER TABLE pelicula MODIFY titulo VARCHAR(80) NOT NULL;
ALTER TABLE pelicula MODIFY duracion SMALLINT UNSIGNED NOT NULL;
ALTER TABLE pelicula MODIFY anio TINYINT;
ALTER TABLE pelicula MODIFY anio YEAR;
ALTER TABLE pelicula CHANGE pais pais_origen VARCHAR(40) DEFAULT 'España';
ALTER TABLE pelicula CHANGE COLUMN pais_origen pais VARCHAR(40) DEFAULT 'España' AFTER anio;
ALTER TABLE pelicula RENAME COLUMN pais TO nacionalidad;
ALTER TABLE pelicula RENAME COLUMN no_existe TO otra;
ALTER TABLE pelicula RENAME COLUMN anio TO titulo;
ALTER TABLE pelicula MODIFY clasificacion ENUM('TP', '7', '12', '16', '18') NOT NULL DEFAULT 'TP';
ALTER TABLE pelicula MODIFY clasificacion CHAR(2);
UPDATE pelicula SET duracion = 109 WHERE duracion IS NULL;
ALTER TABLE pelicula MODIFY duracion SMALLINT UNSIGNED NOT NULL;
SELECT * FROM pelicula ORDER BY id;
SHOW CREATE TABLE pelicula;
-- Valores por defecto
ALTER TABLE pelicula ALTER COLUMN nacionalidad SET DEFAULT 'Francia';
ALTER TABLE pelicula ALTER nacionalidad DROP DEFAULT;
ALTER TABLE pelicula ALTER COLUMN duracion SET DEFAULT 90;
INSERT INTO pelicula (titulo, anio, estreno) VALUES ('Rebeca', 1940, '1940-04-12');
SELECT id, titulo, nacionalidad, duracion FROM pelicula ORDER BY id;
SHOW CREATE TABLE pelicula;
-- Columnas referenciadas por claves ajenas
ALTER TABLE pelicula MODIFY id BIGINT AUTO_INCREMENT;
ALTER TABLE pelicula MODIFY id INT UNSIGNED AUTO_INCREMENT;
ALTER TABLE sesion MODIFY id_pelicula BIGINT NOT NULL;
ALTER TABLE pelicula RENAME COLUMN id TO id_peli;
SHOW CREATE TABLE sesion;
ALTER TABLE pelicula RENAME COLUMN id_peli TO id;
ALTER TABLE sesion RENAME COLUMN numero_sala TO sala;
SHOW CREATE TABLE sesion;
-- Restricciones: PRIMARY KEY, UNIQUE, CHECK y FOREIGN KEY
ALTER TABLE pelicula ADD CONSTRAINT uq_pelicula_titulo UNIQUE (titulo);
INSERT INTO pelicula (titulo, anio, estreno) VALUES ('Vértigo', 1990, '1990-01-01');
ALTER TABLE pelicula ADD UNIQUE (anio);
INSERT INTO pelicula (titulo, anio, estreno) VALUES ('Encadenados', 1946, '1946-08-15'), ('Náufragos', 1946, '1944-01-11');
ALTER TABLE pelicula ADD UNIQUE KEY uq_anio_titulo (anio, titulo);
ALTER TABLE pelicula ADD UNIQUE KEY uq_anio_titulo (titulo);
ALTER TABLE pelicula ADD CONSTRAINT chk_duracion CHECK (duracion > 60);
ALTER TABLE pelicula ADD CONSTRAINT chk_duracion CHECK (duracion BETWEEN 60 AND 300);
ALTER TABLE pelicula ADD CHECK (anio >= 1895);
ALTER TABLE pelicula ADD CHECK (anio < 2100);
ALTER TABLE pelicula ADD CONSTRAINT chk_anio_grande CHECK (anio > 1950);
INSERT INTO pelicula (titulo, anio, duracion, estreno) VALUES ('Corto', 2000, 20, '2000-01-01');
ALTER TABLE pelicula ALTER CHECK chk_duracion NOT ENFORCED;
INSERT INTO pelicula (titulo, anio, duracion, estreno) VALUES ('Corto', 2000, 20, '2000-01-01');
ALTER TABLE pelicula ALTER CHECK chk_duracion ENFORCED;
DELETE FROM pelicula WHERE titulo = 'Corto';
ALTER TABLE pelicula ALTER CHECK chk_duracion ENFORCED;
ALTER TABLE pelicula ALTER CHECK no_existe ENFORCED;
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'cine' ORDER BY CONSTRAINT_NAME;
ALTER TABLE pelicula DROP CHECK pelicula_chk_1;
ALTER TABLE pelicula DROP CONSTRAINT pelicula_chk_2;
ALTER TABLE pelicula DROP CHECK no_existe;
ALTER TABLE pelicula DROP CONSTRAINT uq_pelicula_titulo;
ALTER TABLE pelicula DROP INDEX anio;
ALTER TABLE pelicula DROP INDEX no_existe;
ALTER TABLE pelicula DROP KEY uq_anio_titulo;
SHOW CREATE TABLE pelicula;
CREATE TABLE critica (id INT AUTO_INCREMENT PRIMARY KEY, id_pelicula INT, texto VARCHAR(200), autor VARCHAR(40));
INSERT INTO critica (id_pelicula, texto) VALUES (1, 'Obra maestra'), (99, 'No existe');
ALTER TABLE critica ADD CONSTRAINT fk_critica_pelicula FOREIGN KEY (id_pelicula) REFERENCES pelicula (id) /*ignorar*/;
DELETE FROM critica WHERE id_pelicula = 99;
ALTER TABLE critica ADD CONSTRAINT fk_critica_pelicula FOREIGN KEY (id_pelicula) REFERENCES pelicula (id) ON DELETE SET NULL;
ALTER TABLE critica ADD FOREIGN KEY (id_pelicula) REFERENCES pelicula (id);
ALTER TABLE critica ADD FOREIGN KEY (autor) REFERENCES pelicula (titulo);
ALTER TABLE critica ADD FOREIGN KEY (texto) REFERENCES no_existe (id);
SHOW CREATE TABLE critica;
ALTER TABLE critica DROP FOREIGN KEY critica_ibfk_1;
ALTER TABLE critica DROP FOREIGN KEY no_existe;
ALTER TABLE critica DROP INDEX fk_critica_pelicula;
ALTER TABLE critica DROP FOREIGN KEY fk_critica_pelicula;
SHOW CREATE TABLE critica;
ALTER TABLE critica DROP INDEX fk_critica_pelicula;
ALTER TABLE critica ADD CONSTRAINT fk_critica_pelicula FOREIGN KEY (id_pelicula) REFERENCES pelicula (id) ON DELETE CASCADE;
-- Clave primaria
ALTER TABLE critica DROP PRIMARY KEY;
ALTER TABLE critica MODIFY id INT NOT NULL;
ALTER TABLE critica DROP PRIMARY KEY;
ALTER TABLE critica ADD PRIMARY KEY (autor);
ALTER TABLE critica ADD PRIMARY KEY (id);
ALTER TABLE critica ADD PRIMARY KEY (id);
ALTER TABLE sala DROP PRIMARY KEY;
ALTER TABLE critica MODIFY id INT NOT NULL AUTO_INCREMENT;
SHOW CREATE TABLE critica;
-- Varias operaciones en una sentencia y opciones de tabla
ALTER TABLE critica ADD COLUMN fecha DATE, ADD COLUMN puntuacion TINYINT UNSIGNED CHECK (puntuacion <= 10), ADD INDEX idx_fecha (fecha);
ALTER TABLE critica ADD COLUMN x INT, DROP COLUMN no_existe;
ALTER TABLE critica ENGINE = MyISAM;
ALTER TABLE critica COMMENT = 'Críticas de prensa', AUTO_INCREMENT = 100;
INSERT INTO critica (id_pelicula, texto) VALUES (2, 'Inquietante');
SELECT id, id_pelicula, texto FROM critica ORDER BY id;
ALTER TABLE critica RENAME INDEX idx_fecha TO idx_critica_fecha;
ALTER TABLE critica RENAME KEY no_existe TO otro;
SHOW CREATE TABLE critica;
SELECT TABLE_NAME, AUTO_INCREMENT, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'cine' ORDER BY TABLE_NAME;
-- CREATE INDEX y DROP INDEX
CREATE INDEX idx_titulo ON pelicula (titulo);
CREATE UNIQUE INDEX uq_titulo_anio ON pelicula (titulo, anio DESC);
CREATE INDEX idx_titulo ON pelicula (anio);
CREATE INDEX idx_x ON no_existe (a);
CREATE INDEX idx_y ON pelicula (no_existe);
CREATE INDEX idx_prefijo ON critica (texto(20));
SHOW INDEX FROM pelicula;
DROP INDEX idx_titulo ON pelicula;
DROP INDEX no_existe ON pelicula;
DROP INDEX `PRIMARY` ON sala;
SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'cine' ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
-- TRUNCATE
TRUNCATE TABLE sala;
TRUNCATE TABLE critica;
SHOW CREATE TABLE critica;
TRUNCATE sesion;
INSERT INTO sesion (id_pelicula, sala, hora) VALUES (1, 1, '2026-11-03 18:00:00');
SELECT * FROM sesion;
TRUNCATE TABLE no_existe;
-- RENAME TABLE y ALTER TABLE ... RENAME
RENAME TABLE pelicula TO film;
SHOW CREATE TABLE sesion;
SHOW TABLES;
INSERT INTO sesion (id_pelicula, sala, hora) VALUES (99, 1, '2026-11-03 18:00:00');
DELETE FROM film WHERE id = 1;
RENAME TABLE film TO pelicula, sala TO pelicula;
RENAME TABLE no_existe TO otra;
ALTER TABLE film RENAME TO pelicula;
ALTER TABLE pelicula RENAME AS peliculas, ADD COLUMN genero VARCHAR(20);
SHOW TABLES;
SHOW CREATE TABLE peliculas;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'cine' ORDER BY CONSTRAINT_NAME;
DROP TABLE peliculas;
DROP DATABASE cine;
