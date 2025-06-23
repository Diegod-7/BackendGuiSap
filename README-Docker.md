# SAP-GUI-Flow - Docker

Esta guía te ayudará a ejecutar la aplicación SAP-GUI-Flow usando Docker.

## Requisitos Previos

- Docker instalado en tu sistema
- Docker Compose instalado

## Construcción y Ejecución

### Opción 1: Usando Docker Compose (Recomendado)

```bash
# Construir y ejecutar la aplicación
docker-compose up --build

# Ejecutar en segundo plano
docker-compose up -d --build
```

### Opción 2: Usando el script de construcción

```bash
# Hacer el script ejecutable (Linux/Mac)
chmod +x docker-build.sh

# Ejecutar el script
./docker-build.sh
```

### Opción 3: Comandos Docker manuales

```bash
# Construir la imagen
docker build -t sap-gui-flow .

# Ejecutar el contenedor
docker run -d \
  --name sap-gui-flow-app \
  -p 3000:3000 \
  -v $(pwd)/sap-gui-env:/app/sap-gui-env \
  -v $(pwd)/output:/app/output \
  sap-gui-flow
```

## Acceso a la Aplicación

Una vez que el contenedor esté ejecutándose, puedes acceder a la aplicación en:

- **URL**: http://localhost:3000
- **API**: http://localhost:3000/api/

## Comandos Útiles

```bash
# Ver logs de la aplicación
docker-compose logs -f

# Detener la aplicación
docker-compose down

# Reiniciar la aplicación
docker-compose restart

# Acceder al contenedor
docker-compose exec sap-gui-flow sh

# Ver estado de los contenedores
docker-compose ps
```

## Volúmenes

La aplicación utiliza volúmenes para persistir datos:

- `./sap-gui-env` → `/app/sap-gui-env` (archivos de entrada)
- `./output` → `/app/output` (archivos de salida)

## Variables de Entorno

Puedes modificar las siguientes variables en el archivo `docker-compose.yml`:

- `NODE_ENV`: Entorno de ejecución (production/development)
- `PORT`: Puerto interno de la aplicación (por defecto 3000)

## Solución de Problemas

### El contenedor no inicia

```bash
# Verificar logs
docker-compose logs

# Reconstruir sin caché
docker-compose build --no-cache
```

### Puerto ocupado

Si el puerto 3000 está ocupado, modifica el archivo `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"  # Cambiar 3000 por el puerto deseado
```

### Problemas de permisos

En sistemas Linux/Mac, asegúrate de que los directorios tengan los permisos correctos:

```bash
chmod 755 sap-gui-env output
``` 