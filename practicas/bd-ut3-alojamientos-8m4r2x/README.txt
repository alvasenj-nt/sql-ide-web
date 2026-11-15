LABORATORIO MYSQL - CREACIÓN DE TABLAS Y RESTRICCIONES: ALOJAMIENTOS

Esta práctica cubre la creación de bases de datos y tablas, la elección de
tipos de datos, el tratamiento de valores nulos y las restricciones de clave
primaria, unicidad, obligatoriedad, valor por defecto, validación e integridad
referencial.

Qué hay en el proyecto
- ejercicio1: creación de la base de datos alojamientos y de la tabla
  apartamento. Los INSERT de prueba ya vienen escritos al final de script.sql.
- ejercicio2: ampliación del script del ejercicio 1 para añadir la tabla
  reserva enlazada con apartamento mediante clave ajena. Los INSERT de prueba
  de ambas tablas ya vienen escritos al final de script.sql.
- En cada ejercicio, enunciado.txt es de solo lectura y script.sql es tu
  script, el archivo que se entrega.

Partes del laboratorio
- SCHEMAS (izquierda): las bases de datos del servidor. Se actualiza solo al
  crear o borrar bases de datos y tablas. Despliega una tabla para ver sus
  columnas, índices, claves ajenas y restricciones CHECK. Al seleccionar un
  objeto, el panel Information de debajo muestra sus detalles.
- Editor (centro): una pestaña por archivo abierto. Ctrl+Espacio sugiere
  nombres de tablas y columnas; Ctrl+/ comenta líneas.
- Result: las filas que devuelve cada consulta, una pestaña por consulta.
- Output: una fila por sentencia ejecutada, con su hora, la sentencia, el
  mensaje que daría MySQL Workbench y la duración. Un clic en una fila lleva
  a su línea en el editor.

Botones
- Ejecutar (el rayo, Ctrl+Mayús+Intro): vacía el servidor y ejecuta tu script
  completo desde el principio, como en un servidor recién instalado. Se
  detiene en la primera sentencia con error; el botón del círculo rojo hace
  que continúe.
- Sentencia (el rayo con el cursor, Ctrl+Intro): ejecuta solo la sentencia
  donde está el cursor, o lo seleccionado, sobre el estado actual del
  servidor. Sirve para probar un INSERT o un SELECT sin repetir el script.
- Comprobar: ejecuta tu script desde cero y revisa los requisitos del
  enunciado. El resultado aparece en la pestaña Comprobaciones.
- Reiniciar servidor deja el servidor vacío; Restaurar plantilla devuelve el
  script a su contenido inicial (perderás tus cambios).
- Pantalla completa amplía el laboratorio; Esc vuelve al cuestionario.
- Tu código se guarda solo en este navegador mientras trabajas.

Entrega
- Pulsa "Copiar código" con el script.sql del ejercicio abierto y pega el
  resultado en la pregunta de ese ejercicio, en el cuestionario. Cada vez que
  pegues, sustituye todo lo anterior.
- Responde después a las cinco preguntas tipo test del cuestionario, que
  preguntan sobre lo trabajado en los dos ejercicios.
- No borres la línea final "Informe del entorno" que añade la copia.
