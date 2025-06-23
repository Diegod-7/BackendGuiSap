#!/bin/bash

# Script para construir y ejecutar la aplicación SAP-GUI-Flow con Docker

echo "🚀 Construyendo la aplicación SAP-GUI-Flow..."

# Construir la imagen Docker
docker-compose build

if [ $? -eq 0 ]; then
    echo "✅ Construcción completada exitosamente"
    echo "🔧 Iniciando la aplicación..."
    
    # Ejecutar la aplicación
    docker-compose up -d
    
    if [ $? -eq 0 ]; then
        echo "✅ Aplicación iniciada correctamente"
        echo "🌐 La aplicación está disponible en: http://localhost:3000"
        echo "📊 Para ver los logs: docker-compose logs -f"
        echo "🛑 Para detener: docker-compose down"
    else
        echo "❌ Error al iniciar la aplicación"
        exit 1
    fi
else
    echo "❌ Error en la construcción"
    exit 1
fi 