/**
 * SAP-GUI-Flow: Sistema de transformación de registros SAP a flujos estructurados
 * 
 * Este sistema procesa archivos de registro de interacciones SAP (sap-gui-env/*.json)
 * y los transforma en flujos estructurados para automatización según el esquema definido.
 */

const fs = require('fs');
const path = require('path');
const parser = require('./lib/parser');
const aliasGenerator = require('./lib/aliasGenerator');
const flowGenerator = require('./lib/flowGenerator');
// const orchestrator = require('./lib/orchestrator'); // Ya no se usa mainFlow.json

// Configuración
const config = {
    inputDir: './sap-gui-env',
    outputDir: './output',
    metaInfo: {
        version: '2.3',
        tx: 'Procesamiento individual de flujos SAP',
        created: new Date().toISOString().split('T')[0]
    }
};

// Función principal
async function main() {
    try {
        console.log('SAP-GUI-Flow: Iniciando procesamiento...');
        
        // 1. Leer todos los archivos de registro SAP
        const inputFiles = fs.readdirSync(config.inputDir)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(config.inputDir, file));
        
        console.log(`Se encontraron ${inputFiles.length} archivos de registro SAP`);
        
        // 2. Procesar cada archivo para extraer información
        const parsedFlows = {};
        for (const inputFile of inputFiles) {
            const tcode = path.basename(inputFile, '.json').toLowerCase();
            console.log(`Procesando ${tcode}...`);
            
            try {
                // Leer el archivo con manejo de errores mejorado
                const fileContent = fs.readFileSync(inputFile, 'utf8');
                console.log(`  - Archivo leído: ${fileContent.length} caracteres`);
                
                // Verificar BOM
                const cleanContent = fileContent.replace(/^\uFEFF/, '');
                if (cleanContent !== fileContent) {
                    console.log(`  - Removido BOM del archivo ${tcode}`);
                }
                
                const rawData = JSON.parse(cleanContent);
                parsedFlows[tcode] = parser.parseRawData(rawData, tcode);
                console.log(`  - ✅ ${tcode} procesado correctamente`);
            } catch (jsonError) {
                console.error(`  - ❌ Error en archivo ${tcode}: ${jsonError.message}`);
                
                // Mostrar contexto del error si es posible
                if (jsonError.message.includes('position')) {
                    const position = jsonError.message.match(/position (\d+)/);
                    if (position) {
                        const pos = parseInt(position[1]);
                        const content = fs.readFileSync(inputFile, 'utf8');
                        const start = Math.max(0, pos - 30);
                        const end = Math.min(content.length, pos + 30);
                        console.error(`  - Contexto del error: "${content.substring(start, end)}"`);
                    }
                }
                
                // Continuar con el siguiente archivo en lugar de fallar completamente
                console.log(`  - Saltando archivo ${tcode} debido a errores`);
                continue;
            }
        }
        
        // 3. Generar prefijos y alias
        console.log('Generando prefijos y alias...');
        const { prefixes, aliases } = aliasGenerator.generateAliases(parsedFlows);
        
        // 4. Generar archivos de subflujo individuales
        console.log('Generando archivos de flujo individuales...');
        let processedCount = 0;
        for (const tcode in parsedFlows) {
            const flowData = flowGenerator.generateFlow(
                parsedFlows[tcode], 
                tcode, 
                prefixes, 
                aliases
            );
            
            // Guardar archivo de flujo individual
            const outputPath = path.join(config.outputDir, `${tcode}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(flowData, null, 2));
            console.log(`  - Generado ${outputPath}`);
            processedCount++;
        }
        
        console.log(`\n✅ Procesamiento completado con éxito`);
        console.log(`📊 Estadísticas:`);
        console.log(`   - Archivos procesados: ${processedCount}`);
        console.log(`   - Flujos generados: ${processedCount}`);
        console.log(`   - Directorio de salida: ${config.outputDir}`);
        console.log(`\n📝 Nota: mainFlow.json ya no se genera (descontinuado)`);
        
    } catch (error) {
        console.error('Error durante el procesamiento:', error);
        process.exit(1);
    }
}

// Asegurar que el directorio de salida existe
if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
}

// Ejecutar el proceso
main(); 