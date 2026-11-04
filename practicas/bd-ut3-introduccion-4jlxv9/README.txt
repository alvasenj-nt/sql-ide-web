LABORATORIO MYSQL - INTRODUCCIÓN A LA HERRAMIENTA: CLUB DEPORTIVO

Este laboratorio sirve para tomar contacto con el entorno de MySQL Workbench
simulado. El servidor ya tiene precargada la base de datos club, con sus
tablas y datos de ejemplo.

Qué hay en el proyecto
- ejercicio1: recorrido guiado por los paneles del laboratorio y el
  diccionario de datos del servidor.
- ejercicio2: creación de la tabla sala en la base de datos club e inserción
  de datos de prueba.
- En cada ejercicio, enunciado.txt es de solo lectura y script.sql es el
  archivo editable que debes entregar.

Cómo se organiza la pantalla
1. Columna izquierda (Navigator):
   - SCHEMAS (arriba): árbol con las bases de datos del servidor. Despliega
     club y la carpeta Tables para ver las tablas, sus columnas (la llave
     marca la clave primaria; el rombo rojo, las claves ajenas), índices,
     claves ajenas (Foreign Keys) y restricciones CHECK. Un doble clic sobre
     club la activa como base de datos por defecto (igual que USE club;).
   - Information (abajo a la izquierda): al hacer clic en una tabla o columna
     de SCHEMAS, muestra aquí su motor de almacenamiento (InnoDB) y el tipo de
     cada columna.

2. Zona derecha (dividida de arriba abajo en tres bloques):
   - Pestañas de archivos y área de código (arriba): en la fila superior verás
     una pestaña por cada archivo (README.txt, ejercicio1/enunciado.txt,
     ejercicio1/script.sql, etc.). Haz clic en una pestaña para abrir ese
     archivo en el cuadro de texto que hay justo debajo. En los archivos .sql,
     las líneas que empiezan por dos guiones y un espacio ("-- ") son
     comentarios que el servidor ignora; para descomentar una línea basta con
     borrar esos dos guiones iniciales.
   - Cuadrícula de resultados (Result Grid, en medio): justo debajo del cuadro
     de código. Cuando ejecutas consultas que devuelven datos (SELECT, SHOW,
     DESCRIBE), aparece aquí una pestaña por cada consulta (Result 1,
     Result 2...) con la tabla de filas devueltas.
   - Panel inferior (Action Output, abajo del todo): tiene dos pestañas:
     * Output: añade una fila por cada sentencia ejecutada, con un icono verde
       (correcta) o rojo (error), la sentencia, el mensaje de MySQL y el
       tiempo. Si haces clic en una fila, el cursor salta a esa línea arriba.
     * Comprobaciones: muestra qué requisitos del ejercicio se cumplen al
       pulsar el botón Comprobar.

Botones de la barra superior
- Ejecutar (icono del rayo, Ctrl+Mayús+Intro): reinicia el servidor al estado
  inicial de la práctica y ejecuta el archivo script.sql abierto completo
  desde la primera línea. Se detiene si encuentra un error.
- Sentencia (icono del rayo con cursor, Ctrl+Intro): ejecuta únicamente la
  sentencia donde está colocado el cursor (o el texto seleccionado) sobre el
  estado actual del servidor, sin reiniciarlo.
- Comprobar: ejecuta tu script.sql desde el estado inicial y verifica los
  requisitos del ejercicio en la pestaña Comprobaciones (abajo).
- Reiniciar servidor devuelve la base de datos a su estado inicial; Restaurar
  plantilla devuelve el script abierto a su texto original (borrando tus
  cambios).
- Pantalla completa amplía el laboratorio; Esc vuelve al cuestionario.
- Tus cambios se guardan automáticamente en el navegador mientras escribes.

Entrega
- Abre el script.sql del ejercicio, pulsa "Copiar código" en la barra superior
  y pega el resultado en la caja de respuesta de ese ejercicio en el
  cuestionario de Moodle. Cada vez que pegues, sustituye todo lo anterior.
- No borres la última línea "Informe del entorno" que se añade al copiar.
- Responde también a las tres preguntas tipo test del cuestionario.
