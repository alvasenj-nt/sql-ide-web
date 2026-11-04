/* Estado inicial del laboratorio de introducción: base de datos club
   con una tabla heredada (comentario_antiguo) para inspeccionar con el
   diccionario de datos. */

SET NAMES utf8mb4;
DROP DATABASE IF EXISTS club;
CREATE DATABASE club
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE club;

CREATE TABLE sede (
  codigo      TINYINT UNSIGNED NOT NULL,
  nombre      VARCHAR(40)      NOT NULL,
  direccion   VARCHAR(100)     NOT NULL,
  responsable CHAR(9),
  CONSTRAINT pk_sede PRIMARY KEY (codigo),
  CONSTRAINT uq_sede_nombre UNIQUE (nombre)
) ENGINE = InnoDB;

CREATE TABLE socio (
  dni       CHAR(9)      NOT NULL,
  nombre    VARCHAR(60)  NOT NULL,
  email     VARCHAR(254),
  ciudad    VARCHAR(40),
  fecha_nac DATE,
  cuota     DECIMAL(6,2) NOT NULL DEFAULT 29.90,
  activo    BOOLEAN      NOT NULL DEFAULT 1,
  alta      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_socio PRIMARY KEY (dni),
  CONSTRAINT uq_socio_email UNIQUE (email),
  CONSTRAINT chk_socio_cuota CHECK (cuota >= 0),
  CONSTRAINT chk_socio_activo CHECK (activo IN (0, 1))
) ENGINE = InnoDB;

CREATE TABLE monitor (
  dni      CHAR(9)          NOT NULL,
  nombre   VARCHAR(60)      NOT NULL,
  telefono VARCHAR(15),
  sede     TINYINT UNSIGNED NOT NULL,
  CONSTRAINT pk_monitor PRIMARY KEY (dni),
  CONSTRAINT fk_monitor_sede FOREIGN KEY (sede)
    REFERENCES sede (codigo)
) ENGINE = InnoDB;

CREATE TABLE actividad (
  codigo  CHAR(6)          NOT NULL,
  nombre  VARCHAR(60)      NOT NULL,
  plazas  TINYINT UNSIGNED NOT NULL DEFAULT 20,
  precio  DECIMAL(6,2)     NOT NULL,
  nivel   VARCHAR(10)      NOT NULL DEFAULT 'inicial',
  inicio  DATE             NOT NULL,
  fin     DATE,
  monitor CHAR(9)          NOT NULL,
  CONSTRAINT pk_actividad PRIMARY KEY (codigo),
  CONSTRAINT uq_actividad_nombre UNIQUE (nombre),
  CONSTRAINT chk_actividad_precio CHECK (precio > 0),
  CONSTRAINT chk_actividad_nivel CHECK (nivel IN ('inicial', 'medio', 'avanzado')),
  CONSTRAINT chk_actividad_fechas CHECK (fin >= inicio),
  CONSTRAINT fk_actividad_monitor FOREIGN KEY (monitor)
    REFERENCES monitor (dni)
) ENGINE = InnoDB;

CREATE TABLE inscripcion (
  dni_socio        CHAR(9) NOT NULL,
  codigo_actividad CHAR(6) NOT NULL,
  fecha            DATE    NOT NULL,
  CONSTRAINT pk_inscripcion PRIMARY KEY (dni_socio, codigo_actividad),
  CONSTRAINT fk_inscripcion_socio FOREIGN KEY (dni_socio)
    REFERENCES socio (dni),
  CONSTRAINT fk_inscripcion_actividad FOREIGN KEY (codigo_actividad)
    REFERENCES actividad (codigo)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE asistencia (
  dni_socio        CHAR(9) NOT NULL,
  codigo_actividad CHAR(6) NOT NULL,
  fecha            DATE    NOT NULL,
  CONSTRAINT pk_asistencia PRIMARY KEY (dni_socio, codigo_actividad, fecha),
  CONSTRAINT fk_asistencia_inscripcion FOREIGN KEY (dni_socio, codigo_actividad)
    REFERENCES inscripcion (dni_socio, codigo_actividad)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE pago (
  id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  dni_socio  CHAR(9)          NOT NULL,
  anio       YEAR             NOT NULL,
  mes        TINYINT UNSIGNED NOT NULL,
  importe    DECIMAL(6,2)     NOT NULL,
  metodo     ENUM('efectivo', 'tarjeta', 'bizum') NOT NULL DEFAULT 'tarjeta',
  registrado TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_pago PRIMARY KEY (id),
  CONSTRAINT uq_pago_mes UNIQUE (dni_socio, anio, mes),
  CONSTRAINT chk_pago_importe CHECK (importe > 0),
  CONSTRAINT chk_pago_mes CHECK (mes >= 1 AND mes <= 12),
  CONSTRAINT fk_pago_socio FOREIGN KEY (dni_socio)
    REFERENCES socio (dni)
) ENGINE = InnoDB;

ALTER TABLE sede
  ADD CONSTRAINT fk_sede_responsable FOREIGN KEY (responsable)
  REFERENCES monitor (dni)
  ON DELETE SET NULL;

-- Tabla heredada de un programa antiguo para inspeccionar su juego de caracteres
CREATE TABLE comentario_antiguo (
  id    INT PRIMARY KEY,
  texto VARCHAR(100) CHARACTER SET utf8
) ENGINE = InnoDB;

INSERT INTO sede (codigo, nombre, direccion) VALUES
  (1, 'Centro', 'Calle Mayor 10, Madrid'),
  (2, 'Getafe', 'Avenida de España 25, Getafe');

INSERT INTO monitor VALUES
  ('50000001M', 'Marta Ruiz',  '600111222', 1),
  ('50000002N', 'Jorge Pardo', '600333444', 1),
  ('50000003P', 'Lucía Sanz',  NULL,        2);

UPDATE sede SET responsable = '50000001M' WHERE codigo = 1;
UPDATE sede SET responsable = '50000003P' WHERE codigo = 2;

INSERT INTO socio VALUES
  ('11111111A', 'Ana Gil',    'ana.gil@correo.es',    'Madrid',   '1990-04-12', 29.90, 1, '2025-09-01 10:00:00'),
  ('22222222B', 'Luis Pérez', NULL,                   'Getafe',   '1985-11-30', 19.95, 1, '2025-09-15 18:30:00'),
  ('33333333C', 'Eva Martín', 'eva.martin@correo.es', 'Madrid',   '2001-02-03', 34.99, 1, '2026-01-10 09:15:00'),
  ('12345678Z', 'José Ruiz',  'jose.ruiz@correo.es',  'Alcorcón', '1978-07-21', 24.50, 0, '2024-03-02 12:00:00');

INSERT INTO actividad VALUES
  ('NAT01', 'Natación adultos',        20, 35.00, 'inicial',  '2026-09-15', '2027-06-15', '50000001M'),
  ('YOG01', 'Yoga',                    15, 25.00, 'medio',    '2026-10-01', NULL,         '50000002N'),
  ('FUN01', 'Entrenamiento funcional', 12, 30.00, 'avanzado', '2026-09-20', '2026-12-20', '50000003P');

INSERT INTO inscripcion VALUES
  ('11111111A', 'NAT01', '2026-09-10'),
  ('11111111A', 'YOG01', '2026-09-28'),
  ('33333333C', 'NAT01', '2026-09-12'),
  ('22222222B', 'FUN01', '2026-09-18');

INSERT INTO asistencia VALUES
  ('11111111A', 'NAT01', '2026-09-15'),
  ('11111111A', 'NAT01', '2026-09-17'),
  ('33333333C', 'NAT01', '2026-09-15'),
  ('22222222B', 'FUN01', '2026-09-22');

INSERT INTO pago (dni_socio, anio, mes, importe, metodo, registrado) VALUES
  ('11111111A', 2026,  9, 29.90, 'tarjeta',  '2026-09-01 10:00:00'),
  ('22222222B', 2026,  9, 19.95, 'efectivo', '2026-09-02 17:45:00'),
  ('33333333C', 2026,  9, 34.99, 'bizum',    '2026-09-03 09:10:00'),
  ('12345678Z', 2026,  9, 24.50, 'tarjeta',  '2026-09-03 11:30:00'),
  ('11111111A', 2026, 10, 29.90, 'tarjeta',  '2026-10-01 10:00:00'),
  ('22222222B', 2026, 10, 19.95, 'efectivo', '2026-10-02 18:05:00'),
  ('33333333C', 2026, 10, 34.99, 'bizum',    '2026-10-01 08:55:00');

