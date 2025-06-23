# Usar la imagen oficial de Node.js
FROM node:18-alpine

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar el código fuente
COPY . .

# Crear directorios necesarios con permisos correctos
RUN mkdir -p output sap-gui-env && \
    chmod 755 output sap-gui-env

# Crear usuario no-root para mayor seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Cambiar propietario de los directorios
RUN chown -R nextjs:nodejs /app

# Cambiar al usuario no-root
USER nextjs

# Exponer el puerto
EXPOSE 3000

# Comando por defecto para ejecutar el servidor
CMD ["npm", "run", "dev"] 