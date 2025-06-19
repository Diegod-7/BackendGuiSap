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
const orchestrator = require('./lib/orchestrator');

// Configuración
const config = {
    inputDir: './sap-gui-env',
    outputDir: './output',
    metaInfo: {
        version: '2.2',
        tx: 'mainFlow completo con todos los subflujos',
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
            
            const rawData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
            parsedFlows[tcode] = parser.parseRawData(rawData, tcode);
        }
        
        // 3. Generar prefijos y alias
        console.log('Generando prefijos y alias...');
        const { prefixes, aliases } = aliasGenerator.generateAliases(parsedFlows);
        
        // 4. Generar archivos de subflujo
        console.log('Generando archivos de subflujo...');
        for (const tcode in parsedFlows) {
            const flowData = flowGenerator.generateFlow(
                parsedFlows[tcode], 
                tcode, 
                prefixes, 
                aliases
            );
            
            // Guardar archivo de subflujo
            const outputPath = path.join(config.outputDir, `${tcode}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(flowData, null, 2));
            console.log(`  - Generado ${outputPath}`);
        }
        
        // 5. Generar archivo principal mainFlow.json
        console.log('Generando archivo principal mainFlow.json...');
        const mainFlowData = orchestrator.generateMainFlow(
            Object.keys(parsedFlows),
            prefixes,
            aliases,
            config.metaInfo
        );
        
        const mainFlowPath = path.join(config.outputDir, 'mainFlow.json');
        fs.writeFileSync(mainFlowPath, JSON.stringify(mainFlowData, null, 2));
        console.log(`  - Generado ${mainFlowPath}`);
        
        console.log('Procesamiento completado con éxito');
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