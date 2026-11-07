# Screech

Probá la [live preview gratuita y sin registro](https://voice.masivo.com.ar).

SPA mobile-first de audio grupal sobre LiveKit SFU, con SQLite. Requiere Node >=22.22.0. Redis está apagado por defecto y no es necesario para un único LiveKit.

## Desarrollo local sin Docker

1. Usar Node 22.22.0 (`nvm install && nvm use` si tienes nvm).
2. Copiar `.env.example` a `.env` y ejecutar `npm ci`.
3. Instalar el binario LiveKit 1.13.11. Para Linux x64:

   ```bash
   mkdir -p .local/bin
   curl -fL https://github.com/livekit/livekit/releases/download/v1.13.11/livekit_1.13.11_linux_amd64.tar.gz -o /tmp/screech-livekit.tar.gz
   tar -xzf /tmp/screech-livekit.tar.gz -C .local/bin livekit-server
   ```

   Para otro sistema, descargar el binario correspondiente de las releases oficiales y definir `LIVEKIT_BINARY` con su ruta.
4. `npm run build && npm run local`.
5. Abrir http://localhost:3001. Ctrl+C detiene API y LiveKit.

`npm run local` carga `.env`, arranca LiveKit y sirve la SPA junto a la API. Crea automáticamente `data/screech.sqlite`; no instala ni inicia PostgreSQL ni Redis. `SQLITE_PATH` permite cambiar la ruta. Los archivos SQLite y sus auxiliares WAL quedan fuera de Git y del contexto Docker.

Para editar la UI con recarga automática, ejecutar además `npm run dev -- --config web/vite.config.ts` y abrir http://localhost:5173. `npm run server` inicia solo la API, si LiveKit ya está ejecutándose. No ejecutar `server` y `local` simultáneamente en el mismo puerto.

El nombre del operador se conserva en localStorage y se reutiliza en otros canales. La vista del canal incluye un botón para mantener la pantalla encendida y mostrar el estado real de Wake Lock. El aviso de audio se cierra al habilitar correctamente la reproducción.

Los dispositivos empiezan en el predeterminado del sistema; la selección de salida depende del navegador. Al entrar al canal se intenta activar el micrófono y se solicita permiso del navegador cuando corresponde. El botón del footer permite silenciarlo o reintentar si el permiso fue rechazado. Para probar desde otro equipo, configurar `LIVEKIT_PUBLIC_URL` con una URL accesible desde ese navegador y servir la app mediante HTTPS.

## Acceso remoto con ngrok desde SSH

Instalar ngrok en `.local/bin/ngrok` (o definir `NGROK_BINARY`) y obtener el authtoken desde https://dashboard.ngrok.com/get-started/your-authtoken. Guardarlo en `.env` como `NGROK_AUTHTOKEN=...`, sin comillas adicionales si no son necesarias. No se ejecuta login OAuth, navegador ni callback a localhost. No versionar ni compartir el token.

Con los puertos 3001 y 7880 libres, ejecutar `npm run build && npm run ngrok`. El comando inicia el túnel, obtiene la URL HTTPS desde el inspector local de ngrok y arranca la aplicación con `LIVEKIT_PUBLIC_URL=wss://<dominio>/livekit`. La API publica un proxy HTTP/WebSocket de solo GET bajo `/livekit`; así web y señalización usan un único dominio. `NGROK_DOMAIN` permite usar un dominio asignado a tu cuenta (sin esquema). La configuración ngrok se guarda en `.local/ngrok.yml`, sin token; el agente recibe el token por entorno. Ctrl+C detiene los procesos iniciados. El inspector escucha solo en 127.0.0.1:4040; es comunicación entre procesos del servidor, no un callback del navegador remoto.

El túnel HTTPS/WSS no transporta los medios WebRTC. El SFU necesita acceso público a 7882/UDP o 7881/TCP, o TURN configurado; detrás de NAT hay que reenviar puertos o preparar TURN. El lanzador intenta anunciar la IP externa (`NGROK_USE_EXTERNAL_IP=true` por defecto), lo que no abre puertos ni elimina NAT. No considerar el audio validado solo porque la web abre con ngrok. Referencias: [WebSockets con ngrok](https://ngrok.com/docs/using-ngrok-with/websockets) y [puertos de LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

### Si aparece `could not establish pc connection`

La señalización puede funcionar y fallar la conexión ICE/DTLS de medios. Para este servidor en LAN, reenviar 7881/TCP y 7882/UDP desde el router público hacia 10.10.60.100, con reglas de firewall correspondientes, o usar un TURN externo accesible. Si los clientes también están en la LAN, `LIVEKIT_ADVERTISE_INTERNAL_IP=true` conserva candidatos internos además de la IP pública. No activar cambios de router automáticamente desde la aplicación.

Para anunciar un TURN externo desde LiveKit, configurar en `.env`:

```dotenv
TURN_HOST=turn.tu-dominio.com
TURN_PORT=443
TURN_PROTOCOL=tls
TURN_SHARED_SECRET=secreto-compartido-con-el-servidor-turn
```

Como alternativa al secreto compartido se admiten `TURN_USERNAME` y `TURN_CREDENTIAL`. El TURN debe existir y estar operativo: estas variables lo anuncian a los clientes, no lo instalan. Reiniciar el stack después de configurarlo. Preferir secreto compartido para generar credenciales temporales. TURN y Redis son independientes.

La cuenta ngrok de esta sesión rechazó la creación de un endpoint TCP con `ERR_NGROK_8013` (requiere verificar un medio de pago). Un túnel TCP adicional no se configura como sustituto directo de HTTPS: también requiere coordinar la dirección y puerto anunciados por ICE. El lanzador actual mantiene el túnel HTTPS y no afirma que los medios funcionen a través de él.

## Redis opcional

La configuración de LiveKit se genera desde las mismas variables tanto en local como en Docker:

```dotenv
REDIS_ENABLED=false
REDIS_ADDRESS=
REDIS_PASSWORD=
```

Para habilitar una instancia existente: `REDIS_ENABLED=true`, `REDIS_ADDRESS=host:6379` y, si corresponde, `REDIS_PASSWORD`. Reiniciar LiveKit después de cambiar estas variables. Si está apagado, se omite por completo la sección Redis. No se incluye un contenedor Redis ni se instala Redis localmente. La aplicación guarda canales y miembros en SQLite, independientemente de Redis.

## Desarrollo en Kubernetes

Deployment aplicado en `screech-dev` para `voice.masivo.com.ar`, siguiendo Traefik/MetalLB y Longhorn del clúster. Ver [manifiestos y pasos](infra/k8s/README.md). La API y LiveKit están desplegados; comprobar el acceso HTTPS del proxy externo y los puertos de medios antes de considerar validado el uso público.

## Producción con Docker

Usar `docker compose up -d --build` con `.env` configurado para el entorno. El compose ejecuta API y LiveKit; SQLite persiste en el volumen `database`, en `/app/data/screech.sqlite`. Mantener una única instancia de la API con este almacenamiento local. No hay migración automática desde una base PostgreSQL anterior.

Reemplazar las credenciales LiveKit de ejemplo, configurar `NODE_ENV=production` en `.env`, HTTPS/WSS mediante proxy con certificado confiable, `LIVEKIT_PUBLIC_URL=wss://...`, IP pública del SFU (`LIVEKIT_USE_EXTERNAL_IP=true` según la red) y TURN/TLS según la documentación oficial de LiveKit. El compose conserva los puertos 3001, 7880, 7881/TCP y 7882/UDP; adaptar firewall y proxy. El webhook usa automáticamente `http://app:3001/api/webhooks/livekit` en Docker y `http://127.0.0.1:3001/api/webhooks/livekit` en local; `LIVEKIT_WEBHOOK_URL` permite sobrescribirlo en local.

Micrófono, AudioWorklet y Wake Lock requieren HTTPS salvo localhost. Hacer backups consistentes de SQLite (considerando WAL o deteniendo la aplicación); no eliminar el volumen al actualizar. La configuración incluida necesita adaptar TLS/TURN al dominio de producción antes de publicarse.

## Verificación

Para probar la señalización con el SDK instalado contra el stack real: `node --import tsx scripts/check-signal.ts https://tu-dominio`. Este chequeo usa `/rtc/v1`, verifica una respuesta de unión válida y cierra la sesión; no prueba medios WebRTC. Mantener LiveKit 1.13.11 en local y Docker: el cliente actual 2.23.0 requiere la señalización moderna y no funcionaba con el servidor anterior 1.8.4.

`npm test`, `npm run check` y `npm run build`. La suite cubre rutas HTTP, sesiones, tokens, moderación, origen, rechazo de webhooks sin firma, persistencia SQLite tras reinicio, vencimiento y configuración Redis. Las pruebas automatizadas de rutas usan LiveKit simulado.

Validar dos navegadores, permisos, micrófono, dispositivos, VAD y PTT; después 32 participantes y rechazo del 33. Medir bitrate, CPU y red con Safari iOS y Chrome Android, incluidos Bluetooth y redes con TURN.

## Limitaciones pendientes

Los tokens emitidos antes de una expulsión pueden reutilizarse hasta vencer; el webhook retira esas sesiones después de conectar. La carga de 32 clientes y audio en dispositivos reales requiere validación. No se garantiza continuidad de audio en segundo plano ni actualización inmediata del nombre de una PWA instalada. `node:sqlite` emite una advertencia experimental en Node 22; se usa el módulo incluido sin instalar un servidor de base de datos.
