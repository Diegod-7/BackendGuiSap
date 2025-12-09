/**
 * Módulo de servicio SFTP usando ssh2 directamente (más robusto)
 */

const { Client } = require('ssh2');
const path = require('path');

class SftpServiceV2 {
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
            packageDirectory: '/home/fits/lek-files/can/sap-config/sap-query-package',
            targetsDirectory: '/home/fits/lek-files/can/sap-config/sap-gui-flow/sap-targets',
            timeout: 30000, // 30 segundos
            maxFileSizeBytes: 10 * 1024 * 1024 // 10MB
        };
    }

    /**
     * Crea una conexión SFTP
     */
    async createConnection() {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        conn.end();
                        reject(err);
                    } else {
                        resolve({ conn, sftp });
                    }
                });
            });

            conn.on('error', (err) => {
                reject(err);
            });

            conn.connect({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                password: this.config.password,
                readyTimeout: this.config.timeout,
                keepaliveInterval: 20000,
                keepaliveCountMax: 3,
                tryKeyboard: false,
                strictVendor: false
            });
        });
    }

    /**
     * Lista todos los archivos JSON del directorio SFTP configurado
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Lista de archivos JSON
     */
    async listJsonFiles(retries = 2) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;
            
            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                // Verificar si el directorio existe, si no, intentar listar desde el directorio raíz
                let targetDirectory = this.config.baseDirectory;
                
                try {
                    const stats = await this.sftpStat(sftp, targetDirectory);
                    if (!stats.isDirectory()) {
                        targetDirectory = this.config.baseDirectory;
                    }
                } catch (error) {
                    // Si hay error, intentar alternativas
                    console.warn(`Directorio ${targetDirectory} no existe, intentando alternativas`);
                    const rootDir = process.env.REMOTE_STORAGE_ROOT_DIR || '/home/fits/lek-files';
                    try {
                        await this.sftpStat(sftp, rootDir);
                        targetDirectory = rootDir;
                        console.log(`Usando directorio raíz: ${targetDirectory}`);
                    } catch (error2) {
                        targetDirectory = '/home/fits';
                        console.log(`Usando directorio home: ${targetDirectory}`);
                    }
                }

                // Listar archivos en el directorio
                const files = await this.sftpReadDir(sftp, targetDirectory);
                
                // Filtrar solo archivos JSON (no directorios, no ocultos, extensión .json)
                // file.type === 1 es archivo regular, file.type === 2 es directorio
                const jsonFiles = files
                    .filter(file => {
                        // Verificar que no sea directorio y que tenga extensión .json
                        const fileName = file.filename.toLowerCase();
                        return file.longname && !file.longname.startsWith('d') && // No es directorio
                               fileName.endsWith('.json') && 
                               !fileName.startsWith('.');
                    })
                    .map(file => {
                        // Obtener tamaño y fecha de modificación
                        const attrs = file.attrs || {};
                        const size = attrs.size || 0;
                        const mtime = attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : new Date().toISOString();
                        
                        return {
                            name: file.filename,
                            path: path.join(targetDirectory, file.filename).replace(/\\/g, '/'),
                            size: size,
                            modifiedDate: mtime,
                            isDirectory: false
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name)); // Ordenar alfabéticamente

                conn.end();

                const message = targetDirectory !== this.config.baseDirectory
                    ? `Archivos listados desde ${targetDirectory} (directorio configurado no existe)`
                    : 'Archivos listados correctamente';

                return {
                    status: true,
                    message: message,
                    files: jsonFiles,
                    actualDirectory: targetDirectory
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al listar archivos desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
        // Validar que la ruta sea válida
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
            let conn = null;
            let sftp = null;
            
            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                // Verificar que el archivo existe
                try {
                    await this.sftpStat(sftp, filePath);
                } catch (error) {
                    conn.end();
                    return {
                        status: false,
                        message: 'Archivo no encontrado',
                        content: null,
                        fileName: null
                    };
                }

                // Leer el contenido del archivo
                const content = await this.sftpReadFile(sftp, filePath);
                
                // Convertir buffer a string
                const contentString = Buffer.isBuffer(content) 
                    ? content.toString('utf8') 
                    : content;

                // Validar que es JSON válido
                try {
                    JSON.parse(contentString);
                } catch (jsonError) {
                    conn.end();
                    return {
                        status: false,
                        message: 'El archivo no contiene JSON válido',
                        content: null,
                        fileName: null
                    };
                }

                const fileName = path.basename(filePath);

                conn.end();

                return {
                    status: true,
                    message: 'Archivo cargado correctamente',
                    content: contentString,
                    fileName: fileName
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al leer archivo desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
     * Wrapper para sftp.stat
     */
    sftpStat(sftp, path) {
        return new Promise((resolve, reject) => {
            sftp.stat(path, (err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        });
    }

    /**
     * Wrapper para sftp.readdir
     */
    sftpReadDir(sftp, path) {
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) reject(err);
                else resolve(list);
            });
        });
    }

    /**
     * Wrapper para sftp.readFile
     */
    sftpReadFile(sftp, path) {
        return new Promise((resolve, reject) => {
            sftp.readFile(path, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
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
     * Sanitiza el nombre del archivo
     * @param {string} fileName - Nombre a sanitizar
     * @returns {string} Nombre sanitizado
     */
    sanitizeFileName(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return 'PACKAGE_' + new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
        }

        // Reemplazar espacios por guiones bajos
        let sanitized = fileName.replace(/\s+/g, '_');

        // Eliminar caracteres especiales (mantener solo letras, números, guiones y guiones bajos)
        sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

        // Convertir a mayúsculas
        sanitized = sanitized.toUpperCase();

        // Limitar longitud (100 caracteres)
        if (sanitized.length > 100) {
            sanitized = sanitized.substring(0, 100);
        }

        // Asegurar que no esté vacío
        if (!sanitized || sanitized.length === 0) {
            sanitized = 'PACKAGE_' + new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
        }

        return sanitized;
    }

    /**
     * Crea un directorio en SFTP si no existe
     */
    async sftpMkdir(sftp, dirPath) {
        return new Promise((resolve, reject) => {
            sftp.mkdir(dirPath, (err) => {
                if (err && err.code !== 4) { // 4 = File already exists
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Crea directorios recursivamente
     */
    async sftpMkdirRecursive(sftp, dirPath) {
        const parts = dirPath.split('/').filter(p => p);
        let currentPath = '';

        for (const part of parts) {
            currentPath += '/' + part;
            try {
                await this.sftpMkdir(sftp, currentPath);
            } catch (error) {
                // Ignorar si el directorio ya existe
                if (error.code !== 4) {
                    throw error;
                }
            }
        }
    }

    /**
     * Escribe un archivo en SFTP
     */
    sftpWriteFile(sftp, filePath, data) {
        return new Promise((resolve, reject) => {
            sftp.writeFile(filePath, data, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Guarda un paquete completo en el servidor SFTP
     * @param {string} packageName - Nombre del paquete
     * @param {object} packageData - Datos del paquete
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Resultado de la operación
     */
    async savePackageToSftp(packageName, packageData, retries = 2) {
        // Validaciones
        if (!packageName || typeof packageName !== 'string' || !packageName.trim()) {
            return {
                status: false,
                message: 'El nombre del paquete es requerido',
                filePath: null,
                fileName: null
            };
        }

        if (!packageData || typeof packageData !== 'object') {
            return {
                status: false,
                message: 'Los datos del paquete son requeridos',
                filePath: null,
                fileName: null
            };
        }

        // Serializar a JSON
        let jsonContent;
        try {
            jsonContent = JSON.stringify(packageData, null, 2);
        } catch (error) {
            return {
                status: false,
                message: `Error al serializar los datos del paquete: ${error.message}`,
                filePath: null,
                fileName: null
            };
        }

        // Validar tamaño
        const contentBytes = Buffer.from(jsonContent, 'utf8');
        if (contentBytes.length > this.config.maxFileSizeBytes) {
            const sizeMB = (contentBytes.length / 1024 / 1024).toFixed(2);
            return {
                status: false,
                message: `El archivo excede el tamaño máximo permitido (10MB). Tamaño actual: ${sizeMB}MB`,
                filePath: null,
                fileName: null
            };
        }

        // Sanitizar nombre del archivo
        const sanitizedName = this.sanitizeFileName(packageName.trim());
        const fileName = `${sanitizedName}.json`;

        // Construir ruta completa
        const targetDirectory = this.config.packageDirectory;
        const filePath = path.join(targetDirectory, fileName).replace(/\\/g, '/');

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;

            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                // Crear directorio si no existe
                try {
                    await this.sftpMkdirRecursive(sftp, targetDirectory);
                } catch (error) {
                    console.warn(`No se pudo crear el directorio ${targetDirectory}:`, error.message);
                    // Continuar, puede que ya exista
                }

                // Guardar archivo
                await this.sftpWriteFile(sftp, filePath, contentBytes);

                conn.end();

                console.log(`Paquete guardado en SFTP: ${filePath}`);

                return {
                    status: true,
                    message: 'Paquete guardado correctamente en SFTP',
                    filePath: filePath,
                    fileName: fileName
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al guardar paquete en SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);

                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
                }

                // Si no es el último intento, esperar un poco antes de reintentar
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    continue;
                }
            }
        }

        // Si llegamos aquí, todos los intentos fallaron
        let errorMessage = 'Error al guardar el archivo';
        if (lastError) {
            if (lastError.message.includes('permission') || lastError.message.includes('Permission')) {
                errorMessage = 'No se tienen permisos para escribir en el directorio SFTP';
            } else if (lastError.message.includes('connection') || lastError.message.includes('ECONNRESET')) {
                errorMessage = `Error de conexión con el servidor SFTP: ${lastError.message}`;
            } else {
                errorMessage = `Error al guardar el archivo: ${lastError.message}`;
            }
        }

        return {
            status: false,
            message: errorMessage,
            filePath: null,
            fileName: null
        };
    }

    /**
     * Lista todos los paquetes guardados en el directorio de paquetes
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Lista de paquetes
     */
    async listPackages(retries = 2) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;
            
            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                const packageDirectory = this.config.packageDirectory;

                // Verificar que el directorio existe
                let directoryExists = false;
                try {
                    await this.sftpStat(sftp, packageDirectory);
                    directoryExists = true;
                } catch (error) {
                    directoryExists = false;
                }

                if (!directoryExists) {
                    conn.end();
                    return {
                        status: true,
                        message: 'Directorio de paquetes no existe o está vacío',
                        files: []
                    };
                }

                // Listar archivos en el directorio
                const files = await this.sftpReadDir(sftp, packageDirectory);
                
                // Filtrar solo archivos JSON (no directorios, no ocultos, extensión .json)
                const packages = files
                    .filter(file => {
                        // Verificar que no sea directorio y que tenga extensión .json
                        const fileName = file.filename.toLowerCase();
                        return file.longname && !file.longname.startsWith('d') && // No es directorio
                               fileName.endsWith('.json') && 
                               !fileName.startsWith('.');
                    })
                    .map(file => {
                        const attrs = file.attrs || {};
                        const size = attrs.size || 0;
                        const mtime = attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : new Date().toISOString();
                        
                        return {
                            name: file.filename,
                            path: path.join(packageDirectory, file.filename).replace(/\\/g, '/'),
                            size: size,
                            modifiedDate: mtime,
                            isDirectory: false
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name)); // Ordenar alfabéticamente

                conn.end();

                return {
                    status: true,
                    message: 'Paquetes listados correctamente',
                    files: packages
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al listar paquetes desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
     * Verifica si un paquete con el nombre especificado ya existe
     * @param {string} packageName - Nombre del paquete
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Resultado de la verificación
     */
    async checkPackageExists(packageName, retries = 2) {
        if (!packageName || typeof packageName !== 'string' || !packageName.trim()) {
            return {
                exists: false
            };
        }

        // Sanitizar el nombre del paquete (mismo método usado al guardar)
        const sanitizedName = this.sanitizeFileName(packageName.trim());
        const fileName = `${sanitizedName}.json`;
        const packageDirectory = this.config.packageDirectory;
        const filePath = path.join(packageDirectory, fileName).replace(/\\/g, '/');

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;

            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                // Verificar si el archivo existe
                let exists = false;
                try {
                    await this.sftpStat(sftp, filePath);
                    exists = true;
                } catch (error) {
                    exists = false;
                }

                conn.end();

                return {
                    exists: exists,
                    filePath: exists ? filePath : null
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al verificar existencia de paquete (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
            exists: false,
            error: lastError ? lastError.message : 'Error desconocido'
        };
    }

    /**
     * Lista todos los flujos (JSON y ZIP) del directorio de flujos SFTP
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Lista de flujos
     */
    async listFlows(retries = 2) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;
            
            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                const flowsDirectory = this.config.baseDirectory;

                // Verificar que el directorio existe
                let directoryExists = false;
                try {
                    await this.sftpStat(sftp, flowsDirectory);
                    directoryExists = true;
                } catch (error) {
                    directoryExists = false;
                }

                if (!directoryExists) {
                    conn.end();
                    return {
                        status: true,
                        message: 'Directorio de flujos no existe o está vacío',
                        files: []
                    };
                }

                // Listar archivos en el directorio
                const files = await this.sftpReadDir(sftp, flowsDirectory);
                
                // Filtrar solo archivos JSON y ZIP (no directorios, no ocultos)
                const flows = files
                    .filter(file => {
                        // Verificar que no sea directorio
                        if (file.longname && file.longname.startsWith('d')) {
                            return false;
                        }
                        
                        const fileName = file.filename.toLowerCase();
                        // Incluir archivos .json y .zip, excluir ocultos
                        return (fileName.endsWith('.json') || fileName.endsWith('.zip')) && 
                               !fileName.startsWith('.');
                    })
                    .map(file => {
                        const attrs = file.attrs || {};
                        const size = attrs.size || 0;
                        const mtime = attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : new Date().toISOString();
                        
                        return {
                            name: file.filename,
                            path: path.join(flowsDirectory, file.filename).replace(/\\/g, '/'),
                            size: size,
                            modifiedDate: mtime,
                            isDirectory: false
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name)); // Ordenar alfabéticamente

                conn.end();

                return {
                    status: true,
                    message: 'Flujos listados correctamente',
                    files: flows
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al listar flujos desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
     * Guarda un flujo completo en el servidor SFTP
     * @param {string} fileName - Nombre del archivo
     * @param {object} flowData - Datos del flujo
     * @param {boolean} overwrite - Si true, sobrescribe si existe
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Resultado de la operación
     */
    async saveFlowToSftp(fileName, flowData, overwrite = false, retries = 2) {
        // Validaciones
        if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
            return {
                status: false,
                message: 'El nombre del archivo es requerido',
                filePath: null,
                fileName: null
            };
        }

        if (!flowData || typeof flowData !== 'object') {
            return {
                status: false,
                message: 'Los datos del flujo son requeridos',
                filePath: null,
                fileName: null
            };
        }

        // Serializar a JSON
        let jsonContent;
        try {
            jsonContent = JSON.stringify(flowData, null, 2);
        } catch (error) {
            return {
                status: false,
                message: `Error al serializar los datos del flujo: ${error.message}`,
                filePath: null,
                fileName: null
            };
        }

        // Validar tamaño
        const contentBytes = Buffer.from(jsonContent, 'utf8');
        if (contentBytes.length > this.config.maxFileSizeBytes) {
            const sizeMB = (contentBytes.length / 1024 / 1024).toFixed(2);
            return {
                status: false,
                message: `El archivo excede el tamaño máximo permitido (10MB). Tamaño actual: ${sizeMB}MB`,
                filePath: null,
                fileName: null
            };
        }

        // Asegurar extensión .json
        let finalFileName = fileName.trim();
        if (!finalFileName.toLowerCase().endsWith('.json')) {
            finalFileName += '.json';
        }

        // Sanitizar nombre del archivo
        const sanitizedName = this.sanitizeFileName(finalFileName.replace('.json', ''));
        const finalFileNameSanitized = `${sanitizedName}.json`;

        // Construir ruta completa (directorio de flujos)
        const targetDirectory = this.config.baseDirectory;
        const filePath = path.join(targetDirectory, finalFileNameSanitized).replace(/\\/g, '/');

        // Verificar si existe (si no se permite overwrite)
        if (!overwrite) {
            try {
                const connection = await this.createConnection();
                const conn = connection.conn;
                const sftp = connection.sftp;

                try {
                    await this.sftpStat(sftp, filePath);
                    // El archivo existe
                    conn.end();
                    return {
                        status: false,
                        message: 'El archivo ya existe. Use overwrite=true para sobrescribirlo.',
                        filePath: filePath,
                        fileName: finalFileNameSanitized,
                        exists: true
                    };
                } catch (statError) {
                    // El archivo no existe, continuar
                    conn.end();
                }
            } catch (checkError) {
                // Error al verificar, continuar con el guardado
                console.warn('Error al verificar existencia del archivo:', checkError.message);
            }
        }

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;

            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                // Crear directorio si no existe
                try {
                    await this.sftpMkdirRecursive(sftp, targetDirectory);
                } catch (error) {
                    console.warn(`No se pudo crear el directorio ${targetDirectory}:`, error.message);
                    // Continuar, puede que ya exista
                }

                // Guardar archivo
                await this.sftpWriteFile(sftp, filePath, contentBytes);

                conn.end();

                console.log(`Flujo guardado en SFTP: ${filePath}`);

                return {
                    status: true,
                    message: 'Flujo guardado correctamente en SFTP',
                    filePath: filePath,
                    fileName: finalFileNameSanitized
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al guardar flujo en SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
            message: `Error al guardar el flujo en SFTP después de ${retries + 1} intentos: ${lastError ? lastError.message : 'Error desconocido'}`,
            filePath: null,
            fileName: null
        };
    }

    /**
     * Lista todos los targets disponibles en el directorio de targets SFTP
     * @param {number} retries - Número de reintentos
     * @returns {Promise<Object>} Lista de targets
     */
    async listTargets(retries = 2) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            let conn = null;
            let sftp = null;
            
            try {
                const connection = await this.createConnection();
                conn = connection.conn;
                sftp = connection.sftp;

                const targetsDirectory = this.config.targetsDirectory;

                // Verificar que el directorio existe
                let directoryExists = false;
                try {
                    await this.sftpStat(sftp, targetsDirectory);
                    directoryExists = true;
                } catch (error) {
                    directoryExists = false;
                }

                if (!directoryExists) {
                    conn.end();
                    return {
                        status: true,
                        message: 'No se encontraron targets en el directorio',
                        files: []
                    };
                }

                // Listar archivos en el directorio
                const files = await this.sftpReadDir(sftp, targetsDirectory);
                
                // Filtrar solo archivos JSON (no directorios, no ocultos)
                const targets = files
                    .filter(file => {
                        // Verificar que no sea directorio y que tenga extensión .json
                        const fileName = file.filename.toLowerCase();
                        return file.longname && !file.longname.startsWith('d') && // No es directorio
                               fileName.endsWith('.json') && 
                               !fileName.startsWith('.');
                    })
                    .map(file => {
                        const attrs = file.attrs || {};
                        const size = attrs.size || 0;
                        const mtime = attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : new Date().toISOString();
                        
                        return {
                            name: file.filename,
                            path: path.join(targetsDirectory, file.filename).replace(/\\/g, '/'),
                            size: size,
                            modifiedDate: mtime,
                            isDirectory: false
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name)); // Ordenar alfabéticamente

                conn.end();

                return {
                    status: true,
                    message: targets.length > 0 
                        ? `Se encontraron ${targets.length} target(s)`
                        : 'No se encontraron targets en el directorio',
                    files: targets
                };
            } catch (error) {
                lastError = error;
                console.error(`Error al listar targets desde SFTP (intento ${attempt + 1}/${retries + 1}):`, error.message);
                
                if (conn) {
                    try {
                        conn.end();
                    } catch (endError) {
                        // Ignorar errores al cerrar
                    }
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
            message: `Error al listar targets después de ${retries + 1} intentos: ${lastError ? lastError.message : 'Error desconocido'}`,
            files: []
        };
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
            packageDirectory: this.config.packageDirectory,
            targetsDirectory: this.config.targetsDirectory,
            timeout: this.config.timeout
        };
    }
}

module.exports = SftpServiceV2;

