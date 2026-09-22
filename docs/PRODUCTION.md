# Poner Mi Rifa en producción

El stack contiene Next.js, PostgreSQL, Caddy y el sincronizador de Sheets. El servidor necesita Docker Engine con Docker Compose v2 o posterior, Git y acceso al repositorio. Un punto de partida razonable es 2 vCPU y 4 GB de RAM, especialmente si compilas la imagen en el mismo servidor; es una orientación, no una capacidad medida bajo carga.

Usa un dominio o subdominio, por ejemplo `rifa.tudominio.com`, con su registro DNS A apuntando al servidor. Si publicas un registro AAAA, debe apuntar también a una dirección IPv6 operativa. Los puertos TCP 80 y 443 deben llegar a Caddy y estar libres en el servidor. Esta guía supone que este stack recibe directamente el tráfico del dominio.

El puerto HTTP predeterminado del proyecto es `3008`, configurable con `HTTP_PORT` en `.env`. La configuración de producción de esta guía lo cambia explícitamente a `80` para recibir el tráfico público y emitir certificados con Caddy. Si mantienes `3008`, el tráfico público de los puertos necesarios debe reenviarse a Caddy según la configuración de tu red.

Caddy obtiene y renueva el certificado HTTPS cuando el dominio y los puertos están configurados. PostgreSQL y Next.js no publican puertos al exterior. [Requisitos de HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https#overview).

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
SITE_ADDRESS=rifa.tudominio.com
HTTP_PORT=80
HTTPS_PORT=443
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

- `SITE_ADDRESS` es el dominio, sin ruta ni prefijo `http://`.
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
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Las migraciones se ejecutan al arrancar `app`. Espera a que `db` y `app` aparezcan como `healthy`. `web` y `sheets-sync` deben estar en ejecución; si no habilitaste Sheets, el sincronizador no se inicia.

Abre `https://rifa.tudominio.com`, ingresa con el PIN de administrador y ve a **Google Sheets → Conectar Google**. Elige una cuenta con permiso de edición sobre la hoja y acepta el permiso. El panel mostrará la fecha de la primera copia cuando se complete. El ID y el Client Secret por sí solos no sustituyen este consentimiento inicial.

Si algo falla:

```bash
docker compose logs --tail=100 app web sheets-sync
```

No pegues la salida de `docker compose config` sin `--quiet`: puede mostrar las variables privadas. Los miembros con acceso al servidor o a Docker pueden leer las variables de los contenedores.

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

Detén las ventas y el sincronizador para obtener un respaldo consistente entre datos e imágenes. Mantén PostgreSQL encendido:

```bash
docker compose stop web app sheets-sync
umask 077
mkdir -p backups
docker compose exec -T db pg_dump -U rifa -d rifa -Fc > backups/rifa.dump
docker compose cp app:/app/uploads/. ./backups/premios
```

Transfiere `.env`, `backups/rifa.dump` y `backups/premios/` al servidor mediante SSH/SCP. Conserva `GOOGLE_TOKEN_KEY`, el cliente OAuth y la contraseña de la base de datos. Cambia `SITE_ADDRESS` y `GOOGLE_OAUTH_REDIRECT_URI` para el dominio público; para el acceso HTTPS directo de esta guía, configura también `HTTP_PORT=80` y `HTTPS_PORT=443`. Añade la URI pública en Google Cloud.

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
docker compose up -d web sheets-sync
docker compose ps
```

Si la autorización de Google del origen sigue vigente, su token cifrado se restauró y conservaste la misma clave y cliente OAuth, el sincronizador podrá reutilizarla. De lo contrario, entra al nuevo dominio y pulsa **Conectar Google**.

## Actualizar y respaldar

Antes de actualizar, guarda la base, las imágenes y una copia protegida de `.env`. Luego, desde la misma carpeta y con el mismo nombre de proyecto:

```bash
git pull --ff-only origin master
docker compose up -d --build
docker compose ps
```

`git pull` no modifica `.env` porque no está versionado. Revisa las nuevas variables de `.env.example` en cada actualización sin reemplazar tu configuración privada.

Los datos persisten en los volúmenes de Docker. **`docker compose down -v` borra esos volúmenes**; no lo uses para actualizar o reiniciar producción. La hoja de Sheets es una copia de ventas y no reemplaza un respaldo de PostgreSQL con participantes, premios, sorteo y auditoría.
