# Mi Rifa

Sistema en español para vender una rifa de 1000 boletos, organizar vendedores y premios, y realizar el sorteo en una pantalla pública animada.

Para desplegar en un servidor, consulta la [guía de producción](docs/PRODUCTION.md): dominio, HTTPS, configuración privada, autorización de Google y traslado de datos.

## Iniciar con Docker

1. Ejecuta `cp .env.example .env` y define `POSTGRES_PASSWORD`, `ADMIN_PIN` y `SELLER_PIN`. Los dos PIN deben ser distintos y tener exactamente seis dígitos.
2. La plantilla selecciona `COMPOSE_FILE=compose.prod.yaml`, con `HTTP_BIND_ADDRESS=127.0.0.1` y `HTTP_PORT=3008`. Este stack levanta la aplicación, PostgreSQL y, si lo habilitas, el sincronizador de Sheets.
3. Ejecuta `docker compose -f compose.prod.yaml up -d --build`.
4. Comprueba desde el host `http://127.0.0.1:3008`. Tu proxy reverso puede apuntar a esa dirección y encargarse del dominio y HTTPS; este Compose no usa los puertos 80/443.

Para cambiar el puerto, edita `HTTP_PORT` en `.env` y vuelve a ejecutar el comando. Para producción, configura `GOOGLE_OAUTH_REDIRECT_URI` con la URL HTTPS pública cuando tengas el dominio. La [guía de producción](docs/PRODUCTION.md) explica cómo cambiar desde el stack anterior conservando los volúmenes.

El archivo `compose.yaml` conserva la variante opcional con Caddy; selecciónalo explícitamente solo si quieres que este proyecto gestione HTTPS. Para el proxy del host utiliza únicamente `-f compose.prod.yaml`, sin combinar ambos archivos con dos opciones `-f`.

La página inicial pide un PIN para vendedores o administración. Los vendedores se registran con un nombre y reciben 50 boletos de cupo; pueden seleccionar cualquier número disponible. El administrador gestiona vendedores, precios corregidos, participantes y premios. El sorteo público está en `/live` y los enlaces de participantes se crean al registrar sus boletos.

Cada enlace de comprador (`/p/...`) abre una página personal sin pedir PIN, con sus números, una galería de los premios configurados en Administración y sus resultados. Las fotos se muestran completas y, si no hay imagen, aparece una ilustración de regalo. Las compras grandes permiten desplegar todos los boletos. Los enlaces ya compartidos reciben este diseño automáticamente al actualizar la aplicación.

No se registran cobros. «Total vendido» es la suma de los precios asignados a boletos vigentes, no dinero recibido.

## Uso del sorteo

Configura los premios y sus extracciones en Administración. En «Sorteo», pulsa «Cerrar ventas e iniciar sorteo». Desde ese momento no se pueden registrar ni corregir ventas. Pulsa «Sacar número» una vez por extracción. Las extracciones anteriores a la última eliminan esos boletos de toda la rifa. La última asigna el premio y excluye los demás boletos del ganador para los siguientes premios. Un premio pendiente puede reducir su cantidad de extracciones si quedan pocos boletos elegibles.

La pantalla del sorteo consulta el resultado cada segundo y la página del comprador cada tres segundos. Los números se revelan cuatro segundos después de seleccionarse; los premios del comprador respetan ese mismo momento de revelación. Una recarga no repite ni cambia la extracción.

## Datos y mantenimiento

PostgreSQL y las imágenes de premios tienen volúmenes persistentes de Docker. La variante con Caddy conserva además sus certificados en volúmenes propios. `docker compose down` conserva esos volúmenes; **`docker compose down -v` los borra**. Antes de actualizar, guarda la base de datos y las imágenes:

```bash
umask 077
mkdir -p backups
docker compose exec -T db pg_dump -U rifa -d rifa -Fc > backups/rifa-backup.dump
docker compose cp app:/app/uploads/. ./backups/premios-respaldo
```

Para restaurar en la misma instalación, detén la aplicación, restaura la base de datos y copia las imágenes antes de abrir el sitio:

```bash
docker compose stop app sheets-sync
docker compose exec -T db pg_restore -U rifa -d rifa --clean --if-exists < backups/rifa-backup.dump
docker compose up -d app
docker compose cp ./backups/premios-respaldo/. app:/app/uploads
docker compose up -d
```

Para actualizar el código en producción, ejecuta `docker compose -f compose.prod.yaml up -d --build`; las migraciones pendientes se aplican al arrancar la aplicación. Puedes ver el estado con `docker compose ps` y los registros con `docker compose logs -f app`.

## Desarrollo

Requiere Node.js 24 y PostgreSQL 18. Define las variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `ADMIN_PIN` y `SELLER_PIN`, ejecuta `npm ci`, `npm run db:migrate` y `npm run dev`. Comprueba tipos con `npm run typecheck` y genera cambios de esquema con `npm run db:generate`.

`npm test` comprueba importes, PIN, cifrado y generación de la copia de Sheets. Las pruebas de integración (`npm run test:integration`) crean ventas y completan un sorteo: ejecútalas únicamente contra una instalación de prueba recién inicializada, con `TEST_BASE_URL`, `ADMIN_PIN` y `SELLER_PIN`. `npm run test:ui` comprueba las vistas móviles con Chromium instalado, sobre una instalación de prueba que ya tenga ventas.

`npm run test:participant` verifica la página del comprador en móvil y escritorio, imágenes ausentes, compras grandes, ganadores y recuperación de conexión. Usa Chromium y respuestas simuladas sin modificar la base de datos. Define `TEST_BASE_URL` para apuntar a la app en ejecución y, opcionalmente, `SCREENSHOT_DIR` para guardar capturas.

El teléfono identifica a cada participante en toda la rifa. Se aceptan números internacionales como `+593991234567` y números ecuatorianos como `0991234567`. No hay verificación por SMS. Quien conoce el PIN común de vendedores puede elegir cualquier perfil; el PIN de administración debe ser distinto.

## Google Sheets con tu aplicación OAuth

La copia es unidireccional: PostgreSQL → Google Sheets. La hoja contiene **Ventas** (una fila por detalle de venta, incluidas anulaciones) y **Resumen por vendedor** (solo boletos vigentes). Corregir el nombre, teléfono, precio o comprador desde la app actualiza la copia. Si un número anulado vuelve a venderse, conserva dos registros diferentes. Las pestañas se administran desde la app: escribe notas propias en otra pestaña.

### Configuración inicial

1. Crea una hoja privada en tu cuenta de Google y copia el identificador de su URL en `GOOGLE_SHEETS_ID`. El proceso crea las dos pestañas si faltan.
2. En [Google Cloud](https://console.cloud.google.com/apis/credentials), usa tu cliente OAuth de tipo **Aplicación web** y habilita **Google Sheets API** en su proyecto. Conserva las URLs de otras aplicaciones que utilicen ese cliente.
3. Añade una URI de redirección autorizada que termine en `/api/admin/sheets/oauth/callback`. Para probar localmente con el puerto predeterminado: `http://localhost:3008/api/admin/sheets/oauth/callback`. Para un dominio público: `https://rifa.tudominio.com/api/admin/sheets/oauth/callback`. La URI debe coincidir exactamente con `GOOGLE_OAUTH_REDIRECT_URI`.
4. Configura `.env` con `GOOGLE_AUTH_MODE=oauth`, `GOOGLE_SHEETS_ENABLED=true`, `COMPOSE_PROFILES=sheets`, `GOOGLE_SHEETS_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `GOOGLE_OAUTH_REDIRECT_URI`.
5. Genera `GOOGLE_TOKEN_KEY` una sola vez con `openssl rand -hex 32` y guarda ese valor de 64 caracteres en `.env`. Protege y respalda `.env`: esta clave permite descifrar la autorización guardada en PostgreSQL. Si se pierde o cambia, habrá que conectar Google nuevamente.
6. Ejecuta `docker compose -f compose.prod.yaml up -d --build` y entra con el PIN de administración. Abre **Google Sheets → Conectar Google**, elige la cuenta propietaria de la hoja y autoriza el permiso de Sheets. Volverás al panel y comenzará la primera copia.

El Client Secret permanece en el servidor. El token de renovación se guarda cifrado con AES-256-GCM. El retorno de Google verifica un estado de un solo uso, una cookie temporal, la sesión administrativa original y PKCE; el PIN de los vendedores no participa en esa conexión.

Google limita la duración de los tokens de renovación de aplicaciones externas en estado **Testing** a siete días cuando se solicita acceso a Sheets. Para funcionamiento continuo, configura la pantalla de consentimiento apropiadamente y cambia la aplicación a **In production**. Si permaneces en pruebas, añade tu cuenta como usuario de prueba y vuelve a autorizar cuando sea necesario. Consulta la [documentación de autorización de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

### Operación

- El servicio `sheets-sync` revisa los pendientes cada 15 segundos y publica ambas pestañas en una petición por lotes. Conserva el pendiente en la misma transacción de PostgreSQL que modifica los datos.
- Si Google falla, las ventas continúan. Los reintentos tienen espera creciente hasta cinco minutos. Reiniciar el proceso conserva los pendientes; repetir una escritura no agrega filas duplicadas.
- Una revisión cada diez minutos repara cambios manuales en las pestañas administradas. Se conserva cualquier pestaña adicional.
- El panel muestra conexión, última copia, pendientes y errores resumidos; **Sincronizar ahora** solicita una revisión nueva. La copia se considera completada únicamente cuando Google confirma su publicación.
- `docker compose logs -f sheets-sync` muestra la actividad sin imprimir tokens ni datos de participantes. Puedes detener temporalmente la copia con `docker compose stop sheets-sync`.
- Para desactivar la integración en otra instalación, usa `GOOGLE_SHEETS_ENABLED=false` y deja `COMPOSE_PROFILES` vacío. Si ya estaba iniciado el sincronizador, detenlo antes. Las ventas siguen funcionando.
- Al restaurar PostgreSQL, detén también el sincronizador y conserva la misma `GOOGLE_TOKEN_KEY`. El respaldo de PostgreSQL sigue siendo necesario: la hoja es una copia de ventas y no permite reconstruir sesiones, auditoría o todo el sorteo.

También se admite `GOOGLE_AUTH_MODE=service_account`: monta la credencial en `secrets/service-account.json`, comparte la hoja como editora con su `client_email` y activa el perfil `sheets`. Ese modo no necesita Client Secret OAuth, clave de cifrado ni consentimiento desde el panel. El JSON se monta de solo lectura y no se incorpora a la imagen.

### PIN y migración

Se aceptan ceros iniciales; los PIN se procesan como texto. Cinco intentos incorrectos por IP y rol bloquean el acceso durante diez minutos. Los bloqueos viven en PostgreSQL y sobreviven a un reinicio. La migración inicial cierra las sesiones anteriores. Cambiar un PIN en `.env` y recrear `app` invalida las sesiones de ese rol. Cambiar un PIN no afecta las ventas ni la autorización de Google.

### Pruebas de Sheets

`npm run test:sheets` necesita una base aislada y `TEST_ALLOW_DESTRUCTIVE=1`. Define `TEST_BASE_URL`, las variables `PG*`, los PIN y una configuración OAuth **ficticia** equivalente en el servidor de pruebas. Comprueba bloqueo persistente, permisos, OAuth/PKCE y rechazo de retornos repetidos; las pruebas de sincronización usan PostgreSQL real y un transporte de Google simulado para forzar errores, escrituras sin confirmación y cambios concurrentes. No solicita tokens reales a Google.

`npm run test:integration` verifica las ventas y el sorteo; `npm run test:ui` comprueba también el panel de Sheets en móvil. Estas pruebas modifican datos: no deben ejecutarse contra la rifa que estés usando.
