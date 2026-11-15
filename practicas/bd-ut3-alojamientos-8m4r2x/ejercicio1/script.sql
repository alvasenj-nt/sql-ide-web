/* Ejercicio 1: catálogo de apartamentos turísticos.
   Escribe aquí la creación de la base de datos alojamientos y de la tabla
   apartamento según ejercicio1/enunciado.txt.
   No borres los INSERT ni el SELECT del final: sirven para probar tu tabla. */




-- Datos de prueba (no modificar):
INSERT INTO apartamento (codigo, nombre, telefono_contacto, plazas, precio_noche) VALUES
  ('APT001', 'Sol Centro', '+34 600 111 222', 4, 85.50);

INSERT INTO apartamento (codigo, nombre, telefono_contacto, precio_noche) VALUES
  ('APT002', 'Mirador Norte', '0034910223344', 120.00);

SELECT * FROM apartamento;
