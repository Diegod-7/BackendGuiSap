# 📋 INSTRUCCIONES PARA EJECUTAR EL PLAN DE PRUEBAS
## SAP GUI Flow - Versión 2.3

### 🎯 Objetivo
Este documento proporciona instrucciones detalladas para ejecutar el plan de pruebas del sistema SAP GUI Flow actualizado, que incluye:
- Soporte para 3 formatos de archivos JSON
- Nuevas transacciones ME2N y ZRPT_PS_PROJECT
- Eliminación de mainFlow.json
- Nuevos endpoints de API para targets y flujos
- Validación de targets en flujos

### 📁 Archivos del Plan de Pruebas
- `Plan-Pruebas-SAP-GUI-Flow-2025-07-10.xlsx` - Plan completo con 22 casos de prueba
- `plan-pruebas-sap-gui-flow-2025-07-10.csv` - Versión CSV del plan
- `resumen-plan-pruebas-2025-07-10.json` - Resumen estadístico
- `INSTRUCCIONES-PRUEBAS.md` - Este documento

### 🔧 Preparación del Ambiente

#### Requisitos Previos
1. **Node.js** versión 12 o superior
2. **npm** para gestión de dependencias
3. **Excel** o LibreOffice Calc para el plan de pruebas
4. **Postman** o herramienta similar para pruebas de API

#### Configuración Inicial
```bash
# 1. Navegar al directorio del proyecto
cd BackendGuiSap

# 2. Instalar dependencias
npm install

# 3. Verificar estructura de directorios
ls -la sap-gui-env/
ls -la output/
ls -la sap-targets/
```

### 📊 Ejecución del Plan de Pruebas

#### Fase 1: Pruebas Funcionales (TC001-TC006)

**TC001: Procesamiento de archivos formato antiguo**
```bash
# Preparación
echo "Verificando archivos con formato antiguo..."
ls sap-gui-env/*.json | head -5

# Ejecución
node index.js

# Verificación
ls output/
grep -i "formato antiguo" output/*.json
```

**TC002: Procesamiento de archivos formato intermedio**
```bash
# Verificar archivos ME2N y ZRPT_PS_PROJECT
ls sap-gui-env/me2n.json
ls sap-gui-env/zrpt_ps_project.json

# Ejecutar procesamiento
node index.js

# Verificar salida
ls output/me2n.json
ls output/zrpt_ps_project.json
```

**TC003: Procesamiento de archivos formato nuevo**
```bash
# Verificar archivos con $meta
grep -l "\$meta" sap-gui-env/*.json

# Ejecutar procesamiento
node index.js

# Verificar preservación de metadatos
grep -A 5 "\$meta" output/cji3.json
```

**TC004-TC005: Nuevas transacciones**
```bash
# Verificar ME2N
cat output/me2n.json | jq '.steps | length'

# Verificar ZRPT_PS_PROJECT
cat output/zrpt_ps_project.json | jq '.steps | length'
```

**TC006: Eliminación de mainFlow.json**
```bash
# Limpiar output
rm -f output/mainFlow.json

# Ejecutar procesamiento
node index.js

# Verificar que NO existe mainFlow.json
ls output/mainFlow.json 2>/dev/null || echo "✅ mainFlow.json no existe (correcto)"
```

#### Fase 2: Pruebas de API (TC007-TC012)

**Preparación del servidor**
```bash
# Terminal 1: Iniciar servidor
node server.js

# Terminal 2: Ejecutar pruebas
```

**TC007: GET /api/targets**
```bash
curl -X GET http://localhost:3000/api/targets
```

**TC008: GET /api/targets/:tcode**
```bash
curl -X GET http://localhost:3000/api/targets/CJI3
```

**TC009: GET /api/targets/:tcode/controls**
```bash
curl -X GET http://localhost:3000/api/targets/CJI3/controls
```

**TC010: GET /api/flows/:tcode**
```bash
curl -X GET http://localhost:3000/api/flows/cji3
```

**TC011: PUT /api/flows/:tcode**
```bash
# Obtener flujo actual
curl -X GET http://localhost:3000/api/flows/cji3 > temp_flow.json

# Modificar y actualizar (ejemplo)
curl -X PUT http://localhost:3000/api/flows/cji3 \
  -H "Content-Type: application/json" \
  -d @temp_flow.json
```

**TC012: POST /api/flows/:tcode/validate**
```bash
curl -X POST http://localhost:3000/api/flows/cji3/validate \
  -H "Content-Type: application/json" \
  -d '{"flow": {"steps": {"step1": {"target": "invalid_target"}}}}'
```

#### Fase 3: Pruebas de Errores (TC013-TC016)

**TC013: JSON malformado**
```bash
# Crear archivo con JSON inválido
echo '{"invalid": json}' > sap-gui-env/test-invalid.json

# Ejecutar procesamiento
node index.js

# Verificar manejo de error
grep -i "error" output/*.json
```

**TC014: Targets no encontrado**
```bash
curl -X GET http://localhost:3000/api/targets/NOEXISTE
```

**TC015: Flujo no encontrado**
```bash
curl -X GET http://localhost:3000/api/flows/noexiste
```

**TC016: Datos inválidos en PUT**
```bash
# Sin objeto flow
curl -X PUT http://localhost:3000/api/flows/cji3 \
  -H "Content-Type: application/json" \
  -d '{}'

# Flow sin steps
curl -X PUT http://localhost:3000/api/flows/cji3 \
  -H "Content-Type: application/json" \
  -d '{"flow": {}}'
```

#### Fase 4: Pruebas de Integración (TC017-TC018)

**TC017: Flujo end-to-end**
```bash
# 1. Procesamiento completo
node index.js

# 2. Verificar archivos generados
ls output/

# 3. Iniciar servidor
node server.js &

# 4. Obtener flujo via API
curl -X GET http://localhost:3000/api/flows/cji3

# 5. Validar flujo
curl -X POST http://localhost:3000/api/flows/cji3/validate \
  -H "Content-Type: application/json" \
  -d @output/cji3.json
```

**TC018: Compatibilidad**
```bash
# Usar archivos de versión anterior
cp sap-gui-env-backup/*.json sap-gui-env/

# Ejecutar procesamiento
node index.js

# Comparar resultados
diff output-previous/ output/
```

#### Fase 5: Pruebas de Formato (TC019-TC020)

**TC019: Detección automática**
```bash
# Ejecutar con archivos mixtos
node index.js 2>&1 | grep -E "(formato|Procesando)"
```

**TC020: Preservación de estructura**
```bash
# Verificar preservación de $meta
jq '.$meta' output/cji3.json

# Verificar preservación de targetContext
jq '.targetContext' output/cji3.json
```

#### Fase 6: Pruebas de Regresión (TC021-TC022)

**TC021: Funcionalidad existente**
```bash
# Ejecutar suite de pruebas anterior
npm test  # Si existe

# Comparar comportamiento
node index.js > output-new.log 2>&1
diff output-old.log output-new.log
```

**TC022: Performance**
```bash
# Medir tiempo de procesamiento
time node index.js

# Medir uso de memoria
/usr/bin/time -v node index.js
```

### 📈 Registro de Resultados

#### Usando el Archivo Excel
1. Abrir `Plan-Pruebas-SAP-GUI-Flow-2025-07-10.xlsx`
2. Ir a la hoja "Plan de Pruebas"
3. Para cada caso de prueba:
   - Actualizar columna "Estado" (Ejecutado/Fallido)
   - Agregar "Fecha Ejecución"
   - Documentar "Resultado Real"
   - Agregar "Comentarios" si es necesario

#### Estados Posibles
- **Pendiente**: No ejecutado
- **Ejecutado**: Prueba pasó exitosamente
- **Fallido**: Prueba falló
- **Bloqueado**: No se puede ejecutar por dependencias
- **Omitido**: No aplicable en este ambiente

### 🚨 Manejo de Defectos

#### Clasificación de Defectos
- **Crítico**: Sistema no funciona
- **Alto**: Funcionalidad principal afectada
- **Medio**: Funcionalidad secundaria afectada
- **Bajo**: Mejoras cosméticas

#### Reporte de Defectos
Para cada defecto encontrado, documentar:
1. **ID del caso de prueba**
2. **Descripción del defecto**
3. **Pasos para reproducir**
4. **Resultado esperado vs actual**
5. **Severidad**
6. **Capturas de pantalla** (si aplica)

### 📋 Checklist de Finalización

#### Antes de Aprobar Release
- [ ] Todos los casos de prueba críticos ejecutados
- [ ] Defectos críticos y altos resueltos
- [ ] Pruebas de regresión pasadas
- [ ] Documentación actualizada
- [ ] Performance aceptable
- [ ] Compatibilidad verificada

#### Entregables
- [ ] Plan de pruebas ejecutado
- [ ] Reporte de defectos
- [ ] Reporte de cobertura
- [ ] Recomendaciones
- [ ] Signoff de QA

### 🔧 Herramientas Útiles

#### Scripts de Utilidad
```bash
# Verificar todos los archivos JSON
find sap-gui-env/ -name "*.json" -exec node -c "JSON.parse(require('fs').readFileSync('{}', 'utf8'))" \;

# Contar casos de prueba por categoría
grep -c "FUNCIONAL\|API\|ERROR\|INTEGRACION\|FORMATO\|REGRESION" Plan-Pruebas-*.xlsx

# Verificar endpoints de API
curl -s http://localhost:3000/api/targets | jq '.success'
```

#### Comandos de Limpieza
```bash
# Limpiar archivos temporales
rm -f temp_*.json
rm -f test-*.json

# Restaurar estado inicial
git checkout -- output/
```

### 📞 Contactos

- **QA Team**: Responsable de pruebas funcionales
- **API Team**: Responsable de pruebas de API
- **Integration Team**: Responsable de pruebas de integración
- **Performance Team**: Responsable de pruebas de rendimiento

### 📚 Referencias

- [Documentación del Sistema](README.md)
- [Guía de API](API-GUIDE.md)
- [Cambios en la Versión 2.3](presentacion-cambios.html)

---

**Nota**: Este plan de pruebas cubre todas las funcionalidades nuevas y existentes del sistema SAP GUI Flow. El tiempo estimado total de ejecución es de 11.3 horas, distribuidas en 22 casos de prueba.

**Última actualización**: 2025-07-10
**Versión del documento**: 1.0 