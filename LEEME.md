# ¿Cuándo caduca? — Guía de configuración

La app funciona sola nada más subirla a GitHub Pages, pero **solo en cada móvil por separado y sin avisos con el móvil cerrado**. Para tener la lista compartida y los avisos automáticos hay que hacer esta configuración, una sola vez (unos 20 minutos).

## Cómo encaja todo

- **Firebase (Firestore)** guarda las caducidades, la lista de la compra y los ajustes, y los comparte entre vuestros dos móviles.
- **GitHub Actions** ejecuta `avisos.mjs` cada 30 minutos. El script lee Firestore y, si toca un preaviso, lo envía a **ntfy**.
- **ntfy** es una app gratuita que hace llegar el aviso al móvil aunque la web esté cerrada.

Firebase por sí solo no puede enviar avisos programados sin pagar (hace falta el plan Blaze con tarjeta). Por eso el programador es GitHub Actions, que es gratis.

## 1. Subir los archivos a GitHub

En tu repositorio (el de GitHub Pages), deben estar:

| Archivo | Dónde |
|---|---|
| `index.html` | raíz del repositorio (sustituye al anterior) |
| `avisos.mjs` | raíz del repositorio |
| `avisos.yml` | en la ruta `.github/workflows/avisos.yml` |

Para el tercero: en GitHub pulsa **Add file → Create new file**, escribe en el nombre `.github/workflows/avisos.yml` (las barras crean las carpetas), pega el contenido de `avisos.yml` y pulsa **Commit changes**.

## 2. Crear el proyecto de Firebase

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google y pulsa **Crear un proyecto**. Ponle el nombre que quieras y desactiva Google Analytics.
2. En el menú **Compilación → Firestore Database** pulsa **Crear base de datos**. Elige una región europea y el modo **producción**.
3. Ve a la pestaña **Reglas**, borra lo que haya, pega esto y pulsa **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /homes/{home}/{coll}/{docId} {
      allow read, write: if true;
    }
  }
}
```

4. Pulsa el engranaje (**Configuración del proyecto**), baja hasta **Tus apps**, elige el icono web `</>`, ponle un nombre y regístrala. Te enseñará un bloque `const firebaseConfig = { ... }`. **Cópialo entero.**

### Sobre la seguridad

No hay usuarios ni contraseñas. Vuestros datos cuelgan de un código largo y aleatorio que genera la app (100 bits), y las reglas de arriba solo dejan entrar a quien lo conozca. Nadie puede listar los códigos de otros. Quien tenga vuestro código de conexión puede ver y cambiar la lista, así que no lo compartáis en público. Para una lista de la compra es suficiente.

## 3. Conectar la app

1. Abre la app en tu móvil → pestaña **Ajustes → Sincronización**.
2. Pega el bloque `firebaseConfig` y pulsa **Conectar**. La página se recarga y sube lo que ya tuvieras guardado.
3. Pulsa **Copiar código de conexión** y pásaselo a tu mujer (por WhatsApp, por ejemplo).
4. En su móvil: **Ajustes → Sincronización**, pega el código (empieza por `CAD1.`) y pulsa **Conectar**.

Desde ese momento caducidades y lista de la compra se actualizan solas en los dos móviles. Los preavisos de la pestaña Ajustes también son compartidos.

## 4. Avisos en el móvil (ntfy)

1. Instala la app **ntfy** en cada móvil (<https://docs.ntfy.sh/subscribe/phone/>).
2. En la app, **Ajustes → Avisos en el móvil** aparece vuestro canal (algo como `caduca-x7k2…`). Toca **Abrir en ntfy**, o añádelo a mano en la app ntfy con el botón «+».
3. Pulsa **Enviar aviso de prueba**. Si te llega la notificación, esta parte está lista.

Ojo: ntfy.sh es un servicio público y el nombre del canal funciona como contraseña. No lo compartas.

## 5. Activar el programador en GitHub

1. Copia otra vez el código de conexión (Ajustes → Sincronización → **Copiar código de conexión**).
2. En tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `CONEXION`
   - Secret: pega el código.
3. Ve a la pestaña **Actions**. Si te pide activar los workflows, acepta.
4. Elige **Avisos de caducidad → Run workflow** para probarlo. Debe terminar en verde. Si tienes algo que caduque dentro de tus preavisos, te llegará el aviso.

## 6. Configurar los preavisos

En **Ajustes → Preavisos** puedes añadir hasta 6, cada uno con «días antes» y hora. Ejemplos:

- `3` días antes a las `18:00`
- `1` día antes a las `09:00`
- `0` días (el mismo día) a las `08:00`

Los cambios se guardan solos y se aplican a todas las caducidades, incluidas las que ya tenías guardadas.

## Cosas que conviene saber

- **Retrasos:** GitHub ejecuta el programador «cada 30 minutos» de forma aproximada. Un aviso puede llegar con unos minutos de retraso, a veces más a horas de mucho tráfico.
- **Los 60 días:** en repositorios públicos, GitHub desactiva los workflows programados si pasan 60 días sin actividad en el repositorio. Te manda un correo y se reactiva con un clic en la pestaña Actions. Cualquier cambio en el repositorio también cuenta como actividad.
- **Productos añadidos tarde:** si guardas hoy algo que caduca mañana y tu preaviso de «1 día antes» era esta mañana a las 9:00, el aviso sale en la siguiente ejecución (siempre que hayan pasado menos de 18 horas).
- **Sin internet:** la app muestra la última copia guardada en el móvil. Los cambios hechos sin conexión se envían al reconectar mientras la página siga abierta.
- **Calendario:** los botones «Google Calendar» y «Archivo .ics» siguen funcionando. El .ics incluye alarmas con los mismos preavisos que tengas en Ajustes.
- **Coste:** Firebase (plan gratuito Spark), GitHub Actions en repositorio público y ntfy.sh son gratis para este uso.
