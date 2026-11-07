# Desarrollo en Kubernetes

Contexto usado: `kubernetes-admin@kubernetes`. Namespace `screech-dev`. Host solicitado: **voice.masivo.com.ar**. Se sigue el esquema existente de coffee-api/authsrv: `IngressRoute` Traefik, TLS con resolver `letsEncrypt`, Service **LoadBalancer** MetalLB y credencial de registro `regcred`. El watcher del Traefik externo solo publica servicios LoadBalancer; no instalar otro ingress controller.

## Construir y desplegar

Desde la raíz del proyecto, revisar primero `kubectl config current-context`.

```bash
kubectl apply -f infra/k8s/namespace.yaml
python3 scripts/k8s-build.py --image registry.dumont.com.ar:5000/screech:TU_TAG_UNICO
kubectl logs -f -n screech-dev job/NOMBRE_QUE_IMPRIME_EL_SCRIPT -c build
kubectl wait -n screech-dev --for=condition=complete job/NOMBRE_QUE_IMPRIME_EL_SCRIPT --timeout=1200s
python3 scripts/k8s-deploy.py --image registry.dumont.com.ar:5000/screech:TU_TAG_UNICO
```

El build usa el Dockerfile del repositorio dentro de un Job, sin daemon Docker local. La imagen contiene API/SPA y binario LiveKit 1.13.11; los dos deployments usan la misma imagen. El builder Kaniko fijado a v1.23.2 se usa para este entorno de desarrollo; evaluar su sustitución por un builder mantenido para la cadena de producción. Job y ConfigMap de fuentes se eliminan mediante TTL/ownerReference después de una hora. La fuente subida excluye `.env`, bases de datos y binarios locales.

El registro es HTTP privado. Los nodos ya tienen resolución e insecure-registry configurados para `registry.dumont.com.ar:5000` (10.10.50.13). El builder usa un hostAlias porque ese nombre no resuelve por DNS. `regcred` se copia de coffee-api-dev sin imprimir ni persistir su contenido en archivos. No hace falta aportar otra API key mientras esa credencial permita el push.

El deploy crea un secreto LiveKit aleatorio solo si no existe; nunca lo reemplaza al redesplegar. No importar el `.env` de ngrok al clúster. Configuración no secreta en `screech-config`; credenciales en `screech-livekit`. Redis queda apagado. Para TURN, añadir las variables TURN_* al Secret y reiniciar LiveKit. No exponer claves en manifiestos versionados.

## Persistencia y red

- API: una réplica, estrategia Recreate y PVC RWO de 1 Gi con clase Longhorn, montado en `/app/data`. SQLite se conserva al reemplazar pods. No borrar el PVC durante actualizaciones; hacer backup antes de cambios de formato. Es una base nueva de desarrollo; no se copiaron canales de la ejecución local.
- LiveKit: una réplica, Recreate, hostNetwork y nodo fijo `kube-lab-node1` (10.10.60.108). Medios en **7881/TCP y 7882/UDP**. DNS ClusterFirstWithHostNet. `enableServiceLinks: false` evita que Kubernetes inyecte LIVEKIT_PORT=tcp://... y rompa el parser del binario.
- Señalización: navegador → HTTPS/WSS `voice.masivo.com.ar/livekit` → Traefik → Service screech → proxy GET WebSocket → Service livekit:7880.
- Publicación: IngressRoute CRD con anotación `traefik.e2e/host` y resolver `letsEncrypt`. MetalLB asignó **10.10.60.212** a screech. Esa IP es el backend HTTP, no el destino de medios.
- Para clientes fuera de la LAN, la red necesita reenviar 7881/TCP y 7882/UDP hacia **10.10.60.108**, o proporcionar TURN. El ingress HTTPS no transporta WebRTC. Se anuncian candidatos internos para clientes de LAN y externos mediante STUN.

## Verificación y estado inicial

```bash
kubectl get pods,pvc,services -n screech-dev
kubectl logs -n screech-dev deployment/livekit --tail=30
curl http://10.10.60.212/api/config
node --import tsx scripts/check-signal.ts http://10.10.60.212 ws://10.10.60.212/livekit
curl https://voice.masivo.com.ar/api/config
```

Imagen inicial: `registry.dumont.com.ar:5000/screech:dev-20261107-01`, digest `sha256:8357824d3435a98d0fc46e56108fe14e66b27d94ecb14a8727ebb8416c7723c6`.

Se verificaron pods Ready, PVC Bound, API HTTP y unión de señalización real por SDK contra la VIP. También se reemplazó el pod de la API y se comprobó que el canal creado seguía en SQLite, validando el volumen persistente. La comprobación de HTTPS público dio timeout, igual que 10.10.50.13:80/443 desde el host y desde el pod; no se pudo validar el certificado ni el watcher externo. El DNS público resuelve a 24.232.164.103. No se modificó el host externo de producción. Falta validar el borde/ruteo y probar audio desde un navegador remoto; desplegar en Kubernetes por sí solo no resuelve NAT.

Actualización de la API/web: imagen `dev-20261107-02`, digest `sha256:20351d5b8b1c1ff434c2b2d7908016c9ee83e2c63dd0922de88022a05dfb8632`, corrige la fuente microphone al publicar el audio del AudioWorklet. Validada en navegador con audio simulado contra el servicio real del clúster. LiveKit conserva imagen01 porque el cambio es únicamente de frontend.

Actualización de API/web `dev-20261107-03` (digest `sha256:7549879fc5bb98947ad3e53e74e7d684e0a848236aa77fd781d2b1d4c0bd187e`): restaura automáticamente el canal de la URL al recargar, tras validar que existe. Canal vencido/inexistente vuelve a home; errores temporales conservan el código. Verificado en navegador.

Actualización API/web `dev-20261107-04` (digest `sha256:416c934e7bd1871e127224763b494f0eba9f65051c2051073b4239ab0281306c`): botón «Copiar enlace» a la derecha del ID del canal, con URL directa y confirmación. Portapapeles y disposición a320/390/1024px verificados en navegador.

Actualización API/web `dev-20261107-06` (digest `sha256:b8a1b29ad4ac4496cf1825d3c68f20475c3d8142d1291706fc4f2b387b525c29`): activa micrófono al entrar, cierra aviso de audio al habilitar reproducción, añade control de pantalla siempre encendida y conserva el nombre del operador en localStorage/restaurándolo en join. Navegador con audio simulado verificó permisos, reintento, reproducción y persistencia; WakeLock probado con simulación de liberación/rechazo.
