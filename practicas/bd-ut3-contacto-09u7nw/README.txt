LABORATORIO MYSQL - TOMA DE CONTACTO DE LA UT-3: RECETARIO

Este laboratorio sirve para conocer el entorno antes de las prácticas: es el
mismo que usaréis en las prácticas, el simulacro y el examen de la unidad.

Qué hay en el proyecto
- ejercicio1: tu primera base de datos. El enunciado te guía paso a paso
  por las partes del laboratorio.
- ejercicio2: un script con errores que tienes que hacer funcionar leyendo
  los mensajes de MySQL.
- En cada ejercicio, enunciado.txt es de solo lectura y script.sql es tu
  script, el archivo que se entrega.

Partes del laboratorio
- SCHEMAS (izquierda): las bases de datos del servidor. Se actualiza solo al
  crear o borrar bases de datos y tablas. Despliega una tabla para ver sus
  columnas (la llave marca la clave primaria; el rombo rojo, las claves
  ajenas), índices, claves ajenas y restricciones CHECK. Al seleccionar un
  objeto, el panel Information de debajo muestra sus detalles. Doble clic en
  una base de datos la selecciona, como USE.
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

Sobre el servidor del laboratorio
- No es un MySQL real: imita su comportamiento con las mismas reglas, tipos
  y mensajes de error. Admite CREATE y DROP DATABASE, USE, CREATE y DROP
  TABLE, INSERT, UPDATE, DELETE, SELECT, SHOW, DESCRIBE e
  information_schema.
- Si escribes algo que MySQL acepta pero el laboratorio no imita, lo verás en
  Output con el aviso "no está disponible en el laboratorio". No es un error
  de tu script.
- En las prácticas, la corrección se hace con un MySQL 8.0 real ejecutando tu
  script completo.

Entrega
- Pulsa "Copiar código" con el script.sql del ejercicio abierto y pega el
  resultado en la pregunta de ese ejercicio, en el cuestionario. Cada vez que
  pegues, sustituye todo lo anterior.
- No borres la línea final "Informe del entorno" que añade la copia.
