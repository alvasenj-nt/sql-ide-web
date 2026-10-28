/* Demostraciones de la UT-3 (profesor): vistas, cuentas, privilegios y roles.
   Requiere la base de datos demo de los scripts anteriores. Ejecutar como root con --force.
   Las pruebas con sesiones de otros usuarios están al final, comentadas: se lanzan aparte.
   Verificado con MySQL 8.0.46. */

CREATE DATABASE demo;
USE demo;
DROP USER IF EXISTS 'ana'@'localhost', 'ana'@'%', 'luis'@'localhost';
DROP ROLE IF EXISTS 'rol_lectura';

CREATE TABLE socio (dni CHAR(9) PRIMARY KEY, nombre VARCHAR(50) NOT NULL, ciudad VARCHAR(30),
  cuota DECIMAL(6,2) NOT NULL DEFAULT 20);
INSERT INTO socio VALUES ('11111111A','Ana','Madrid',20), ('22222222B','Luis','Getafe',15),
                         ('33333333C','Eva','Madrid',30);

-- Vista actualizable sin CHECK OPTION: la fila insertada no se ve (presentación B, 4-5)
CREATE VIEW socios_madrid AS SELECT dni, nombre, cuota FROM socio WHERE ciudad = 'Madrid';
INSERT INTO socios_madrid VALUES ('44444444D', 'Raul', 25);
SELECT * FROM socios_madrid WHERE dni = '44444444D';
SELECT * FROM socio WHERE dni = '44444444D';

-- Con CHECK OPTION
CREATE OR REPLACE VIEW socios_madrid AS
  SELECT dni, nombre, ciudad, cuota FROM socio WHERE ciudad = 'Madrid' WITH CHECK OPTION;
-- ERROR 1369: CHECK OPTION failed 'demo.socios_madrid'
INSERT INTO socios_madrid VALUES ('55555555E', 'Sara', 'Toledo', 25);
-- ERROR 1369: CHECK OPTION failed 'demo.socios_madrid'
UPDATE socios_madrid SET ciudad = 'Toledo' WHERE dni = '11111111A';

-- LOCAL frente a CASCADED
CREATE VIEW v1 AS SELECT * FROM socio WHERE cuota > 10;
CREATE VIEW v2 AS SELECT * FROM v1 WHERE ciudad = 'Madrid' WITH LOCAL CHECK OPTION;
-- Se acepta: LOCAL no comprueba la condición de v1, que no tiene opción propia
INSERT INTO v2 (dni, nombre, ciudad, cuota) VALUES ('66666666F', 'Pablo', 'Madrid', 5);
CREATE OR REPLACE VIEW v2 AS SELECT * FROM v1 WHERE ciudad = 'Madrid' WITH CASCADED CHECK OPTION;
-- ERROR 1369: CHECK OPTION failed 'demo.v2'
INSERT INTO v2 (dni, nombre, ciudad, cuota) VALUES ('77777777G', 'Lola', 'Madrid', 5);

-- Vistas no actualizables o no insertables
CREATE VIEW resumen AS SELECT ciudad, COUNT(*) AS total FROM socio GROUP BY ciudad;
-- ERROR 1288: The target table resumen of the UPDATE is not updatable
UPDATE resumen SET total = 0;
CREATE VIEW solo_dni AS SELECT dni, ciudad FROM socio;
-- ERROR 1423: Field of view 'demo.solo_dni' underlying table doesn't have a default value
INSERT INTO solo_dni VALUES ('99999999Z', 'Madrid');

-- El * se congela al crear la vista (presentación B, 3)
CREATE VIEW todo AS SELECT * FROM socio;
ALTER TABLE socio ADD COLUMN telefono CHAR(9);
SHOW CREATE VIEW todo\G
SELECT TABLE_NAME, IS_UPDATABLE, CHECK_OPTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'demo';

-- Cuentas y privilegios (presentación B, 8-11)
-- ERROR 1410: You are not allowed to create a user with GRANT
GRANT SELECT ON demo.* TO 'fantasma'@'localhost';
CREATE USER 'ana'@'localhost' IDENTIFIED BY 'Ana_2026!';
CREATE USER 'ana'@'%' IDENTIFIED BY 'Otra_2026!';
SELECT user, host FROM mysql.user WHERE user = 'ana';
GRANT SELECT (dni, nombre), UPDATE (cuota) ON demo.socio TO 'ana'@'localhost';
CREATE VIEW cuotas_madrid AS SELECT dni, nombre, cuota FROM socio WHERE ciudad = 'Madrid';
GRANT SELECT ON demo.cuotas_madrid TO 'ana'@'localhost';
SHOW GRANTS FOR 'ana'@'localhost';
REVOKE UPDATE (cuota) ON demo.socio FROM 'ana'@'localhost';
SHOW GRANTS FOR 'ana'@'localhost';

-- Roles (presentación B, 13-14)
CREATE ROLE 'rol_lectura';
GRANT SELECT ON demo.* TO 'rol_lectura';
CREATE USER 'luis'@'localhost' IDENTIFIED BY 'Luis_2026!';
GRANT 'rol_lectura' TO 'luis'@'localhost';
SHOW GRANTS FOR 'luis'@'localhost';
SHOW GRANTS FOR 'luis'@'localhost' USING 'rol_lectura';
SELECT @@activate_all_roles_on_login;

/* Sesiones de prueba, desde la terminal del equipo:

   # ana: privilegios por columna y vista como filtro
   docker exec -it <contenedor> mysql -uana -p'Ana_2026!'
     SELECT dni, nombre FROM demo.socio;      -- funciona
     SELECT cuota FROM demo.socio;            -- ERROR 1143 (columna)
     DELETE FROM demo.socio;                  -- ERROR 1142 (tabla)
     SELECT * FROM demo.cuotas_madrid;        -- funciona: SQL SECURITY DEFINER

   # ana por TCP: entra como 'ana'@'%' y la clave de 'ana'@'localhost' no vale
   docker exec -it <contenedor> mysql -uana -p'Ana_2026!' -h127.0.0.1   -- ERROR 1045
   docker exec -it <contenedor> mysql -uana -p'Otra_2026!' -h127.0.0.1  -- CURRENT_USER() = ana@%

   # luis: el rol no está activo hasta SET ROLE o SET DEFAULT ROLE
   docker exec -it <contenedor> mysql -uluis -p'Luis_2026!'
     SELECT CURRENT_ROLE();                   -- NONE
     SELECT COUNT(*) FROM demo.socio;         -- ERROR 1142
     SET ROLE 'rol_lectura';
     SELECT COUNT(*) FROM demo.socio;         -- funciona
   # como root: SET DEFAULT ROLE 'rol_lectura' TO 'luis'@'localhost';  y volver a conectar
*/
