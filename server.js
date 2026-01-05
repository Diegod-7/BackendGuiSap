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

// Módulos para Paquetes de Sincronización
const SyncPackagesStorage = require('./lib/syncPackagesStorage');
const JsonValidator = require('./lib/jsonValidator');
// Usar ssh2 directamente en lugar de ssh2-sftp-client para mayor compatibilidad
const SftpService = require('./lib/sftpServiceV2');
// Módulo para SCHEDULER - conexión a base de datos
const DbService = require('./lib/dbService');

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
// Aumentar límite de tamaño para body-parser (50MB) para permitir archivos JSON grandes
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
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

// Inicializar almacenamiento de paquetes de sincronización
const syncPackagesStorage = new SyncPackagesStorage('./data');

// Inicializar servicio SFTP
const sftpService = new SftpService();

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
// PUT /api/flow/update - Actualizar un archivo de flujo en SFTP
app.put('/api/flow/update', async (req, res) => {
    try {
        const { name, path: filePath, content, size, modified } = req.body;

        // Validar campos requeridos
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del archivo es requerido' });
        }

        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return res.status(400).json({ error: 'La ruta del archivo es requerida' });
        }

        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ error: 'El contenido del archivo es requerido' });
        }

        // Actualizar archivo en SFTP
        const result = await sftpService.updateFlowFile(filePath.trim(), content.trim());

        if (result.status) {
            // Retornar respuesta exitosa con el formato esperado
            res.json({
                name: result.name,
                path: result.path,
                size: result.size,
                modified: result.modified,
                content: result.content
            });
        } else {
            // Determinar código de estado según el tipo de error
            if (result.error && result.error.includes('JSON')) {
                res.status(400).json({ error: result.error });
            } else if (result.error && result.error.includes('permisos')) {
                res.status(403).json({ error: result.error });
            } else {
                res.status(500).json({ error: result.error || result.message || 'Error al actualizar el archivo' });
            }
        }
    } catch (error) {
        console.error('Error inesperado al actualizar flujo en SFTP:', error);
        res.status(500).json({ 
            error: 'Error inesperado al procesar la solicitud',
            details: error.message 
        });
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

// ===== ENDPOINTS PARA SFTP =====

// GET /api/sftp/list-json - Listar archivos JSON del servidor SFTP
app.get('/api/sftp/list-json', async (req, res) => {
    try {
        const result = await sftpService.listJsonFiles();
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al listar archivos JSON:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            files: []
        });
    }
});

// POST /api/sftp/get-file-content - Obtener contenido de un archivo JSON
app.post('/api/sftp/get-file-content', async (req, res) => {
    try {
        const { filePath } = req.body;
        
        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return res.status(400).json({
                status: false,
                message: 'El parámetro filePath es requerido',
                content: null,
                fileName: null
            });
        }

        const result = await sftpService.getFileContent(filePath.trim());
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al obtener contenido del archivo:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            content: null,
            fileName: null
        });
    }
});

// GET /api/sftp/test-connection - Probar conexión SFTP
app.get('/api/sftp/test-connection', async (req, res) => {
    try {
        const result = await sftpService.testConnection();
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error al probar conexión SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error al conectar: ${error.message}`,
            host: null,
            directory: null,
            fileCount: 0
        });
    }
});

// GET /api/sftp/list-packages - Listar todos los paquetes guardados en SFTP
app.get('/api/sftp/list-packages', async (req, res) => {
    try {
        const result = await sftpService.listPackages();
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al listar paquetes:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            files: []
        });
    }
});

// GET /api/sftp/list-flows - Listar todos los flujos (JSON y ZIP) del directorio SFTP
app.get('/api/sftp/list-flows', async (req, res) => {
    try {
        const result = await sftpService.listFlows();
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al listar flujos:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            files: []
        });
    }
});

// GET /api/sftp/list-targets - Listar todos los targets disponibles en SFTP
app.get('/api/sftp/list-targets', async (req, res) => {
    try {
        const result = await sftpService.listTargets();
        
        if (result.status) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al listar targets:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            files: []
        });
    }
});

// POST /api/sftp/save-flow - Guardar un flujo completo en SFTP
app.post('/api/sftp/save-flow', async (req, res) => {
    try {
        const { fileName, flowData, overwrite } = req.body;

        // Validar request
        if (!flowData || typeof flowData !== 'object') {
            return res.status(400).json({
                status: false,
                message: 'El flujo es requerido',
                fileName: null,
                filePath: null,
                errors: ['El campo flowData es requerido'],
                warnings: []
            });
        }

        // Validar estructura del flujo
        const validationResult = validateFlow(flowData);

        if (!validationResult.isValid) {
            return res.status(400).json({
                status: false,
                message: 'El flujo no es válido: ' + validationResult.errors.join(', '),
                fileName: null,
                filePath: null,
                errors: validationResult.errors,
                warnings: validationResult.warnings
            });
        }

        // Generar nombre de archivo si no se proporciona
        let finalFileName = fileName;
        if (!finalFileName || typeof finalFileName !== 'string' || !finalFileName.trim()) {
            finalFileName = generateFlowFileName();
        }

        // Guardar en SFTP
        const result = await sftpService.saveFlowToSftp(finalFileName.trim(), flowData, overwrite === true);

        if (result.status) {
            res.json({
                status: true,
                message: result.message,
                fileName: result.fileName,
                filePath: result.filePath,
                warnings: validationResult.warnings
            });
        } else {
            // Si el archivo existe y no se permite overwrite
            if (result.exists) {
                res.status(409).json({
                    status: false,
                    message: result.message,
                    fileName: result.fileName,
                    filePath: result.filePath,
                    exists: true,
                    warnings: validationResult.warnings
                });
            } else {
                res.status(500).json({
                    status: false,
                    message: result.message,
                    fileName: null,
                    filePath: null,
                    warnings: validationResult.warnings
                });
            }
        }
    } catch (error) {
        console.error('Error inesperado al guardar flujo:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            fileName: null,
            filePath: null,
            errors: [error.message],
            warnings: []
        });
    }
});

/**
 * Valida la estructura de un flujo
 * @param {object} flowData - Datos del flujo a validar
 * @returns {object} Resultado de la validación
 */
function validateFlow(flowData) {
    const result = {
        isValid: true,
        errors: [],
        warnings: []
    };

    // Validar $meta
    if (!flowData.$meta || typeof flowData.$meta !== 'object') {
        result.isValid = false;
        result.errors.push('El campo $meta es requerido y debe ser un objeto');
    } else {
        // Validar description (debe ser string, puede estar vacío)
        if (flowData.$meta.description !== undefined && typeof flowData.$meta.description !== 'string') {
            result.isValid = false;
            result.errors.push('El campo $meta.description debe ser un string');
        } else if (!flowData.$meta.description || flowData.$meta.description.trim() === '') {
            result.warnings.push('La descripción del flujo está vacía');
        }

        // Validar tcode (opcional, pero si está presente debe ser string)
        if (flowData.$meta.tcode !== undefined && typeof flowData.$meta.tcode !== 'string') {
            result.isValid = false;
            result.errors.push('El campo $meta.tcode debe ser un string');
        }
    }

    // Validar targetContext (debe ser un objeto, puede estar vacío)
    if (flowData.targetContext === undefined || flowData.targetContext === null) {
        result.isValid = false;
        result.errors.push('El campo targetContext es requerido');
    } else if (typeof flowData.targetContext !== 'object' || Array.isArray(flowData.targetContext)) {
        result.isValid = false;
        result.errors.push('El campo targetContext debe ser un objeto');
    } else {
        // Validar estructura de cada targetContext
        const targetContextErrors = validateTargetContextStructure(flowData.targetContext);
        if (targetContextErrors.length > 0) {
            result.isValid = false;
            result.errors.push(...targetContextErrors);
        }
        
        if (Object.keys(flowData.targetContext).length === 0) {
            result.warnings.push('El targetContext está vacío');
        }
    }

    // Validar steps (debe ser un objeto, puede estar vacío)
    if (flowData.steps === undefined || flowData.steps === null) {
        result.isValid = false;
        result.errors.push('El campo steps es requerido');
    } else if (typeof flowData.steps !== 'object' || Array.isArray(flowData.steps)) {
        result.isValid = false;
        result.errors.push('El campo steps debe ser un objeto');
    } else {
        // Validar que no haya acciones callSubflow (subflujos eliminados)
        const subflowErrors = validateNoSubflows(flowData.steps);
        if (subflowErrors.length > 0) {
            result.isValid = false;
            result.errors.push(...subflowErrors);
        }
        
        if (Object.keys(flowData.steps).length === 0) {
            result.warnings.push('El steps está vacío');
        }
    }

    return result;
}

/**
 * Valida que no haya referencias a subflujos (callSubflow) en los steps
 * @param {object} steps - Objeto de steps a validar
 * @returns {Array<string>} Lista de errores encontrados
 */
function validateNoSubflows(steps) {
    const errors = [];
    const validActions = ['waitFor', 'set', 'click', 'condition', 'columns', 'columnsSum', 'saveas', 'reset', 'callProgram', 'exit'];
    
    // Recorrer todos los contextos de steps
    Object.keys(steps).forEach(contextName => {
        const contextSteps = steps[contextName];
        
        if (contextSteps && typeof contextSteps === 'object') {
            // Recorrer todos los steps del contexto
            Object.keys(contextSteps).forEach(stepName => {
                const step = contextSteps[stepName];
                
                if (step && typeof step === 'object') {
                    // Validar acción
                    if (step.action) {
                        if (step.action === 'callSubflow') {
                            errors.push(
                                `Step "${contextName}.${stepName}": La acción 'callSubflow' ya no está soportada. ` +
                                `Use targetContext en su lugar.`
                            );
                        } else if (!validActions.includes(step.action)) {
                            errors.push(
                                `Step "${contextName}.${stepName}": Acción '${step.action}' no es válida. ` +
                                `Acciones válidas: ${validActions.join(', ')}`
                            );
                        }
                    }
                    
                    // Validar tipo de nodo si existe (no debe ser 'subflow')
                    if (step.type === 'subflow') {
                        errors.push(
                            `Step "${contextName}.${stepName}": El tipo de nodo 'subflow' ya no está soportado. ` +
                            `Use targetContext en su lugar.`
                        );
                    }
                }
            });
        }
    });
    
    return errors;
}

/**
 * Valida la estructura de un targetContext
 * Soporta estructura extendida con controles y posiciones
 * @param {object} targetContext - Objeto targetContext a validar
 * @returns {Array<string>} Lista de errores encontrados
 */
function validateTargetContextStructure(targetContext) {
    const errors = [];
    
    Object.keys(targetContext).forEach(contextKey => {
        const context = targetContext[contextKey];
        
        // Si es un string simple, es válido
        if (typeof context === 'string') {
            return; // Válido, continuar
        }
        
        // Si es un objeto, validar estructura
        if (typeof context !== 'object' || Array.isArray(context)) {
            errors.push(`TargetContext '${contextKey}': debe ser un objeto o string`);
            return;
        }
        
        // Validar FriendlyName si existe
        if (context.FriendlyName !== undefined && typeof context.FriendlyName !== 'string') {
            errors.push(`TargetContext '${contextKey}': FriendlyName debe ser un string`);
        }
        
        // Validar deepaliases si existe
        if (context.deepaliases !== undefined) {
            if (typeof context.deepaliases !== 'object' || Array.isArray(context.deepaliases)) {
                errors.push(`TargetContext '${contextKey}': deepaliases debe ser un objeto`);
            }
        }
        
        // Validar targetMap si existe
        if (context.targetMap !== undefined) {
            if (typeof context.targetMap !== 'object' || Array.isArray(context.targetMap)) {
                errors.push(`TargetContext '${contextKey}': targetMap debe ser un objeto`);
            }
        }
        
        // Validar controls si existe (nuevo - sistema de contenedores)
        if (context.controls !== undefined) {
            if (!Array.isArray(context.controls)) {
                errors.push(`TargetContext '${contextKey}': controls debe ser un array`);
            } else {
                // Validar cada control
                context.controls.forEach((control, index) => {
                    if (typeof control !== 'object' || Array.isArray(control)) {
                        errors.push(`TargetContext '${contextKey}': controls[${index}] debe ser un objeto`);
                    } else {
                        // Validar campos requeridos del control
                        if (control.name === undefined || typeof control.name !== 'string') {
                            errors.push(`TargetContext '${contextKey}': controls[${index}].name es requerido y debe ser string`);
                        }
                        if (control.path === undefined || typeof control.path !== 'string') {
                            errors.push(`TargetContext '${contextKey}': controls[${index}].path es requerido y debe ser string`);
                        }
                        // controlType es opcional pero debe ser string si existe
                        if (control.controlType !== undefined && typeof control.controlType !== 'string') {
                            errors.push(`TargetContext '${contextKey}': controls[${index}].controlType debe ser string`);
                        }
                        // action es opcional pero debe ser string si existe
                        if (control.action !== undefined && typeof control.action !== 'string') {
                            errors.push(`TargetContext '${contextKey}': controls[${index}].action debe ser string`);
                        }
                    }
                });
            }
        }
        
        // Validar position si existe (nuevo - sistema de contenedores)
        if (context.position !== undefined) {
            if (typeof context.position !== 'object' || Array.isArray(context.position)) {
                errors.push(`TargetContext '${contextKey}': position debe ser un objeto`);
            } else {
                // Validar x e y si existen
                if (context.position.x !== undefined && typeof context.position.x !== 'number') {
                    errors.push(`TargetContext '${contextKey}': position.x debe ser un número`);
                }
                if (context.position.y !== undefined && typeof context.position.y !== 'number') {
                    errors.push(`TargetContext '${contextKey}': position.y debe ser un número`);
                }
            }
        }
    });
    
    return errors;
}

/**
 * Genera un nombre de archivo único para un flujo
 * @returns {string} Nombre del archivo generado
 */
function generateFlowFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `flow_${year}${month}${day}_${hours}${minutes}${seconds}.json`;
}

// POST /api/sftp/get-target-context-controls - Obtener controles manipulables de un targetContext
app.post('/api/sftp/get-target-context-controls', async (req, res) => {
    try {
        const { targetContextKey, flowData, targetContext } = req.body;

        if (!targetContextKey || typeof targetContextKey !== 'string' || !targetContextKey.trim()) {
            return res.status(400).json({
                status: false,
                message: 'El targetContextKey es requerido',
                controls: []
            });
        }

        // Obtener el targetContext desde diferentes fuentes
        let targetContextData = null;

        // Opción 1: Se proporciona directamente el targetContext
        if (targetContext && typeof targetContext === 'object') {
            targetContextData = targetContext;
        }
        // Opción 2: Se proporciona el flujo completo
        else if (flowData && flowData.targetContext && flowData.targetContext[targetContextKey]) {
            targetContextData = flowData.targetContext[targetContextKey];
        }
        // Opción 3: Intentar obtener desde SFTP (requiere tcode)
        else if (flowData && flowData.$meta && flowData.$meta.tcode) {
            // Si tenemos el flujo completo, usar su targetContext
            if (flowData.targetContext && flowData.targetContext[targetContextKey]) {
                targetContextData = flowData.targetContext[targetContextKey];
            }
        }

        if (!targetContextData) {
            return res.status(404).json({
                status: false,
                message: `TargetContext '${targetContextKey}' no encontrado. Proporcione el targetContext o flowData en el request.`,
                controls: []
            });
        }

        // Obtener controles desde el targetContext
        const controls = getControlsFromTargetContext(targetContextKey, targetContextData);

        // Filtrar solo los manipulables
        const manipulableControls = controls.filter(c => c.isManipulable);

        res.json({
            status: true,
            message: 'Controles obtenidos correctamente',
            controls: manipulableControls
        });
    } catch (error) {
        console.error('Error inesperado al obtener controles del targetContext:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`,
            controls: []
        });
    }
});

/**
 * Obtiene los controles desde un targetContext
 * @param {string} targetContextKey - Clave del targetContext
 * @param {object} targetContextData - Datos del targetContext
 * @returns {Array} Lista de controles
 */
function getControlsFromTargetContext(targetContextKey, targetContextData) {
    const controls = [];

    // Si es un string simple, no hay controles
    if (typeof targetContextData === 'string') {
        return controls;
    }

    // Obtener FriendlyName del contexto
    const friendlyName = targetContextData.FriendlyName || targetContextKey;

    // Si hay deepaliases, usarlos como base
    if (targetContextData.deepaliases && typeof targetContextData.deepaliases === 'object') {
        Object.keys(targetContextData.deepaliases).forEach(aliasName => {
            const path = targetContextData.deepaliases[aliasName];
            const controlType = inferControlTypeFromPath(path);
            const isManipulable = isControlManipulable(controlType);

            controls.push({
                name: aliasName,
                friendlyName: getFriendlyNameForControl(aliasName, targetContextData),
                controlType: controlType,
                path: path,
                isManipulable: isManipulable
            });
        });
    }

    // Si hay targetMap, agregar esos controles también
    if (targetContextData.targetMap && typeof targetContextData.targetMap === 'object') {
        Object.keys(targetContextData.targetMap).forEach(mapKey => {
            const path = targetContextData.targetMap[mapKey];
            
            // Solo agregar si esl una ruta (no una acción de teclado)
            if (path && path.startsWith('/')) {
                const controlType = inferControlTypeFromPath(path);
                const isManipulable = isControlManipulable(controlType);

                controls.push({
                    name: mapKey,
                    friendlyName: getFriendlyNameForControl(mapKey, targetContextData),
                    controlType: controlType,
                    path: path,
                    isManipulable: isManipulable
                });
            }
        });
    }

    return controls;
}

/**
 * Infiere el tipo de control desde la ruta
 * @param {string} path - Ruta del control
 * @returns {string} Tipo de control
 */
function inferControlTypeFromPath(path) {
    if (!path || typeof path !== 'string') {
        return 'GuiControl';
    }

    const pathLower = path.toLowerCase();

    if (pathLower.includes('/btn[') || pathLower.includes('/tbar[')) {
        return 'GuiButton';
    }
    if (pathLower.includes('/chk[')) {
        return 'GuiCheckBox';
    }
    if (pathLower.includes('/rad[')) {
        return 'GuiRadioButton';
    }
    if (pathLower.includes('/ctxt')) {
        return 'GuiTextField';
    }
    if (pathLower.includes('/cmb')) {
        return 'GuiComboBox';
    }
    if (pathLower.includes('/tabs')) {
        return 'GuiTab';
    }
    if (pathLower.includes('/shell')) {
        return 'GuiGridView';
    }
    if (pathLower.includes('/wnd[')) {
        return 'GuiWindow';
    }
    if (pathLower.includes('/usr/sub:')) {
        return 'GuiContainer';
    }

    return 'GuiControl';
}

/**
 * Determina si un control es manipulable según su tipo
 * @param {string} controlType - Tipo de control
 * @returns {boolean} true si es manipulable
 */
function isControlManipulable(controlType) {
    const manipulableTypes = [
        'GuiButton',
        'GuiCheckBox',
        'GuiRadioButton',
        'GuiTextField',
        'GuiComboBox',
        'GuiTab',
        'GuiMenu',
        'GuiToolbar',
        'GuiOkCodeField',
        'GuiLabel',
        'GuiTableControl',
        'GuiGridView'
    ];

    return manipulableTypes.some(type => controlType.includes(type));
}

/**
 * Obtiene el nombre amigable para un control
 * @param {string} aliasName - Nombre del alias
 * @param {object} targetContextData - Datos del targetContext
 * @returns {string} Nombre amigable
 */
function getFriendlyNameForControl(aliasName, targetContextData) {
    // Mapeo básico de nombres comunes
    const friendlyNameMapping = {
        'Set Controlling Area': 'Configurar Área de Control',
        'Enter profile': 'Ingresar Perfil',
        'Display Project Actual Cost Line Items': 'Mostrar Items de Costo Real del Proyecto',
        'Continue   (Enter)': 'Continuar (Enter)',
        'Execute   (F8)': 'Ejecutar (F8)',
        'Spreadsheet...   (Ctrl+Shift+F7)': 'Exportar a Excel (Ctrl+Shift+F7)',
        'Select Layout...   (Ctrl+F9)': 'Seleccionar Layout (Ctrl+F9)',
        'Change Layout...   (Ctrl+F8)': 'Cambiar Layout (Ctrl+F8)',
        'Adopt   (Enter)': 'Aceptar (Enter)',
        'Hide selected fields (F6)': 'Ocultar Campos Seleccionados (F6)',
        'Show selected fields (F7)': 'Mostrar Campos Seleccionados (F7)'
    };

    // Si hay un mapeo específico, usarlo
    if (friendlyNameMapping[aliasName]) {
        return friendlyNameMapping[aliasName];
    }

    // Intentar obtener del contexto si tiene FriendlyName
    if (targetContextData.FriendlyName) {
        return `${targetContextData.FriendlyName} - ${aliasName}`;
    }

    // Usar el alias como FriendlyName
    return aliasName;
}

// POST /api/sftp/check-package-exists - Verificar si un paquete existe
app.post('/api/sftp/check-package-exists', async (req, res) => {
    try {
        const { packageName } = req.body;
        
        if (!packageName || typeof packageName !== 'string' || !packageName.trim()) {
            return res.status(400).json({
                exists: false
            });
        }

        const result = await sftpService.checkPackageExists(packageName.trim());
        
        res.json(result);
    } catch (error) {
        console.error('Error inesperado al verificar existencia de paquete:', error);
        res.status(500).json({
            exists: false,
            error: 'Error inesperado al procesar la solicitud'
        });
    }
});

// POST /api/sftp/save-package - Guardar paquete completo en SFTP
app.post('/api/sftp/save-package', async (req, res) => {
    try {
        const { packageName, packageData, overwrite, targetDirectory } = req.body;

        if (!packageName || typeof packageName !== 'string' || !packageName.trim()) {
            return res.status(400).json({
                status: false,
                message: 'El nombre del paquete es requerido',
                filePath: null,
                fileName: null
            });
        }

        if (!packageData || typeof packageData !== 'object') {
            return res.status(400).json({
                status: false,
                message: 'Los datos del paquete son requeridos',
                filePath: null,
                fileName: null
            });
        }

        // Detectar si el paquete contiene múltiples formularios
        // Si es así y tiene targetDirectory, no verificar existencia porque el frontend debería
        // estar enviando archivos individuales con nombres únicos
        const formKeys = Object.keys(packageData || {});
        const isMultiFormPackage = formKeys.length > 1 && 
            formKeys.some(key => {
                const form = packageData[key];
                return form && typeof form === 'object' && (form.tcode || key.includes('KSB1') || key.includes('KOB1') || key.includes('CJI3') || key.includes('ZFIR'));
            });

        // Solo verificar existencia si:
        // 1. NO es un paquete múltiple con targetDirectory (porque se generarán nombres únicos)
        // 2. Y overwrite no es true
        const shouldCheckExists = !(isMultiFormPackage && targetDirectory) && !overwrite;
        
        if (shouldCheckExists) {
            const existsCheck = await sftpService.checkPackageExists(
                packageName.trim(), 
                targetDirectory || null
            );
            if (existsCheck.exists) {
                return res.status(409).json({
                    status: false,
                    message: 'Un paquete con este nombre ya existe. Use overwrite: true para sobrescribirlo.',
                    filePath: existsCheck.filePath,
                    fileName: null,
                    exists: true
                });
            }
        }

        const result = await sftpService.savePackageToSftp(
            packageName.trim(), 
            packageData, 
            targetDirectory || null
        );

        // Si se guardaron múltiples archivos, la respuesta tiene estructura diferente
        if (result.savedFiles && result.savedFiles.length > 0) {
            // Respuesta para múltiples archivos guardados
            res.json({
                status: true,
                message: result.message || `Se guardaron ${result.savedFiles.length} archivos correctamente`,
                savedFiles: result.savedFiles,
                errorFiles: result.errorFiles || [],
                totalFiles: result.totalFiles || result.savedFiles.length,
                successCount: result.successCount || result.savedFiles.length,
                errorCount: result.errorCount || 0
            });
        } else if (result.status) {
            // Respuesta para un solo archivo guardado
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error inesperado al guardar paquete en SFTP:', error);
        res.status(500).json({
            status: false,
            message: 'Error inesperado al procesar la solicitud',
            filePath: null,
            fileName: null
        });
    }
});

// POST /api/sftp/delete-file - Eliminar archivo del servidor SFTP
app.post('/api/sftp/delete-file', async (req, res) => {
    try {
        const { filePath, directory } = req.body;

        // Validar entrada
        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return res.status(400).json({
                status: false,
                message: 'Ruta de archivo no proporcionada'
            });
        }

        // Eliminar archivo
        const result = await sftpService.deleteFileFromSftp(filePath.trim(), directory || null);

        if (result.status) {
            res.json(result);
        } else {
            // Determinar código de estado según el tipo de error
            if (result.message.includes('no encontrado')) {
                res.status(404).json(result);
            } else if (result.message.includes('permisos') || result.message.includes('Permission')) {
                res.status(403).json(result);
            } else if (result.message.includes('no válida') || result.message.includes('path traversal')) {
                res.status(400).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al eliminar archivo en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// POST /api/sftp/list-directory - Listar contenido de un directorio
app.post('/api/sftp/list-directory', async (req, res) => {
    try {
        const { path: directoryPath } = req.body;

        // path es opcional, si no se proporciona se usa el directorio raíz
        const result = await sftpService.listDirectory(directoryPath || '');

        if (result.status) {
            res.json(result);
        } else {
            if (result.message.includes('no encontrado')) {
                res.status(404).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al listar directorio en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`,
            files: []
        });
    }
});

// POST /api/sftp/create-file - Crear un nuevo archivo
app.post('/api/sftp/create-file', async (req, res) => {
    try {
        const { directory, fileName, content } = req.body;

        if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
            return res.status(400).json({
                status: false,
                message: 'El nombre del archivo es requerido'
            });
        }

        if (content === null || content === undefined) {
            return res.status(400).json({
                status: false,
                message: 'El contenido del archivo es requerido'
            });
        }

        const result = await sftpService.createFile(
            directory || '',
            fileName.trim(),
            content
        );

        if (result.status) {
            res.json(result);
        } else {
            if (result.message.includes('ya existe')) {
                res.status(409).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al crear archivo en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// POST /api/sftp/update-file - Actualizar contenido de un archivo
app.post('/api/sftp/update-file', async (req, res) => {
    try {
        const { filePath, content } = req.body;

        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return res.status(400).json({
                status: false,
                message: 'La ruta del archivo es requerida'
            });
        }

        if (content === null || content === undefined) {
            return res.status(400).json({
                status: false,
                message: 'El contenido del archivo es requerido'
            });
        }

        const result = await sftpService.updateFile(filePath.trim(), content);

        if (result.status) {
            res.json(result);
        } else {
            if (result.message.includes('no encontrado')) {
                res.status(404).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al actualizar archivo en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// POST /api/sftp/create-directory - Crear un nuevo directorio
app.post('/api/sftp/create-directory', async (req, res) => {
    try {
        const { parentDirectory, directoryName } = req.body;

        if (!directoryName || typeof directoryName !== 'string' || !directoryName.trim()) {
            return res.status(400).json({
                status: false,
                message: 'El nombre del directorio es requerido'
            });
        }

        const result = await sftpService.createDirectory(
            parentDirectory || '',
            directoryName.trim()
        );

        if (result.status) {
            res.json(result);
        } else {
            if (result.message.includes('ya existe')) {
                res.status(409).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al crear directorio en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// POST /api/sftp/delete-directory - Eliminar un directorio y su contenido
app.post('/api/sftp/delete-directory', async (req, res) => {
    try {
        const { directoryPath } = req.body;

        if (!directoryPath || typeof directoryPath !== 'string' || !directoryPath.trim()) {
            return res.status(400).json({
                status: false,
                message: 'La ruta del directorio es requerida'
            });
        }

        const result = await sftpService.deleteDirectory(directoryPath.trim());

        if (result.status) {
            res.json(result);
        } else {
            if (result.message.includes('no encontrado')) {
                res.status(404).json(result);
            } else {
                res.status(500).json(result);
            }
        }
    } catch (error) {
        console.error('Error inesperado al eliminar directorio en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// POST /api/sftp/download-file - Descargar un archivo del servidor SFTP
app.post('/api/sftp/download-file', async (req, res) => {
    try {
        const { filePath } = req.body;

        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return res.status(400).json({
                status: false,
                message: 'La ruta del archivo es requerida'
            });
        }

        const result = await sftpService.downloadFile(filePath.trim());

        if (result.status) {
            // Establecer headers para descarga
            const fileName = result.fileName || path.basename(filePath);
            
            // Determinar Content-Type según la extensión
            let contentType = 'application/octet-stream';
            const ext = path.extname(fileName).toLowerCase();
            const mimeTypes = {
                '.json': 'application/json',
                '.txt': 'text/plain',
                '.csv': 'text/csv',
                '.xml': 'application/xml',
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.pdf': 'application/pdf',
                '.zip': 'application/zip',
                '.sqpr': 'application/octet-stream'
            };
            if (mimeTypes[ext]) {
                contentType = mimeTypes[ext];
            }

            // Establecer headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Length', result.size || result.content.length);

            // Enviar el archivo
            res.send(result.content);
        } else {
            if (result.message.includes('no encontrado')) {
                res.status(404).json({
                    status: false,
                    message: result.message
                });
            } else if (result.message.includes('excede el tamaño')) {
                res.status(413).json({
                    status: false,
                    message: result.message
                });
            } else {
                res.status(500).json({
                    status: false,
                    message: result.message
                });
            }
        }
    } catch (error) {
        console.error('Error inesperado al descargar archivo en SFTP:', error);
        res.status(500).json({
            status: false,
            message: `Error inesperado al procesar la solicitud: ${error.message}`
        });
    }
});

// ===== ENDPOINTS PARA PAQUETES DE SINCRONIZACIÓN =====

// 2.1. GESTIÓN DE PAQUETES

// GET /api/sync-packages - Obtener todos los paquetes
app.get('/api/sync-packages', (req, res) => {
    try {
        const packages = syncPackagesStorage.getAllPackages();
        const packagesDto = packages.map(pkg => ({
            id: pkg.id,
            name: pkg.name,
            createdDate: pkg.createdDate,
            updatedDate: pkg.updatedDate,
            formsCount: pkg.forms ? pkg.forms.length : 0
        }));
        res.json(packagesDto);
    } catch (error) {
        console.error('Error al obtener paquetes:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/sync-packages/:packageId - Obtener un paquete específico
app.get('/api/sync-packages/:packageId', (req, res) => {
    try {
        const { packageId } = req.params;
        const pkg = syncPackagesStorage.getPackageById(packageId);
        
        if (!pkg) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        const packageDetailDto = {
            id: pkg.id,
            name: pkg.name,
            createdDate: pkg.createdDate,
            updatedDate: pkg.updatedDate,
            forms: pkg.forms.map(form => ({
                id: form.id,
                tcode: form.tcode,
                customName: form.customName,
                parameters: form.parameters
            }))
        };

        res.json(packageDetailDto);
    } catch (error) {
        console.error('Error al obtener paquete:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sync-packages - Crear un nuevo paquete
app.post('/api/sync-packages', (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del paquete es obligatorio' });
        }

        const createdBy = req.headers['x-user-id'] || 'system';
        const newPackage = syncPackagesStorage.createPackage(name.trim(), createdBy);
        
        const packageDto = {
            id: newPackage.id,
            name: newPackage.name,
            createdDate: newPackage.createdDate,
            updatedDate: newPackage.updatedDate,
            formsCount: 0
        };

        res.status(201).json(packageDto);
    } catch (error) {
        console.error('Error al crear paquete:', error);
        if (error.message.includes('Ya existe')) {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/sync-packages/:packageId - Actualizar nombre de paquete
app.put('/api/sync-packages/:packageId', (req, res) => {
    try {
        const { packageId } = req.params;
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del paquete es obligatorio' });
        }

        const updatedPackage = syncPackagesStorage.updatePackage(packageId, { name: name.trim() });
        
        const packageDto = {
            id: updatedPackage.id,
            name: updatedPackage.name,
            createdDate: updatedPackage.createdDate,
            updatedDate: updatedPackage.updatedDate,
            formsCount: updatedPackage.forms ? updatedPackage.forms.length : 0
        };

        res.json(packageDto);
    } catch (error) {
        console.error('Error al actualizar paquete:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        if (error.message.includes('Ya existe')) {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/sync-packages/:packageId - Eliminar paquete
app.delete('/api/sync-packages/:packageId', (req, res) => {
    try {
        const { packageId } = req.params;
        syncPackagesStorage.deletePackage(packageId);
        
        res.json({
            status: true,
            message: 'Paquete eliminado correctamente'
        });
    } catch (error) {
        console.error('Error al eliminar paquete:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// 2.2. GESTIÓN DE FORMULARIOS

// GET /api/sync-packages/:packageId/forms - Obtener todos los formularios de un paquete
app.get('/api/sync-packages/:packageId/forms', (req, res) => {
    try {
        const { packageId } = req.params;
        const forms = syncPackagesStorage.getFormsByPackageId(packageId);
        
        const formsDto = forms.map(form => ({
            id: form.id,
            packageId: form.packageId,
            tcode: form.tcode,
            customName: form.customName,
            parameters: form.parameters
        }));

        res.json(formsDto);
    } catch (error) {
        console.error('Error al obtener formularios:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// GET /api/sync-packages/:packageId/forms/:formId - Obtener un formulario específico
app.get('/api/sync-packages/:packageId/forms/:formId', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        const form = syncPackagesStorage.getFormById(packageId, formId);
        
        if (!form) {
            return res.status(404).json({ error: 'Formulario no encontrado' });
        }

        const formData = syncPackagesStorage.getFormData(formId);

        const formDetailDto = {
            id: form.id,
            packageId: form.packageId,
            tcode: form.tcode,
            customName: form.customName,
            jsonData: form.jsonData,
            parameters: form.parameters,
            formData: formData || null
        };

        res.json(formDetailDto);
    } catch (error) {
        console.error('Error al obtener formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sync-packages/:packageId/forms - Crear un nuevo formulario
app.post('/api/sync-packages/:packageId/forms', (req, res) => {
    try {
        const { packageId } = req.params;
        const { tcode, customName, jsonData, parameters } = req.body;
        
        if (!tcode || !tcode.trim()) {
            return res.status(400).json({ error: 'El TCode es obligatorio' });
        }
        if (!customName || !customName.trim()) {
            return res.status(400).json({ error: 'El nombre personalizado es obligatorio' });
        }
        if (!jsonData) {
            return res.status(400).json({ error: 'El jsonData es obligatorio' });
        }

        // Validar JSON
        const validation = JsonValidator.validateJson(jsonData);
        if (!validation.isValid) {
            return res.status(400).json({ error: validation.message });
        }

        // Usar parámetros extraídos si no se proporcionaron
        const formParameters = parameters || validation.parameters;

        const newForm = syncPackagesStorage.createForm(packageId, {
            tcode: tcode.trim(),
            customName: customName.trim(),
            jsonData: jsonData,
            parameters: formParameters
        });

        const formDto = {
            id: newForm.id,
            packageId: newForm.packageId,
            tcode: newForm.tcode,
            customName: newForm.customName,
            parameters: newForm.parameters
        };

        res.status(201).json(formDto);
    } catch (error) {
        console.error('Error al crear formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/sync-packages/:packageId/forms/:formId - Actualizar formulario
app.put('/api/sync-packages/:packageId/forms/:formId', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        const { customName, jsonData, parameters } = req.body;
        
        const updates = {};
        if (customName !== undefined) updates.customName = customName.trim();
        if (jsonData !== undefined) updates.jsonData = jsonData;
        if (parameters !== undefined) updates.parameters = parameters;

        const updatedForm = syncPackagesStorage.updateForm(packageId, formId, updates);
        
        const formDto = {
            id: updatedForm.id,
            packageId: updatedForm.packageId,
            tcode: updatedForm.tcode,
            customName: updatedForm.customName,
            parameters: updatedForm.parameters
        };

        res.json(formDto);
    } catch (error) {
        console.error('Error al actualizar formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/sync-packages/:packageId/forms/:formId - Eliminar formulario
app.delete('/api/sync-packages/:packageId/forms/:formId', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        syncPackagesStorage.deleteForm(packageId, formId);
        
        res.json({
            status: true,
            message: 'Formulario eliminado correctamente'
        });
    } catch (error) {
        console.error('Error al eliminar formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// 2.3. GESTIÓN DE DATOS DE FORMULARIOS

// POST /api/sync-packages/:packageId/forms/:formId/data - Guardar datos de formulario
app.post('/api/sync-packages/:packageId/forms/:formId/data', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        const formData = req.body;
        
        // Validar que el formulario existe
        const form = syncPackagesStorage.getFormById(packageId, formId);
        if (!form) {
            return res.status(404).json({ error: 'Formulario no encontrado' });
        }

        // Asegurar que tcode esté presente
        if (!formData.tcode) {
            formData.tcode = form.tcode;
        }

        syncPackagesStorage.saveFormData(formId, formData);
        
        res.json({
            status: true,
            message: 'Datos guardados correctamente'
        });
    } catch (error) {
        console.error('Error al guardar datos de formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// GET /api/sync-packages/:packageId/forms/:formId/data - Obtener datos de formulario
app.get('/api/sync-packages/:packageId/forms/:formId/data', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        
        // Validar que el formulario existe
        const form = syncPackagesStorage.getFormById(packageId, formId);
        if (!form) {
            return res.status(404).json({ error: 'Formulario no encontrado' });
        }

        const formData = syncPackagesStorage.getFormData(formId);
        
        if (!formData) {
            return res.status(404).json({ error: 'No hay datos guardados para este formulario' });
        }

        res.json(formData);
    } catch (error) {
        console.error('Error al obtener datos de formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// 2.4. EXPORTACIÓN E IMPORTACIÓN

// POST /api/sync-packages/:packageId/export - Exportar paquete completo
app.post('/api/sync-packages/:packageId/export', (req, res) => {
    try {
        const { packageId } = req.params;
        const pkg = syncPackagesStorage.getPackageById(packageId);
        
        if (!pkg) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        const formsData = syncPackagesStorage.loadFormsData();
        const packageExport = {
            packageName: pkg.name,
            exportDate: new Date().toISOString(),
            forms: {}
        };

        // Recopilar datos de todos los formularios
        pkg.forms.forEach(form => {
            const formData = formsData[form.id] || {};
            packageExport.forms[form.customName] = formData;
        });

        res.json(packageExport);
    } catch (error) {
        console.error('Error al exportar paquete:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sync-packages/import - Importar paquete completo
app.post('/api/sync-packages/import', (req, res) => {
    try {
        const { packageName, forms } = req.body;
        
        if (!packageName || !packageName.trim()) {
            return res.status(400).json({ error: 'El nombre del paquete es obligatorio' });
        }
        if (!forms || typeof forms !== 'object') {
            return res.status(400).json({ error: 'Los formularios son obligatorios' });
        }

        const createdBy = req.headers['x-user-id'] || 'system';
        const newPackage = syncPackagesStorage.createPackage(packageName.trim(), createdBy);

        // Crear formularios e importar datos
        const formsData = syncPackagesStorage.loadFormsData();
        
        Object.keys(forms).forEach(formCustomName => {
            const formData = forms[formCustomName];
            
            // Intentar extraer tcode del formData
            const tcode = formData.tcode || 'UNKNOWN';
            
            // Crear un JSON básico si no existe
            const jsonData = {
                $meta: {
                    tcode: tcode,
                    description: `Formulario importado: ${formCustomName}`
                },
                steps: {}
            };

            // Extraer parámetros del formData
            const parameters = Object.keys(formData).filter(key => key !== 'tcode');
            
            const newForm = syncPackagesStorage.createForm(newPackage.id, {
                tcode: tcode,
                customName: formCustomName,
                jsonData: jsonData,
                parameters: parameters
            });

            // Guardar datos del formulario
            formsData[newForm.id] = formData;
        });

        syncPackagesStorage.saveFormsData(formsData);

        const packageDto = {
            id: newPackage.id,
            name: newPackage.name,
            createdDate: newPackage.createdDate,
            updatedDate: newPackage.updatedDate,
            formsCount: newPackage.forms.length
        };

        res.status(201).json(packageDto);
    } catch (error) {
        console.error('Error al importar paquete:', error);
        if (error.message.includes('Ya existe')) {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sync-packages/:packageId/forms/:formId/export - Exportar datos de formulario
app.post('/api/sync-packages/:packageId/forms/:formId/export', (req, res) => {
    try {
        const { packageId, formId } = req.params;
        
        const form = syncPackagesStorage.getFormById(packageId, formId);
        if (!form) {
            return res.status(404).json({ error: 'Formulario no encontrado' });
        }

        const formData = syncPackagesStorage.getFormData(formId);
        
        if (!formData) {
            return res.status(404).json({ error: 'No hay datos guardados para este formulario' });
        }

        res.json(formData);
    } catch (error) {
        console.error('Error al exportar formulario:', error);
        if (error.message.includes('no encontrado')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

// 2.5. VALIDACIÓN DE JSON

// POST /api/sync-packages/validate-json - Validar estructura JSON
app.post('/api/sync-packages/validate-json', (req, res) => {
    try {
        const { jsonData } = req.body;
        
        if (!jsonData) {
            return res.status(400).json({ error: 'El jsonData es obligatorio' });
        }

        const validation = JsonValidator.validateJson(jsonData);
        
        const response = {
            isValid: validation.isValid,
            message: validation.message
        };

        if (validation.isValid) {
            response.tcode = validation.tcode;
            response.description = validation.description;
            response.parameters = validation.parameters;
        }

        res.json(response);
    } catch (error) {
        console.error('Error al validar JSON:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// MÓDULO 4: SCHEDULER - Endpoints para programación automática
// ============================================================================

/**
 * GET /api/scheduler/posting-dates
 * Obtiene los posting_date faltantes desde el último registro hasta la fecha actual
 * para las tablas CJI3, KOB1, KSB1 y MB51
 * 
 * Query params opcionales:
 * - tables: string separado por comas (ej: "CJI3,KSB1") - por defecto todas
 * - format: "detailed" | "simple" - por defecto "detailed"
 * 
 * Respuesta "detailed":
 * [
 *   {
 *     table: "CJI3",
 *     cat_domain: "CAN",
 *     last_posting_date: "2025-01-15",
 *     missing_dates: ["2025-01-16", "2025-01-17", ...],
 *     missing_count: 5
 *   },
 *   ...
 * ]
 * 
 * Respuesta "simple":
 * [
 *   {
 *     table: "CJI3",
 *     cat_domain: "CAN",
 *     posting_dates: ["2025-01-16", "2025-01-17", ...]
 *   },
 *   ...
 * ]
 */
app.get('/api/scheduler/posting-dates', async (req, res) => {
    try {
        const { tables, format = 'detailed' } = req.query;
        
        // Parsear tablas si se proporcionan
        let tablesArray = ['CJI3', 'KOB1', 'KSB1', 'MB51'];
        if (tables) {
            tablesArray = tables.split(',').map(t => t.trim().toUpperCase());
        }

        // Obtener posting_date faltantes
        const result = await DbService.getMissingPostingDates(tablesArray);

        // Formatear respuesta según el parámetro format
        if (format === 'simple') {
            const simpleResult = result.map(item => ({
                table: item.table,
                cat_domain: item.cat_domain,
                posting_dates: item.missing_dates
            }));
            res.json(simpleResult);
        } else {
            // Formato detailed (por defecto)
            res.json(result);
        }
    } catch (error) {
        console.error('Error al obtener posting_date faltantes:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Error al consultar la base de datos o calcular fechas faltantes'
        });
    }
});

/**
 * GET /api/scheduler/posting-dates/summary
 * Obtiene un resumen de los posting_date faltantes
 * Retorna el total de paquetes de sincronización que se necesitan crear
 */
app.get('/api/scheduler/posting-dates/summary', async (req, res) => {
    try {
        const { tables } = req.query;
        
        let tablesArray = ['CJI3', 'KOB1', 'KSB1', 'MB51'];
        if (tables) {
            tablesArray = tables.split(',').map(t => t.trim().toUpperCase());
        }

        const result = await DbService.getMissingPostingDates(tablesArray);
        
        // Calcular resumen
        const totalPackages = result.reduce((sum, item) => sum + item.missing_count, 0);
        const byTable = {};
        const byDomain = {};
        
        result.forEach(item => {
            // Por tabla
            if (!byTable[item.table]) {
                byTable[item.table] = 0;
            }
            byTable[item.table] += item.missing_count;
            
            // Por dominio
            if (!byDomain[item.cat_domain]) {
                byDomain[item.cat_domain] = 0;
            }
            byDomain[item.cat_domain] += item.missing_count;
        });

        res.json({
            total_packages_needed: totalPackages,
            by_table: byTable,
            by_domain: byDomain,
            details: result
        });
    } catch (error) {
        console.error('Error al obtener resumen de posting_date:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Error al consultar la base de datos'
        });
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