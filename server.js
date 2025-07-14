/**
 * SAP-GUI-Flow API Server
 * Backend simple para la aplicación SAP-GUI-Flow usando Express
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const { exec } = require('child_process');

// Módulos propios de procesamiento
const parser = require('./lib/parser');
const aliasGenerator = require('./lib/aliasGenerator');
const flowGenerator = require('./lib/flowGenerator');
// const orchestrator = require('./lib/orchestrator'); // Ya no se usa mainFlow.json

// Configuración
const app = express();
const port = process.env.PORT || 3000;
const config = {
    inputDir: './sap-gui-env',
    outputDir: './output',
    metaInfo: {
        version: '2.2',
        tx: 'mainFlow completo con todos los subflujos',
        created: new Date().toISOString().split('T')[0]
    }
};

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, config.inputDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Asegurar que los directorios existen
if (!fs.existsSync(config.inputDir)) {
    fs.mkdirSync(config.inputDir, { recursive: true });
}
if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
}

// API Endpoints

// Obtener lista de archivos de entrada
app.get('/api/files/input', (req, res) => {
    try {
        const files = fs.readdirSync(config.inputDir)
            .filter(file => file.endsWith('.json'))
            .map(filename => {
                const filePath = path.join(config.inputDir, filename);
                const stats = fs.statSync(filePath);
                return {
                    name: filename,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime,
                    content: '' // La interfaz espera esta propiedad pero no cargamos el contenido aquí
                };
            });
        res.json(files);
    } catch (error) {
        console.error('Error al obtener archivos de entrada:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener lista de archivos de salida
app.get('/api/files/output', (req, res) => {
    try {
        const files = fs.readdirSync(config.outputDir)
            .filter(file => file.endsWith('.json'))
            .map(filename => {
                const filePath = path.join(config.outputDir, filename);
                const stats = fs.statSync(filePath);
                return {
                    name: filename,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime,
                    content: '' // La interfaz espera esta propiedad pero no cargamos el contenido aquí
                };
            });
        res.json(files);
    } catch (error) {
        console.error('Error al obtener archivos de salida:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener contenido de un archivo
app.get('/api/files/content', (req, res) => {
    try {
        const { filepath } = req.query;
        if (!filepath) {
            return res.status(400).json({ error: 'Se requiere el parámetro filepath' });
        }

        let fullPath;
        if (filepath.includes(config.inputDir)) {
            fullPath = filepath;
        } else if (filepath.includes(config.outputDir)) {
            fullPath = filepath;
        } else {
            // Intentar inferir la ruta
            const inputPath = path.join(config.inputDir, filepath);
            const outputPath = path.join(config.outputDir, filepath);
            
            if (fs.existsSync(inputPath)) {
                fullPath = inputPath;
            } else if (fs.existsSync(outputPath)) {
                fullPath = outputPath;
            } else {
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Error al obtener contenido de archivo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar archivo
app.put('/api/files/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const { content } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Se requiere el contenido del archivo' });
        }

        const filePath = path.join(config.outputDir, filename);
        fs.writeFileSync(filePath, content);
        
        res.json({ success: true, message: `Archivo ${filename} actualizado` });
    } catch (error) {
        console.error('Error al actualizar archivo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Subir archivos
app.post('/api/files/upload', upload.array('files'), (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No se han proporcionado archivos' });
        }
        
        res.json({ 
            success: true, 
            message: `${files.length} archivos subidos correctamente`,
            files: files.map(file => ({
                name: file.originalname,
                path: file.path,
                size: file.size
            }))
        });
    } catch (error) {
        console.error('Error al subir archivos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Subir y extraer archivo ZIP
app.post('/api/flow/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo' });
        }

        if (!file.originalname.toLowerCase().endsWith('.zip')) {
            return res.status(400).json({ error: 'El archivo debe ser un ZIP' });
        }

        const extractPath = path.resolve(config.inputDir);
        const zipPath = path.resolve(file.path);

        console.log('Información de debug:');
        console.log('- Archivo ZIP:', zipPath);
        console.log('- Directorio de extracción:', extractPath);
        console.log('- Archivo existe:', fs.existsSync(zipPath));
        console.log('- Directorio existe:', fs.existsSync(extractPath));

        // Asegurar que el directorio de extracción existe
        if (!fs.existsSync(extractPath)) {
            fs.mkdirSync(extractPath, { recursive: true });
            console.log('Directorio de extracción creado');
        }

        // Extraer el archivo ZIP
        const extract = require('extract-zip');
        try {
            console.log('Iniciando extracción del ZIP...');
            await extract(zipPath, { dir: extractPath });
            console.log('Archivo ZIP extraído correctamente');
            
            // Verificar contenido del directorio después de la extracción
            const allFiles = fs.readdirSync(extractPath);
            console.log('Archivos en el directorio después de la extracción:', allFiles);
            
            // Buscar archivos JSON de forma recursiva
            const findJsonFiles = (dir) => {
                const files = [];
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        // Buscar recursivamente en subdirectorios
                        files.push(...findJsonFiles(fullPath));
                    } else if (item.toLowerCase().endsWith('.json')) {
                        files.push(fullPath);
                    }
                }
                
                return files;
            };

            // Buscar archivos JSON
            const jsonFiles = findJsonFiles(extractPath);
            console.log('Archivos JSON encontrados:', jsonFiles);

            // Eliminar el archivo ZIP después de extraerlo
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
                console.log('Archivo ZIP eliminado');
            }

            // Leer los archivos extraídos
            const inputFiles = [];
            for (const filePath of jsonFiles) {
                try {
                    const stats = fs.statSync(filePath);
                    const filename = path.basename(filePath);
                    
                    // Leer con manejo robusto de encoding
                    let content;
                    try {
                        content = fs.readFileSync(filePath, 'utf8');
                    } catch (encodingError) {
                        console.log(`  Reintentando lectura con buffer para ${filename}`);
                        const buffer = fs.readFileSync(filePath);
                        content = buffer.toString('utf8');
                    }
                    
                    // Limpiar contenido
                    content = content.replace(/^\uFEFF/, ''); // Remover BOM
                    content = content.trim(); // Remover espacios
                    
                    // Verificar que el contenido es válido
                    console.log(`Verificando ${filename}: ${content.length} bytes`);
                    console.log(`Primeros 50 caracteres: ${content.substring(0, 50)}`);
                    console.log(`Carácter en pos 20: "${content.charAt(20)}" (código: ${content.charCodeAt(20)})`);
                    
                    // Validar que parece ser JSON
                    if (!content.startsWith('{') && !content.startsWith('[')) {
                        console.warn(`⚠️ Archivo ${filename} no parece ser JSON válido, omitiendo...`);
                        console.warn(`   Contenido: ${content.substring(0, 100)}`);
                        continue;
                    }
                    
                    // Intentar parsear para verificar validez
                    try {
                        JSON.parse(content);
                        console.log(`✅ ${filename} es JSON válido`);
                    } catch (jsonError) {
                        console.warn(`⚠️ Archivo ${filename} tiene JSON inválido: ${jsonError.message}, omitiendo...`);
                        continue;
                    }
                    
                    inputFiles.push({
                        name: filename,
                        path: filePath,
                        size: stats.size,
                        modified: stats.mtime,
                        content // Incluir el contenido del archivo
                    });
                } catch (fileError) {
                    console.error(`Error al leer ${filePath}:`, fileError.message);
                    continue;
                }
            }

            if (inputFiles.length === 0) {
                console.log('Error: No se encontraron archivos JSON');
                console.log('Contenido del directorio:', fs.readdirSync(extractPath));
                
                return res.status(400).json({ 
                    error: 'No se encontraron archivos JSON en el ZIP',
                    debug: {
                        extractPath,
                        allFiles: fs.readdirSync(extractPath),
                        zipOriginalName: file.originalname
                    }
                });
            }

            console.log(`Se encontraron ${inputFiles.length} archivos JSON`);
            
            // Procesar archivos automáticamente
            console.log('Iniciando procesamiento de archivos...');
            
            // Mapear rutas de archivos
            const inputFilePaths = inputFiles.map(file => file.path);
            
            // 2. Procesar cada archivo para extraer información
            const parsedFlows = {};
            for (const inputFile of inputFilePaths) {
                const tcode = path.basename(inputFile, '.json').toLowerCase();
                console.log(`Procesando ${tcode}...`);
                
                try {
                    // Leer con diferentes encodings para compatibilidad
                    let fileContent;
                    try {
                        fileContent = fs.readFileSync(inputFile, 'utf8');
                    } catch (encodingError) {
                        console.log(`  Reintentando con encoding latin1 para ${tcode}`);
                        const buffer = fs.readFileSync(inputFile);
                        fileContent = buffer.toString('utf8');
                    }
                    
                    // Limpiar caracteres problemáticos
                    fileContent = fileContent.replace(/^\uFEFF/, ''); // Remover BOM
                    fileContent = fileContent.trim(); // Remover espacios
                    
                    console.log(`  Archivo ${tcode}: ${fileContent.length} caracteres`);
                    console.log(`  Primeros 100 caracteres: ${fileContent.substring(0, 100)}`);
                    console.log(`  Encoding info - Carácter en pos 20: "${fileContent.charAt(20)}" (código: ${fileContent.charCodeAt(20)})`);
                    
                    // Verificar que el contenido parece ser JSON válido
                    if (!fileContent.startsWith('{') && !fileContent.startsWith('[')) {
                        throw new Error(`El archivo ${tcode} no parece ser JSON válido. Comienza con: ${fileContent.substring(0, 50)}`);
                    }
                    
                    const rawData = JSON.parse(fileContent);
                    parsedFlows[tcode] = parser.parseRawData(rawData, tcode);
                    console.log(`  ✅ ${tcode} procesado correctamente`);
                } catch (parseError) {
                    console.error(`❌ Error al procesar ${tcode}:`, parseError.message);
                    throw new Error(`Error en archivo ${tcode}: ${parseError.message}`);
                }
            }
            
            // 3. Generar prefijos y alias
            console.log('Generando prefijos y alias...');
            const { prefixes, aliases } = aliasGenerator.generateAliases(parsedFlows);
            
            // 4. Generar archivos de subflujo
            console.log('Generando archivos de subflujo...');
            const outputFiles = [];
            
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
                
                const content = JSON.stringify(flowData, null, 2);
                outputFiles.push({
                    name: `${tcode}.json`,
                    path: outputPath,
                    size: Buffer.byteLength(content),
                    modified: new Date(),
                    content
                });
            }
            
            console.log('✅ Procesamiento completado con éxito');
            console.log(`📊 Estadísticas:`);
            console.log(`   - Archivos procesados: ${inputFiles.length}`);
            console.log(`   - Flujos generados: ${outputFiles.length}`);
            console.log(`📝 Nota: mainFlow.json ya no se genera (descontinuado)`);
            
            // Devolver tanto los archivos originales como los procesados
            res.json({
                success: true,
                message: `Se procesaron ${inputFiles.length} archivos y se generaron ${outputFiles.length} archivos de salida.`,
                inputFiles,
                outputFiles
            });
            
        } catch (err) {
            console.error('Error al extraer o procesar el archivo ZIP:', err);
            
            // Limpiar archivo ZIP si existe
            if (fs.existsSync(zipPath)) {
                try {
                    fs.unlinkSync(zipPath);
                    console.log('Archivo ZIP limpiado después del error');
                } catch (cleanupError) {
                    console.error('Error al limpiar archivo ZIP:', cleanupError);
                }
            }
            
            res.status(500).json({ 
                error: err.message,
                details: {
                    zipPath,
                    extractPath,
                    originalName: file.originalname,
                    fileSize: file.size
                }
            });
        }
    } catch (error) {
        console.error('Error al procesar el archivo ZIP:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Procesar archivos
app.post('/api/process', async (req, res) => {
    try {
        console.log('Iniciando procesamiento de archivos...');
        
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
        const outputFiles = [];
        
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
            
            outputFiles.push({
                name: `${tcode}.json`,
                path: outputPath,
                size: fs.statSync(outputPath).size,
                modified: new Date(),
                content: JSON.stringify(flowData, null, 2)
            });
        }
        
        console.log('✅ Procesamiento completado con éxito');
        console.log(`📊 Estadísticas:`);
        console.log(`   - Archivos procesados: ${inputFiles.length}`);
        console.log(`   - Flujos generados: ${outputFiles.length}`);
        console.log(`📝 Nota: mainFlow.json ya no se genera (descontinuado)`);
        res.json({
            success: true,
            message: 'Archivos procesados correctamente',
            outputFiles
        });
    } catch (error) {
        console.error('Error durante el procesamiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Exportar archivos ZIP
app.get('/api/export/zip', (req, res) => {
    try {
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });
        
        // Nombre del archivo
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = `sap-gui-flow-export-${timestamp}.zip`;
        
        // Configurar headers para descarga
        res.attachment(filename);
        archive.pipe(res);
        
        // Añadir archivos al ZIP
        const files = fs.readdirSync(config.outputDir)
            .filter(file => file.endsWith('.json'));
            
        for (const file of files) {
            const filePath = path.join(config.outputDir, file);
            archive.file(filePath, { name: file });
        }
        
        archive.finalize();
    } catch (error) {
        console.error('Error al exportar ZIP:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para diagnosticar archivos ZIP
app.post('/api/debug/zip', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo' });
        }

        const zipPath = path.resolve(file.path);
        const extractPath = path.resolve(config.inputDir, 'debug-extract');

        console.log('🔍 Diagnóstico de ZIP iniciado');
        console.log('- Archivo:', zipPath);
        console.log('- Tamaño:', file.size);

        // Crear directorio de extracción temporal
        if (!fs.existsSync(extractPath)) {
            fs.mkdirSync(extractPath, { recursive: true });
        }

        const extract = require('extract-zip');
        await extract(zipPath, { dir: extractPath });

        // Analizar contenido
        const allFiles = fs.readdirSync(extractPath, { recursive: true });
        const analysis = {
            totalFiles: allFiles.length,
            jsonFiles: [],
            otherFiles: [],
            errors: []
        };

        for (const file of allFiles) {
            const filePath = path.join(extractPath, file);
            const stats = fs.statSync(filePath);
            
            if (stats.isFile() && file.toLowerCase().endsWith('.json')) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const preview = content.substring(0, 100);
                    
                    let isValidJson = false;
                    try {
                        JSON.parse(content);
                        isValidJson = true;
                    } catch (jsonError) {
                        analysis.errors.push({
                            file: file,
                            error: jsonError.message,
                            preview: preview
                        });
                    }
                    
                    analysis.jsonFiles.push({
                        name: file,
                        size: stats.size,
                        valid: isValidJson,
                        preview: preview
                    });
                } catch (readError) {
                    analysis.errors.push({
                        file: file,
                        error: `Error al leer: ${readError.message}`
                    });
                }
            } else if (stats.isFile()) {
                analysis.otherFiles.push({
                    name: file,
                    size: stats.size
                });
            }
        }

        // Limpiar archivos temporales
        fs.rmSync(extractPath, { recursive: true, force: true });
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }

        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('Error en diagnóstico de ZIP:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
});

// Endpoint de debug para diagnóstico
app.get('/api/debug/info', (req, res) => {
    try {
        const debugInfo = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            directories: {
                inputDir: {
                    path: path.resolve(config.inputDir),
                    exists: fs.existsSync(config.inputDir),
                    files: fs.existsSync(config.inputDir) ? fs.readdirSync(config.inputDir) : []
                },
                outputDir: {
                    path: path.resolve(config.outputDir),
                    exists: fs.existsSync(config.outputDir),
                    files: fs.existsSync(config.outputDir) ? fs.readdirSync(config.outputDir) : []
                }
            },
            process: {
                cwd: process.cwd(),
                platform: process.platform,
                nodeVersion: process.version,
                uptime: process.uptime()
            }
        };

        res.json({
            success: true,
            debug: debugInfo
        });
    } catch (error) {
        console.error('Error en debug info:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
});

// Obtener tipos de controles disponibles
app.get('/api/control-types', (req, res) => {
    try {
        // Leer todos los archivos de salida
        const files = fs.readdirSync(config.outputDir)
            .filter(file => file.endsWith('.json'));
        
        const allControlTypes = new Set();
        
        // Extraer los tipos de controles de cada archivo
        for (const file of files) {
            const filePath = path.join(config.outputDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            
            try {
                const flowData = JSON.parse(content);
                
                // Extraer tipos de controles de los metadatos
                if (flowData.metadata && flowData.metadata.controlTypes) {
                    flowData.metadata.controlTypes.forEach(type => {
                        allControlTypes.add(type);
                    });
                }
            } catch (parseError) {
                console.warn(`Error al parsear ${file}:`, parseError.message);
            }
        }
        
        // Convertir el Set a un array y ordenar
        const controlTypes = Array.from(allControlTypes).sort();
        
        res.json({
            success: true,
            controlTypes: controlTypes
        });
    } catch (error) {
        console.error('Error al obtener tipos de controles:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== ENDPOINTS PARA SAP-TARGETS =====

// Obtener lista de archivos sap-targets disponibles
app.get('/api/targets', (req, res) => {
    try {
        const targetsDir = path.join(__dirname, '..', 'sap-targets');
        
        if (!fs.existsSync(targetsDir)) {
            return res.status(404).json({ 
                error: 'Directorio sap-targets no encontrado',
                path: targetsDir 
            });
        }
        
        const files = fs.readdirSync(targetsDir)
            .filter(file => file.endsWith('.json'))
            .map(filename => {
                const filePath = path.join(targetsDir, filename);
                const stats = fs.statSync(filePath);
                const tcode = filename.replace('-targets.json', '').toUpperCase();
                
                return {
                    name: filename,
                    tcode: tcode,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime
                };
            });
        
        res.json({
            success: true,
            targets: files
        });
    } catch (error) {
        console.error('Error al obtener archivos sap-targets:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener contenido de un archivo sap-targets específico
app.get('/api/targets/:tcode', (req, res) => {
    try {
        const { tcode } = req.params;
        const targetsDir = path.join(__dirname, '..', 'sap-targets');
        
        // Buscar el archivo (puede tener diferentes formatos de nombre)
        const possibleNames = [
            `${tcode.toUpperCase()}-targets.json`,
            `${tcode.toLowerCase()}-targets.json`,
            `${tcode}-targets.json`
        ];
        
        let targetFile = null;
        for (const name of possibleNames) {
            const filePath = path.join(targetsDir, name);
            if (fs.existsSync(filePath)) {
                targetFile = filePath;
                break;
            }
        }
        
        if (!targetFile) {
            return res.status(404).json({ 
                error: `Archivo targets para ${tcode} no encontrado`,
                searchedNames: possibleNames
            });
        }
        
        const content = fs.readFileSync(targetFile, 'utf8');
        const targetsData = JSON.parse(content);
        
        res.json({
            success: true,
            tcode: tcode.toUpperCase(),
            targets: targetsData
        });
    } catch (error) {
        console.error(`Error al obtener targets para ${req.params.tcode}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener controles organizados por tipo para un tcode específico
app.get('/api/targets/:tcode/controls', (req, res) => {
    try {
        const { tcode } = req.params;
        const targetsDir = path.join(__dirname, '..', 'sap-targets');
        
        // Buscar el archivo
        const possibleNames = [
            `${tcode.toUpperCase()}-targets.json`,
            `${tcode.toLowerCase()}-targets.json`,
            `${tcode}-targets.json`
        ];
        
        let targetFile = null;
        for (const name of possibleNames) {
            const filePath = path.join(targetsDir, name);
            if (fs.existsSync(filePath)) {
                targetFile = filePath;
                break;
            }
        }
        
        if (!targetFile) {
            return res.status(404).json({ 
                error: `Archivo targets para ${tcode} no encontrado`
            });
        }
        
        const content = fs.readFileSync(targetFile, 'utf8');
        const targetsData = JSON.parse(content);
        
        // Organizar controles por tipo
        const controlsByType = {};
        const controlsByGroup = {};
        
        if (targetsData.TargetControls) {
            Object.keys(targetsData.TargetControls).forEach(groupName => {
                const controls = targetsData.TargetControls[groupName];
                
                controlsByGroup[groupName] = controls;
                
                controls.forEach(control => {
                    const controlType = control.ControlType || 'Unknown';
                    
                    if (!controlsByType[controlType]) {
                        controlsByType[controlType] = [];
                    }
                    
                    controlsByType[controlType].push({
                        ...control,
                        group: groupName
                    });
                });
            });
        }
        
        res.json({
            success: true,
            tcode: tcode.toUpperCase(),
            controlsByType,
            controlsByGroup,
            summary: {
                totalGroups: Object.keys(controlsByGroup).length,
                totalControls: Object.values(controlsByGroup).reduce((total, group) => total + group.length, 0),
                controlTypes: Object.keys(controlsByType)
            }
        });
    } catch (error) {
        console.error(`Error al obtener controles para ${req.params.tcode}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ===== ENDPOINTS PARA EDITOR DE FLUJOS =====

// Obtener flujo específico para edición
app.get('/api/flows/:tcode', (req, res) => {
    try {
        const { tcode } = req.params;
        const flowFile = path.join(config.outputDir, `${tcode.toLowerCase()}.json`);
        
        if (!fs.existsSync(flowFile)) {
            return res.status(404).json({ 
                error: `Flujo para ${tcode} no encontrado`
            });
        }
        
        const content = fs.readFileSync(flowFile, 'utf8');
        const flowData = JSON.parse(content);
        
        res.json({
            success: true,
            tcode: tcode.toUpperCase(),
            flow: flowData
        });
    } catch (error) {
        console.error(`Error al obtener flujo para ${req.params.tcode}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar flujo específico
app.put('/api/flows/:tcode', (req, res) => {
    try {
        const { tcode } = req.params;
        const { flow } = req.body;
        
        if (!flow) {
            return res.status(400).json({ error: 'Se requiere el objeto flow' });
        }
        
        const flowFile = path.join(config.outputDir, `${tcode.toLowerCase()}.json`);
        
        // Validar estructura básica del flujo
        if (!flow.steps || typeof flow.steps !== 'object') {
            return res.status(400).json({ error: 'El flujo debe tener una propiedad steps válida' });
        }
        
        // Guardar el flujo actualizado
        fs.writeFileSync(flowFile, JSON.stringify(flow, null, 2));
        
        res.json({
            success: true,
            message: `Flujo ${tcode} actualizado correctamente`,
            tcode: tcode.toUpperCase()
        });
    } catch (error) {
        console.error(`Error al actualizar flujo para ${req.params.tcode}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar archivo de flujo (endpoint genérico)
app.put('/api/flow/update', (req, res) => {
    try {
        const { name, content, path: filePath } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Se requiere el nombre y contenido del archivo' });
        }
        
        // Determinar la ruta del archivo
        let targetPath;
        if (filePath) {
            targetPath = filePath;
        } else {
            // Por defecto, guardar en el directorio de salida
            targetPath = path.join(config.outputDir, name);
        }
        
        // Validar que el contenido es JSON válido
        try {
            JSON.parse(content);
        } catch (jsonError) {
            return res.status(400).json({ error: 'El contenido no es JSON válido' });
        }
        
        // Crear el directorio si no existe
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Escribir el archivo
        fs.writeFileSync(targetPath, content, 'utf8');
        
        // Obtener información del archivo actualizado
        const stats = fs.statSync(targetPath);
        const updatedFile = {
            name,
            path: targetPath,
            size: stats.size,
            modified: stats.mtime,
            content
        };
        
        console.log(`Archivo actualizado: ${name}`);
        
        res.json(updatedFile);
    } catch (error) {
        console.error('Error al actualizar archivo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Validar targets en un flujo
app.post('/api/flows/:tcode/validate', (req, res) => {
    try {
        const { tcode } = req.params;
        const { flow } = req.body;
        
        if (!flow || !flow.steps) {
            return res.status(400).json({ error: 'Se requiere un flujo válido' });
        }
        
        // Cargar targets disponibles para este tcode
        const targetsDir = path.join(__dirname, '..', 'sap-targets');
        const possibleNames = [
            `${tcode.toUpperCase()}-targets.json`,
            `${tcode.toLowerCase()}-targets.json`,
            `${tcode}-targets.json`
        ];
        
        let availableTargets = [];
        for (const name of possibleNames) {
            const filePath = path.join(targetsDir, name);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                const targetsData = JSON.parse(content);
                
                if (targetsData.TargetControls) {
                    Object.values(targetsData.TargetControls).forEach(group => {
                        availableTargets.push(...group);
                    });
                }
                break;
            }
        }
        
        // Validar cada paso del flujo
        const validationResults = [];
        const availableIds = new Set(availableTargets.map(t => t.Id));
        
        Object.keys(flow.steps).forEach(stepId => {
            const step = flow.steps[stepId];
            
            if (step.target && !step.target.includes('{{') && !step.target.includes('programmatic')) {
                const isValid = availableIds.has(step.target);
                
                if (!isValid) {
                    validationResults.push({
                        stepId,
                        issue: 'target_not_found',
                        message: `Target '${step.target}' no encontrado en los controles disponibles`,
                        severity: 'error'
                    });
                }
            }
        });
        
        res.json({
            success: true,
            tcode: tcode.toUpperCase(),
            valid: validationResults.length === 0,
            issues: validationResults,
            summary: {
                totalSteps: Object.keys(flow.steps).length,
                validSteps: Object.keys(flow.steps).length - validationResults.length,
                availableTargets: availableTargets.length
            }
        });
    } catch (error) {
        console.error(`Error al validar flujo para ${req.params.tcode}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para servir la aplicación (solo si existe el directorio frontend)
app.get('*', (req, res) => {
    const frontendPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
    
    if (fs.existsSync(frontendPath)) {
        res.sendFile(frontendPath);
    } else {
        // Si no hay frontend, devolver información de la API
        res.json({
            name: 'SAP-GUI-Flow API',
            version: '1.0.0',
            description: 'Backend API para procesamiento de flujos SAP',
            endpoints: {
                'GET /api/files/input': 'Obtener archivos de entrada',
                'GET /api/files/output': 'Obtener archivos de salida',
                'POST /api/flow/upload': 'Subir y procesar archivo ZIP',
                'POST /api/process': 'Procesar archivos existentes',
                'GET /api/export/zip': 'Exportar archivos como ZIP',
                'GET /api/debug/info': 'Información de diagnóstico'
            }
        });
    }
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor SAP-GUI-Flow corriendo en http://localhost:${port}`);
}); 