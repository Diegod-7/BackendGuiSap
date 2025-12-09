/**
 * Módulo de servicio SFTP para listar y obtener archivos JSON
 */

const Client = require('ssh2-sftp-client');
const path = require('path');

class SftpService {
    constructor() {
        // Configuración SFTP desde variables de entorno o valores por defecto
        this.config = {
            host: process.env.REMOTE_STORAGE_HOST || '10.4.0.2',
            port: parseInt(process.env.REMOTE_STORAGE_PORT) || 22,
            username: process.env.REMOTE_STORAGE_USERNAME || 'fits',
            password: process.env.REMOTE_STORAGE_PASSWORD || 'fits.2024',
            baseDirectory: process.env.REMOTE_STORAGE_ROOT_DIR 
                ? path.join(process.env.REMOTE_STORAGE_ROOT_DIR, 'can', 'sap-config', 'sap-gui-flow')
                : '/home/fits/lek-files/can/sap-config/sap-gui-flow',
            timeout: 30000 // 30 segundos
        };
    }

    /**
     * Crea un cliente SFTP
     */
    createClient() {
        const client = new Client();
        return client;
    }

    /**
     * Lista todos los archivos JSON del directorio SFTP configurado
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Lista de archivos JSON
     */
    async listJsonFiles(retries = 2) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            const client = this.createClient();
            
            try {
                // Configuración de conexión más compatible
                const connectionConfig = {
                    host: this.config.host,
                    port: this.config.port,
                    username: this.config.username,
                    password: this.config.password,
                    readyTimeout: this.config.timeout,
                    keepaliveInterval: 20000,
                    keepaliveCountMax: 3,
                    tryKeyboard: false,
                    strictVendor: false
                };

                await client.connect(connectionConfig);

                // Verificar si el directorio existe, si no, intentar listar desde el directorio raíz
                let targetDirectory = this.config.baseDirectory;
                let directoryExists = false;
                
                try {
                    directoryExists = await client.exists(targetDirectory);
                } catch (error) {
                    // Si hay error, asumir que no existe
                    directoryExists = false;
                }

                // Si el directorio no existe, intentar desde el directorio raíz
                if (!directoryExists) {
                    console.warn(`Directorio ${targetDirectory} no existe, intentando alternativas`);
                    // Intentar desde /home/fits/lek-files
                    const rootDir = process.env.REMOTE_STORAGE_ROOT_DIR || '/home/fits/lek-files';
                    try {
                        const rootExists = await client.exists(rootDir);
                        if (rootExists) {
                            targetDirectory = rootDir;
                            console.log(`Usando directorio raíz: ${targetDirectory}`);
                        } else {
                            // Intentar desde el home del usuario
                            targetDirectory = '/home/fits';
                            console.log(`Usando directorio home: ${targetDirectory}`);
                        }
                    } catch (error) {
                        targetDirectory = '/home/fits';
                        console.log(`Usando directorio home: ${targetDirectory}`);
                    }
                }

                // Listar archivos en el directorio
                const files = await client.list(targetDirectory);
                
                // Filtrar solo archivos JSON (no directorios, no ocultos, extensión .json)
                const jsonFiles = files
                    .filter(file => {
                        return !file.type || file.type === '-' || file.type === 'f'; // Solo archivos
                    })
                    .filter(file => {
                        const fileName = file.name.toLowerCase();
                        return fileName.endsWith('.json') && !fileName.startsWith('.');
                    })
                    .map(file => ({
                        name: file.name,
                        path: path.join(targetDirectory, file.name).replace(/\\/g, '/'),
                        size: file.size || 0,
                        modifiedDate: file.modifyTime || file.date || new Date().toISOString(),
                        isDirectory: false
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name)); // Ordenar alfabéticamente

                const message = targetDirectory !== this.config.baseDirectory
                    ? `Archivos listados desde ${targetDirectory} (directorio configurado no existe)`
                    : 'Archivos listados correctamente';

                await client.end();

                return {
                    status: true,
                    message: message,
                    files: jsonFiles,
                    actualDirectory: targetDirectory
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al listar archivos desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                try {
                    await client.end();
                } catch (endError) {
                    // Ignorar errores al cerrar
                }

                // Si no es el último intento, esperar un poco antes de reintentar
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    continue;
                }
            }
        }

        // Si llegamos aquí, todos los intentos fallaron
        return {
            status: false,
            message: `Error al conectar con el servidor SFTP después de ${retries + 1} intentos: ${lastError ? lastError.message : 'Error desconocido'}`,
            files: []
        };
    }

    /**
     * Obtiene el contenido completo de un archivo JSON específico
     * @param {string} filePath - Ruta del archivo a leer
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Contenido del archivo
     */
    async getFileContent(filePath, retries = 2) {
        // Validar que la ruta sea válida (permitir rutas absolutas o relativas)
        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            return {
                status: false,
                message: 'La ruta del archivo es requerida',
                content: null,
                fileName: null
            };
        }

        // Validar que sea un archivo JSON
        if (!filePath.toLowerCase().endsWith('.json')) {
            return {
                status: false,
                message: 'El archivo debe tener extensión .json',
                content: null,
                fileName: null
            };
        }

        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            const client = this.createClient();
            
            try {
                // Configuración de conexión más compatible
                const connectionConfig = {
                    host: this.config.host,
                    port: this.config.port,
                    username: this.config.username,
                    password: this.config.password,
                    readyTimeout: this.config.timeout,
                    keepaliveInterval: 20000,
                    keepaliveCountMax: 3,
                    tryKeyboard: false,
                    strictVendor: false
                };

                await client.connect(connectionConfig);

                // Verificar que el archivo existe
            const exists = await client.exists(filePath);
            if (!exists) {
                await client.end();
                return {
                    status: false,
                    message: 'Archivo no encontrado',
                    content: null,
                    fileName: null
                };
            }

            // Leer el contenido del archivo
            const content = await client.get(filePath, null, null);
            
            // Convertir buffer a string si es necesario
            const contentString = Buffer.isBuffer(content) 
                ? content.toString('utf8') 
                : content;

            // Validar que es JSON válido
            try {
                JSON.parse(contentString);
            } catch (jsonError) {
                await client.end();
                return {
                    status: false,
                    message: 'El archivo no contiene JSON válido',
                    content: null,
                    fileName: null
                };
            }

                const fileName = path.basename(filePath);

                await client.end();

                return {
                    status: true,
                    message: 'Archivo cargado correctamente',
                    content: contentString,
                    fileName: fileName
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al leer archivo desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                try {
                    await client.end();
                } catch (endError) {
                    // Ignorar errores al cerrar
                }

                // Si no es el último intento, esperar un poco antes de reintentar
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    continue;
                }
            }
        }

        // Si llegamos aquí, todos los intentos fallaron
        return {
            status: false,
            message: `Error al leer el archivo después de ${retries + 1} intentos: ${lastError ? lastError.message : 'Error desconocido'}`,
            content: null,
            fileName: null
        };
    }

    /**
     * Valida que la ruta del archivo sea segura y esté dentro del directorio base
     * @param {string} filePath - Ruta a validar
     * @returns {boolean} True si la ruta es válida
     */
    isValidFilePath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return false;
        }

        // Normalizar rutas (remover .. y .)
        const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
        const normalizedBase = path.normalize(this.config.baseDirectory).replace(/\\/g, '/');

        // Verificar que la ruta esté dentro del directorio base
        if (!normalizedPath.startsWith(normalizedBase)) {
            return false;
        }

        // Verificar que sea un archivo JSON
        if (!normalizedPath.toLowerCase().endsWith('.json')) {
            return false;
        }

        // Verificar que no contenga caracteres peligrosos
        if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
            return false;
        }

        return true;
    }

    /**
     * Prueba la conexión SFTP
     * @returns {Promise<Object>} Resultado de la prueba
     */
    async testConnection() {
        try {
            const listResult = await this.listJsonFiles();
            
            return {
                status: listResult.status,
                message: listResult.status 
                    ? 'Conexión SFTP exitosa' 
                    : listResult.message,
                host: this.config.host,
                directory: this.config.baseDirectory,
                fileCount: listResult.files ? listResult.files.length : 0
            };
        } catch (error) {
            console.error('Error al probar conexión SFTP:', error);
            return {
                status: false,
                message: `Error al conectar: ${error.message}`,
                host: this.config.host,
                directory: this.config.baseDirectory,
                fileCount: 0
            };
        }
    }

    /**
     * Obtiene la configuración actual (sin credenciales)
     * @returns {Object} Configuración sin contraseña
     */
    getConfig() {
        return {
            host: this.config.host,
            port: this.config.port,
            username: this.config.username,
            baseDirectory: this.config.baseDirectory,
            timeout: this.config.timeout
        };
    }
}

module.exports = SftpService;

