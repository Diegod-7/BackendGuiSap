#!/bin/sh

# Script de entrada para Docker
echo "🚀 Iniciando SAP-GUI-Flow..."

# Verificar y crear directorios si no existen
echo "📁 Verificando directorios..."
mkdir -p /app/sap-gui-env /app/output

# Verificar permisos de directorios
echo "🔐 Verificando permisos..."
if [ -w /app/sap-gui-env ] && [ -w /app/output ]; then
    echo "✅ Permisos de escritura: OK"
else
    echo "⚠️  Advertencia: Problemas de permisos detectados"
    echo "   sap-gui-env escribible: $(test -w /app/sap-gui-env && echo 'SÍ' || echo 'NO')"
    echo "   output escribible: $(test -w /app/output && echo 'SÍ' || echo 'NO')"
fi

# Mostrar información del entorno
echo "🌍 Entorno:"
echo "   Usuario: $(whoami)"
echo "   UID/GID: $(id)"
echo "   Directorio: $(pwd)"
echo "   Node.js: $(node --version)"

# Listar archivos en directorios
echo "📄 Contenido de directorios:"
echo "   sap-gui-env: $(ls -la /app/sap-gui-env 2>/dev/null | wc -l) archivos"
echo "   output: $(ls -la /app/output 2>/dev/null | wc -l) archivos"

echo "🎯 Iniciando aplicación..."
echo ""

# Ejecutar el comando principal
exec "$@" 