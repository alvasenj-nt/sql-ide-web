/* Demostraciones de la UT-3 (profesor): claves, restricciones, claves ajenas, ALTER e índices.
   Requiere haber ejecutado antes demo_UT3_almacenamiento_tipos.sql (base de datos demo).
     docker exec -i <contenedor> mysql -uroot -p --force -t < demo_UT3_restricciones.sql
   Verificado con MySQL 8.0.46. */

USE demo;

-- Clave primaria (presentación A, 23)
CREATE TABLE pk1 (dni CHAR(9), nombre VARCHAR(50), PRIMARY KEY (dni));
DESCRIBE pk1;
-- ERROR 1075: there can be only one auto column and it must be defined as a key
CREATE TABLE ai (id INT AUTO_INCREMENT, nombre VARCHAR(20));

-- UNIQUE admite varios nulos (presentación A, 20 y 24)
CREATE TABLE u (email VARCHAR(50) UNIQUE);
INSERT INTO u VALUES (NULL), (NULL);
SELECT COUNT(*) FROM u;

-- CHECK (presentación A, 25-26)
CREATE TABLE ck (precio DECIMAL(8,2) CHECK (precio > 0), ini DATE, fin DATE,
  CONSTRAINT chk_fechas CHECK (fin >= ini));
-- ERROR 3819: Check constraint 'ck_chk_1' is violated.
INSERT INTO ck VALUES (-1, NULL, NULL);
-- ERROR 3819: Check constraint 'chk_fechas' is violated.
INSERT INTO ck VALUES (5, '2026-10-10', '2026-10-01');
-- Se acepta: la condición con NULL es desconocida, no falsa
INSERT INTO ck VALUES (5, '2026-10-10', NULL);
-- ERROR 3814: contains disallowed function: curdate
CREATE TABLE ck2 (f DATE CHECK (f <= CURDATE()));
-- ERROR 3818: Check constraint 'ck3_chk_1' cannot refer to an auto-increment column
CREATE TABLE ck3 (id INT AUTO_INCREMENT PRIMARY KEY CHECK (id > 0));
SHOW CREATE TABLE ck\G

-- Claves ajenas: requisitos (presentación A, 28)
-- ERROR 1824: Failed to open the referenced table 'no_existe'
CREATE TABLE hija_antes (id INT PRIMARY KEY, cod INT, FOREIGN KEY (cod) REFERENCES no_existe (cod));
CREATE TABLE padre (cod INT PRIMARY KEY, nombre VARCHAR(20) NOT NULL);
-- ERROR 3780: Referencing column 'cod' and referenced column 'cod' ... are incompatible
CREATE TABLE hija_tipo (id INT PRIMARY KEY, cod BIGINT, FOREIGN KEY (cod) REFERENCES padre (cod));
-- ERROR 1822: Missing index for constraint ... in the referenced table 'padre'
CREATE TABLE hija_sinindice (id INT PRIMARY KEY, nom VARCHAR(20), FOREIGN KEY (nom) REFERENCES padre (nombre));
-- ERROR 1830: Column 'cod' cannot be NOT NULL: needed in a foreign key constraint ... SET NULL
CREATE TABLE hija_setnull (id INT PRIMARY KEY, cod INT NOT NULL,
  FOREIGN KEY (cod) REFERENCES padre (cod) ON DELETE SET NULL);

-- Integridad en acción (presentación A, 31)
CREATE TABLE hija (id INT PRIMARY KEY, cod INT,
  CONSTRAINT fk_hija_padre FOREIGN KEY (cod) REFERENCES padre (cod));
CREATE TABLE hija_cascada (id INT PRIMARY KEY, cod INT NOT NULL,
  FOREIGN KEY (cod) REFERENCES padre (cod) ON DELETE CASCADE ON UPDATE CASCADE);
INSERT INTO padre VALUES (1, 'uno'), (2, 'dos');
INSERT INTO hija VALUES (10, 1);
-- ERROR 1452: Cannot add or update a child row
INSERT INTO hija VALUES (11, 99);
INSERT INTO hija_cascada VALUES (20, 2);
-- ERROR 1451: Cannot delete or update a parent row
DELETE FROM padre WHERE cod = 1;
UPDATE padre SET cod = 22 WHERE cod = 2;
SELECT * FROM hija_cascada;
DELETE FROM padre WHERE cod = 22;
SELECT COUNT(*) FROM hija_cascada;
-- ERROR 3730: Cannot drop table 'padre' referenced by a foreign key constraint
DROP TABLE padre;
-- ERROR 1701: Cannot truncate a table referenced in a foreign key constraint
TRUNCATE TABLE padre;
SHOW INDEX FROM hija;

-- SET DEFAULT: InnoDB la guarda pero actúa como RESTRICT (presentación A, 30)
INSERT INTO t_innodb VALUES (1), (2);
CREATE TABLE sd (id INT PRIMARY KEY, cod INT DEFAULT 1,
  FOREIGN KEY (cod) REFERENCES t_innodb (id) ON DELETE SET DEFAULT);
INSERT INTO sd VALUES (1, 2);
-- ERROR 1451: Cannot delete or update a parent row
DELETE FROM t_innodb WHERE id = 2;

-- Claves ajenas circulares (presentación A, 29)
CREATE TABLE departamento (cod INT PRIMARY KEY, jefe CHAR(9));
CREATE TABLE empleado (dni CHAR(9) PRIMARY KEY, cod_dep INT NOT NULL,
  CONSTRAINT fk_emp_dep FOREIGN KEY (cod_dep) REFERENCES departamento (cod));
ALTER TABLE departamento ADD CONSTRAINT fk_dep_jefe FOREIGN KEY (jefe) REFERENCES empleado (dni);

-- CREATE TABLE ... LIKE no copia las claves ajenas (presentación A, 13)
CREATE TABLE copia_hija LIKE hija;
SHOW CREATE TABLE copia_hija\G

-- ALTER TABLE y sus trampas (presentación A, 35-36)
CREATE TABLE emp (id INT PRIMARY KEY, nombre VARCHAR(20) NOT NULL DEFAULT 'x', sueldo DECIMAL(8,2));
ALTER TABLE emp MODIFY nombre VARCHAR(40);
DESCRIBE emp;
ALTER TABLE emp ADD COLUMN email VARCHAR(60) AFTER nombre, ADD CONSTRAINT uq_emp_email UNIQUE (email);
ALTER TABLE emp RENAME COLUMN sueldo TO salario;
ALTER TABLE hija DROP FOREIGN KEY fk_hija_padre;
SHOW INDEX FROM hija;
CREATE TABLE ck5 (p INT);
INSERT INTO ck5 VALUES (-3);
-- ERROR 3819: Check constraint 'chk_p' is violated (las filas existentes se comprueban)
ALTER TABLE ck5 ADD CONSTRAINT chk_p CHECK (p > 0);

-- TRUNCATE reinicia AUTO_INCREMENT (presentación A, 37)
CREATE TABLE pedido (id INT AUTO_INCREMENT PRIMARY KEY,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('pendiente','enviado') NOT NULL DEFAULT 'pendiente');
INSERT INTO pedido () VALUES (), ();
TRUNCATE TABLE pedido;
INSERT INTO pedido () VALUES ();
SELECT id, estado FROM pedido;

-- Índices (presentación A, 38)
CREATE INDEX idx_emp_nombre ON emp (nombre);
SHOW INDEX FROM emp;
