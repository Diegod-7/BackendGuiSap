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

# Crear directorios necesarios
RUN mkdir -p output sap-gui-env

# Exponer el puerto
EXPOSE 3000

# Comando por defecto para ejecutar el servidor
CMD ["npm", "run", "dev"] 