-- Toma de contacto (recetario): los errores que se encuentra el alumnado al arreglar el script y al probar sentencias sueltas
CREATE DATABASE recetario CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE ingrediente (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(40) NOT NULL);
USE recetario;
CREATE TABLE ingrediente (
  id      INT UNSIGNED          NOT NULL AUTO_INCREMENT,
  nombre  VARCHAR(40)           NOT NULL,
  unidad  ENUM('g', 'ml', 'ud') NOT NULL,
  CONSTRAINT pk_ingrediente PRIMARY KEY (id),
  CONSTRAINT uq_ingrediente_nombre UNIQUE (nombre)
) ENGINE = InnoDB;
CREATE TABLE receta_ingrediente (
  id_receta       INT UNSIGNED  NOT NULL,
  id_ingrediente  INT           NOT NULL,
  cantidad        DECIMAL(6,1)  NOT NULL,
  CONSTRAINT pk_receta_ingrediente PRIMARY KEY (id_receta, id_ingrediente),
  CONSTRAINT fk_ri_receta FOREIGN KEY (id_receta) REFERENCES receta (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ri_ingrediente FOREIGN KEY (id_ingrediente) REFERENCES ingrediente (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_ri_cantidad CHECK (cantidad > 0)
) ENGINE = InnoDB;
CREATE TABLE receta (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  titulo      VARCHAR(80)       NOT NULL
  raciones    TINYINT UNSIGNED  NOT NULL DEFAULT 4,
  dificultad  ENUM('fácil', 'media', 'difícil') NOT NULL,
  CONSTRAINT pk_receta PRIMARY KEY (id),
  CONSTRAINT uq_receta_titulo UNIQUE (titulo),
  CONSTRAINT chk_receta_raciones CHECK (raciones BETWEEN 1 AND 20)
) ENGINE = InnoDB;
CREATE TABLE receta (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  titulo      VARCHAR(80)       NOT NULL,
  raciones    TINYINT UNSIGNED  NOT NULL DEFAULT 4,
  dificultad  ENUM('fácil', 'media', 'difícil') NOT NULL,
  CONSTRAINT pk_receta PRIMARY KEY (id),
  CONSTRAINT uq_receta_titulo UNIQUE (titulo),
  CONSTRAINT chk_receta_raciones CHECK (raciones BETWEEN 1 AND 20)
) ENGINE = InnoDB;
CREATE TABLE receta_ingrediente (
  id_receta       INT UNSIGNED  NOT NULL,
  id_ingrediente  INT           NOT NULL,
  cantidad        DECIMAL(6,1)  NOT NULL,
  CONSTRAINT pk_receta_ingrediente PRIMARY KEY (id_receta, id_ingrediente),
  CONSTRAINT fk_ri_receta FOREIGN KEY (id_receta) REFERENCES receta (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ri_ingrediente FOREIGN KEY (id_ingrediente) REFERENCES ingrediente (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_ri_cantidad CHECK (cantidad > 0)
) ENGINE = InnoDB;
SHOW TABLES;
CREATE TABLE receta_ingrediente (
  id_receta       INT UNSIGNED  NOT NULL,
  id_ingrediente  INT UNSIGNED  NOT NULL,
  cantidad        DECIMAL(6,1)  NOT NULL,
  CONSTRAINT pk_receta_ingrediente PRIMARY KEY (id_receta, id_ingrediente),
  CONSTRAINT fk_ri_receta FOREIGN KEY (id_receta) REFERENCES receta (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ri_ingrediente FOREIGN KEY (id_ingrediente) REFERENCES ingrediente (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_ri_cantidad CHECK (cantidad > 0)
) ENGINE = InnoDB;
INSERT INTO ingrediente (nombre, unidad) VALUES ('harina', 'g'), ('huevo', 'ud'), ('leche', 'ml'), ('azúcar', 'g'), ('mantequilla', 'g');
INSERT INTO receta_ingrediente (id_receta, id_ingrediente, cantidad) VALUES (1, 1, 125), (1, 2, 2), (1, 3, 250);
INSERT INTO receta (titulo, raciones, dificultad) VALUES ('Crepes', 6, 'fácil'), ('Bizcocho', 8, 'media');
INSERT INTO receta_ingrediente (id_receta, id_ingrediente, cantidad) VALUES (1, 1, 125), (1, 2, 2), (1, 3, 250), (2, 1, 200), (2, 2, 4), (2, 4, 150), (2, 5, 100.5);
SELECT r.titulo, i.nombre, ri.cantidad, i.unidad FROM receta_ingrediente ri JOIN receta r ON r.id = ri.id_receta JOIN ingrediente i ON i.id = ri.id_ingrediente ORDER BY r.titulo, i.nombre;
SELECT * FROM ingrediente;
INSERT INTO ingrediente (nombre, unidad) VALUES ('harina', 'g');
INSERT INTO ingrediente (nombre, unidad) VALUES ('Harina', 'g');
INSERT INTO ingrediente (nombre, unidad) VALUES ('pimienta', 'kg');
INSERT INTO ingrediente (nombre, unidad) VALUES ('sal', NULL);
INSERT INTO ingrediente (nombre) VALUES ('sal');
INSERT INTO ingrediente (unidad) VALUES ('g');
INSERT INTO ingrediente (nombre, unidad) VALUES (REPEAT('b', 41), 'g');
INSERT INTO receta (titulo) VALUES ('Tortilla');
INSERT INTO receta (titulo, raciones, dificultad) VALUES ('Paella', 21, 'difícil');
INSERT INTO receta (titulo, raciones, dificultad) VALUES ('Paella', 4, 'dificil');
INSERT INTO receta_ingrediente VALUES (1, 4, 0);
INSERT INTO receta_ingrediente VALUES (1, 4, 12.25);
SELECT * FROM receta_ingrediente WHERE id_receta = 1 ORDER BY id_ingrediente;
DELETE FROM ingrediente WHERE nombre = 'harina';
DELETE FROM receta WHERE titulo = 'Crepes';
SELECT COUNT(*) FROM receta_ingrediente;
DESCRIBE ingrediente;
DESCRIBE receta;
SHOW CREATE TABLE ingrediente;
SHOW CREATE TABLE receta;
SHOW CREATE TABLE receta_ingrediente;
SELECT * FROM receta ORDER BY id;
CREATE TABLE valores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  e  ENUM('fácil', 'media') NOT NULL,
  eb ENUM('Sí', 'no') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'no',
  ea ENUM('sí', 'no') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci,
  s  SET('a', 'b') NOT NULL
);
INSERT INTO valores (id) VALUES (1);
INSERT INTO valores (e, s) VALUES ('MEDIA', 'A,b');
INSERT INTO valores (e, eb, s) VALUES ('Facil', 'Sí', '');
INSERT INTO valores (e, eb, s) VALUES ('media', 'sí', 'a');
INSERT INTO valores (e, ea, s) VALUES ('media', 'SÍ', 'a');
INSERT INTO valores (e, ea, s) VALUES ('media', 'si', 'a');
INSERT INTO valores VALUES (DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT);
SELECT * FROM valores ORDER BY id;
CREATE TABLE dup (e ENUM('fácil', 'Facil'));
CREATE TABLE dup (e ENUM('fácil', 'Facil') COLLATE utf8mb4_0900_as_ci);
SHOW CREATE TABLE dup;
DROP TABLE ingrediente;
DROP DATABASE recetario;
SELECT * FROM ingrediente;
