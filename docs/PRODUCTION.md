# Poner Mi Rifa en producción

Usa `compose.prod.yaml` para ejecutar Next.js, PostgreSQL y el sincronizador opcional de Sheets detrás de tu proxy reverso en la máquina host. Publica únicamente `127.0.0.1:3008` de forma predeterminada; no levanta Caddy ni ocupa los puertos 80/443.

Necesitas Docker Engine con Docker Compose v2 o posterior, Git y acceso al repositorio. El dominio y el certificado HTTPS los configuras en tu proxy del host. La aplicación puede arrancar antes de configurar el dominio.

## Cambiar desde el stack anterior sin perder datos

El error `failed to bind host port ...:443` corresponde al servicio `web` de Caddy. Desde la misma carpeta y conservando el mismo nombre de proyecto que ya utilizabas:

```bash
git pull --ff-only origin master
docker compose -f compose.yaml stop web
docker compose -f compose.prod.yaml up -d --build --remove-orphans
```

`stop web` detiene únicamente el Caddy de este proyecto. `--remove-orphans` retira ese contenedor al usar el nuevo archivo. Los nombres `postgres_data` y `prize_uploads` se mantienen, por lo que se reutilizan los datos del proyecto actual. No uses `down -v` ni cambies `COMPOSE_PROJECT_NAME` durante esta transición.

Deja también en tu `.env`:

```dotenv
COMPOSE_FILE=compose.prod.yaml
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=3008
```

Así los siguientes comandos `docker compose` sin `-f` usarán el archivo de producción. No combines `compose.yaml` y `compose.prod.yaml` como archivos superpuestos: el segundo ya reutiliza los servicios necesarios mediante `extends`.

## 1. Descargar el proyecto

Configura en el servidor una clave SSH con acceso de lectura al repositorio, por ejemplo una deploy key de GitHub, y ejecuta:

```bash
git clone --branch master git@github.com:Xfirepc/rifa.git rifa
cd rifa
```

Si quieres trasladar ventas, participantes, premios o la autorización de Google que ya existen, sigue primero la sección **Trasladar una instalación existente**. Clonar el código no copia esos datos.

## 2. Configurar una instalación nueva

En la carpeta recién clonada:

```bash
umask 077
cp .env.example .env
chmod 600 .env
mkdir -p secrets backups
chmod 700 secrets backups
nano .env
```

Completa estas variables. Los valores entre `<...>` son instrucciones y deben sustituirse:

```dotenv
COMPOSE_PROJECT_NAME=rifa
COMPOSE_FILE=compose.prod.yaml
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=3008
POSTGRES_PASSWORD='<contraseña aleatoria larga>'
ADMIN_PIN='<seis dígitos>'
SELLER_PIN='<otros seis dígitos>'

GOOGLE_SHEETS_ENABLED=true
COMPOSE_PROFILES=sheets
GOOGLE_AUTH_MODE=oauth
GOOGLE_SHEETS_ID='<identificador de tu hoja>'
GOOGLE_OAUTH_CLIENT_ID='<client_id del JSON de Google>'
GOOGLE_OAUTH_CLIENT_SECRET='<client_secret del JSON de Google>'
GOOGLE_OAUTH_REDIRECT_URI=https://rifa.tudominio.com/api/admin/sheets/oauth/callback
GOOGLE_TOKEN_KEY='<64 caracteres hexadecimales>'
```

- El servicio HTTP queda disponible en `http://127.0.0.1:3008` para el proxy del host. `SITE_ADDRESS` y `HTTPS_PORT` no intervienen en este Compose.
- Los dos PIN deben ser distintos y contener exactamente seis dígitos; pueden comenzar con cero.
- Para generar una contraseña de PostgreSQL, usa `openssl rand -hex 32`. Ejecuta el comando otra vez para generar una **clave diferente** para `GOOGLE_TOKEN_KEY`. Esa segunda clave se genera una sola vez por instalación y se conserva en actualizaciones y restauraciones.
- Las comillas simples en `.env` preservan caracteres literales, incluido `$`; no ejecutes `.env` como un script de shell.
- `COMPOSE_PROJECT_NAME=rifa` mantiene el nombre de los volúmenes independiente de la carpeta. No cambies el nombre del proyecto de una instalación que ya tenga datos sin migrar sus volúmenes. [Nombre de proyecto en Compose](https://docs.docker.com/compose/how-tos/environment-variables/envvars/#compose_project_name).
- Puedes comenzar sin Sheets con `GOOGLE_SHEETS_ENABLED=false` y `COMPOSE_PROFILES=`; en ese caso no necesitas configurar las variables de Google para vender.

## 3. Configurar Google para el dominio público

En el proyecto de Google Cloud de tu cliente OAuth:

1. Habilita **Google Sheets API**.
2. En el cliente de tipo **Aplicación web**, añade exactamente esta URI de redirección autorizada, sustituyendo el dominio:

   ```text
   https://rifa.tudominio.com/api/admin/sheets/oauth/callback
   ```

3. Conserva las URI de otras aplicaciones que utilicen ese cliente, como n8n, y la de localhost si seguirás haciendo pruebas.
4. Configura la pantalla de consentimiento para el uso previsto. En aplicaciones externas con estado **Testing**, los tokens de renovación con permiso de Sheets caducan a los siete días. Para uso continuo, cambia el estado a **In production** y completa los requisitos de Google que correspondan. [Caducidad de las autorizaciones de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

No necesitas registrar cuentas de Google para los vendedores. Solo el administrador autoriza la copia de la hoja.

## 4. Arrancar

```bash
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps
curl --fail http://127.0.0.1:3008/api/public/draw
```

Las migraciones se ejecutan al arrancar `app`. Espera a que `db` y `app` aparezcan como `healthy`. Si habilitaste Sheets, `sheets-sync` debe estar en ejecución. No hay servicio `web` en este archivo.

Cuando tu proxy y dominio estén configurados, abre `https://rifa.tudominio.com`, ingresa con el PIN de administrador y ve a **Google Sheets → Conectar Google**. Elige una cuenta con permiso de edición sobre la hoja y acepta el permiso. El panel mostrará la fecha de la primera copia cuando se complete. El ID y el Client Secret por sí solos no sustituyen este consentimiento inicial.

Si algo falla:

```bash
docker compose -f compose.prod.yaml logs --tail=100 app sheets-sync
```

No pegues la salida de `docker compose config` sin `--quiet`: puede mostrar las variables privadas. Los miembros con acceso al servidor o a Docker pueden leer las variables de los contenedores.

## Conectar tu proxy reverso del host

El upstream es `http://127.0.0.1:3008`. Conserva el host público y comunica el protocolo externo; reemplaza la cabecera de IP para que el límite de intentos de PIN reciba la dirección real del cliente. Ejemplo del bloque de reenvío en Nginx, dentro de tu servidor ya configurado con dominio y HTTPS:

```nginx
location / {
    proxy_pass http://127.0.0.1:3008;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 6m;
}
```

`X-Forwarded-Proto: https` permite que la aplicación marque sus cookies como seguras. `Host` y `X-Forwarded-Host` deben coincidir con el dominio del navegador para las solicitudes del panel. Sobrescribe `X-Forwarded-For` en el proxy de entrada; no preserves un valor arbitrario enviado por el visitante. [Cabeceras del proxy en Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header).

No necesitas publicar el puerto 3008 en Internet: el proxy del host lo alcanza por loopback. Cuando el dominio esté listo, cambia `GOOGLE_OAUTH_REDIRECT_URI` a su URL HTTPS, añádela en Google Cloud y ejecuta de nuevo `docker compose -f compose.prod.yaml up -d`.

## Qué ocurre con los secretos

| Dato o archivo | Dónde queda | Qué llevar a producción |
| --- | --- | --- |
| `.env` | Archivo privado del servidor, excluido de Git y del contexto de construcción | Copiarlo por SSH/SCP o crearlo en el servidor; permisos `600` |
| `secrets.json` | JSON original descargado de Google, excluido de Git y Docker | En el modo OAuth actual no es necesario copiarlo: sus campos `web.client_id` y `web.client_secret` se configuran en `.env` |
| Client Secret, PIN y contraseña de PostgreSQL | Variables privadas que Compose entrega a los servicios | Conservarlas fuera del repositorio y proteger su respaldo |
| `GOOGLE_TOKEN_KEY` | `.env`; clave de cifrado de la autorización de Google | Conservar exactamente la misma si restauras la base existente |
| Token de renovación de Google | PostgreSQL, cifrado con AES-256-GCM | Viaja dentro del respaldo de la base; requiere la misma clave de cifrado y el mismo cliente OAuth |
| `backups/`, `*.dump`, `premios-respaldo/` | Respaldos locales excluidos de Git y Docker | Transferirlos por un canal privado y guardar una copia fuera del servidor |
| `.env.example` | Plantilla sin credenciales, incluida en Git | Sirve para crear una instalación nueva |

El cifrado protege el token almacenado en PostgreSQL; `.env` es texto plano con acceso restringido por permisos del sistema. No se usan GitHub Actions para desplegar este proyecto, por lo que no necesitas configurar GitHub Secrets para ejecutar el stack directamente en un servidor.

Si pierdes `GOOGLE_TOKEN_KEY`, las ventas siguen guardadas, pero debes generar una clave nueva y volver a conectar Google. Cambiar la contraseña de PostgreSQL en `.env` no cambia automáticamente la contraseña de un usuario que ya existe en un volumen: en una migración conserva la contraseña actual o realiza una rotación explícita en PostgreSQL.

## Trasladar una instalación existente

No ejecutes la instalación nueva completa antes de restaurar: estos pasos parten de una base de destino vacía. Mantén el código actualizado con la versión que generó el respaldo.

### En la instalación de origen

Detén las ventas y el sincronizador para obtener un respaldo consistente entre datos e imágenes. Si el origen usa Caddy, detén también su servicio `web` con `docker compose -f compose.yaml stop web`. Mantén PostgreSQL encendido:

```bash
docker compose stop app sheets-sync
umask 077
mkdir -p backups
docker compose exec -T db pg_dump -U rifa -d rifa -Fc > backups/rifa.dump
docker compose cp app:/app/uploads/. ./backups/premios
```

Transfiere `.env`, `backups/rifa.dump` y `backups/premios/` al servidor mediante SSH/SCP. Conserva `GOOGLE_TOKEN_KEY`, el cliente OAuth y la contraseña de la base de datos. Selecciona `COMPOSE_FILE=compose.prod.yaml`, conserva `HTTP_BIND_ADDRESS=127.0.0.1` y `HTTP_PORT=3008`, y cambia `GOOGLE_OAUTH_REDIRECT_URI` para el dominio público. Añade la URI pública en Google Cloud.

No vuelvas a iniciar el sincronizador de origen contra la misma hoja cuando producción tome el control: cada instancia reemplaza la copia completa y podrían sobrescribirse. Para pruebas simultáneas usa otra hoja o deja detenido `sheets-sync` local.

### En el servidor de destino

Con el repositorio clonado y `.env` ya transferido y adaptado:

```bash
chmod 600 .env
docker compose up -d db
docker compose ps db
```

Espera a que PostgreSQL esté `healthy`. Restaura únicamente en la base de destino vacía:

```bash
docker compose exec -T db pg_restore -U rifa -d rifa --no-owner --no-privileges --exit-on-error < backups/rifa.dump
docker compose up -d --build app
docker compose cp ./backups/premios/. app:/app/uploads
docker compose up -d
docker compose ps
```

Si la autorización de Google del origen sigue vigente, su token cifrado se restauró y conservaste la misma clave y cliente OAuth, el sincronizador podrá reutilizarla. De lo contrario, entra al nuevo dominio y pulsa **Conectar Google**.

## Actualizar y respaldar

Antes de actualizar, guarda la base, las imágenes y una copia protegida de `.env`. Luego, desde la misma carpeta y con el mismo nombre de proyecto:

```bash
git pull --ff-only origin master
docker compose -f compose.prod.yaml up -d --build
docker compose ps
```

`git pull` no modifica `.env` porque no está versionado. Revisa las nuevas variables de `.env.example` en cada actualización sin reemplazar tu configuración privada.

Los datos persisten en los volúmenes de Docker. **`docker compose down -v` borra esos volúmenes**; no lo uses para actualizar o reiniciar producción. La hoja de Sheets es una copia de ventas y no reemplaza un respaldo de PostgreSQL con participantes, premios, sorteo y auditoría.
