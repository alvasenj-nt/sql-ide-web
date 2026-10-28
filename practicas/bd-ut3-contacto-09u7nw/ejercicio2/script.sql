/* Recetario con recetas: script de creación que no funciona.
   Lee ejercicio2/enunciado.txt y corrige sus cinco errores. */

DROP DATABASE IF EXISTS recetario;
CREATE DATABASE recetario
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

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

INSERT INTO ingrediente (nombre, unidad) VALUES
  ('harina', 'g'),
  ('huevo', 'ud'),
  ('leche', 'ml'),
  ('azúcar', 'g'),
  ('mantequilla', 'g');

INSERT INTO receta_ingrediente (id_receta, id_ingrediente, cantidad) VALUES
  (1, 1, 125), (1, 2, 2), (1, 3, 250),
  (2, 1, 200), (2, 2, 4), (2, 4, 150), (2, 5, 100.5);

INSERT INTO receta (titulo, raciones, dificultad) VALUES
  ('Crepes', 6, 'fácil'),
  ('Bizcocho', 8, 'media');

SELECT r.titulo, i.nombre, ri.cantidad, i.unidad
FROM receta_ingrediente ri
  JOIN receta r ON r.id = ri.id_receta
  JOIN ingrediente i ON i.id = ri.id_ingrediente
ORDER BY r.titulo, i.nombre;


/* Respuestas: para cada error, en el orden en que aparecieron, anota el
   código de error de MySQL, qué lo causaba y cómo lo has corregido.
   1.

   2.

   3.

   4.

   5.
*/
