/* Ejercicio 2: tabla de reservas y relación con apartamentos.
   1. Copia aquí la creación de la base de datos alojamientos y de la tabla
      apartamento que hiciste en el ejercicio 1.
   2. Añade debajo la creación de la tabla reserva según ejercicio2/enunciado.txt.
   No borres los INSERT ni los SELECT del final. */




-- Datos de prueba (no modificar):
INSERT INTO apartamento (codigo, nombre, telefono_contacto, plazas, precio_noche) VALUES
  ('APT001', 'Sol Centro', '+34 600 111 222', 4, 85.50);

INSERT INTO apartamento (codigo, nombre, telefono_contacto, precio_noche) VALUES
  ('APT002', 'Mirador Norte', '0034910223344', 120.00);

INSERT INTO reserva (codigo_apartamento, fecha_entrada, dni_huesped, fecha_salida, regimen, importe_total, descuento) VALUES
  ('APT001', '2026-12-01', '11111111A', '2026-12-05', 'desayuno', 342.00, 20.00);

INSERT INTO reserva (codigo_apartamento, fecha_entrada, dni_huesped, fecha_salida, importe_total, descuento) VALUES
  ('APT002', '2026-12-10', '22222222B', '2026-12-12', 240.00, NULL);

SELECT * FROM apartamento;
SELECT * FROM reserva;
