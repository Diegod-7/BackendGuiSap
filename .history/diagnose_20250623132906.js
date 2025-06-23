#!/usr/bin/env node

/**
 * Script de diagnóstico para SAP-GUI-Flow
 * Ejecutar con: node diagnose.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Diagnóstico de SAP-GUI-Flow');
console.log('================================\n');

// Configuración
const config = {
    inputDir: './sap-gui-env',
    outputDir: './output'
};

function checkDirectory(dirPath, name) {
    console.log(`📁 Verificando ${name}:`);
    console.log(`   Ruta: ${path.resolve(dirPath)}`);
    
    if (fs.existsSync(dirPath)) {
        console.log('   ✅ Directorio existe');
        
        try {
            const files = fs.readdirSync(dirPath);
            console.log(`   📄 Archivos encontrados: ${files.length}`);
            
            if (files.length > 0) {
                files.forEach(file => {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    console.log(`      - ${file} (${stats.size} bytes)`);
                });
            }
            
            // Verificar permisos
            fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
            console.log('   ✅ Permisos de lectura/escritura: OK');
            
        } catch (error) {
            console.log(`   ❌ Error al acceder al directorio: ${error.message}`);
        }
    } else {
        console.log('   ❌ Directorio no existe');
        
        try {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log('   ✅ Directorio creado');
        } catch (error) {
            console.log(`   ❌ Error al crear directorio: ${error.message}`);
        }
    }
    console.log('');
}

function checkDependencies() {
    console.log('📦 Verificando dependencias:');
    
    const dependencies = [
        'express',
        'multer', 
        'extract-zip',
        'archiver'
    ];
    
    dependencies.forEach(dep => {
        try {
            require(dep);
            console.log(`   ✅ ${dep}: OK`);
        } catch (error) {
            console.log(`   ❌ ${dep}: No encontrado`);
        }
    });
    console.log('');
}

function checkEnvironment() {
    console.log('🌍 Información del entorno:');
    console.log(`   Node.js: ${process.version}`);
    console.log(`   Plataforma: ${process.platform}`);
    console.log(`   Arquitectura: ${process.arch}`);
    console.log(`   Directorio de trabajo: ${process.cwd()}`);
    console.log(`   Usuario: ${process.env.USER || process.env.USERNAME || 'desconocido'}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'no definido'}`);
    console.log('');
}

function checkMemoryAndDisk() {
    console.log('💾 Recursos del sistema:');
    
    // Memoria
    const memUsage = process.memoryUsage();
    console.log(`   Memoria RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB`);
    console.log(`   Memoria Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`);
    
    // Espacio en disco (aproximado)
    try {
        const stats = fs.statSync('.');
        console.log('   ✅ Acceso al sistema de archivos: OK');
    } catch (error) {
        console.log(`   ❌ Error de acceso al sistema de archivos: ${error.message}`);
    }
    console.log('');
}

// Ejecutar diagnósticos
async function runDiagnostics() {
    try {
        checkEnvironment();
        checkMemoryAndDisk();
        checkDependencies();
        checkDirectory(config.inputDir, 'Directorio de entrada (sap-gui-env)');
        checkDirectory(config.outputDir, 'Directorio de salida (output)');
        
        console.log('🎯 Diagnóstico completado');
        console.log('========================\n');
        
        // Sugerencias
        console.log('💡 Sugerencias:');
        console.log('   1. Verificar que los directorios tengan permisos correctos');
        console.log('   2. Asegurar que el ZIP contiene archivos .json válidos');
        console.log('   3. Revisar los logs del servidor para más detalles');
        console.log('   4. Usar el endpoint /api/debug/info para más información');
        
    } catch (error) {
        console.error('❌ Error durante el diagnóstico:', error);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    runDiagnostics();
}

module.exports = { runDiagnostics, checkDirectory, checkDependencies }; 