/**
 * Módulo Orquestador
 * 
 * Genera el archivo principal mainFlow.json que coordina
 * todos los subflujos de las transacciones SAP.
 */

/**
 * Genera el archivo principal mainFlow.json
 * @param {Array} tcodes - Códigos de transacción procesados
 * @param {Object} prefixes - Prefijos generados
 * @param {Object} aliases - Alias generados
 * @param {Object} metaInfo - Información de metadatos
 * @returns {Object} - Estructura completa del mainFlow
 */
function generateMainFlow(tcodes, prefixes, aliases, metaInfo) {
    console.log('  Generando estructura de mainFlow.json...');
    
    // Crear estructura básica
    const mainFlow = {
        $meta: {
            version: metaInfo.version || '1.0',
            tx: metaInfo.tx || 'mainFlow generado automáticamente',
            created: metaInfo.created || new Date().toISOString().split('T')[0]
        },
        prefixes: prefixes,
        aliases: aliases,
        $mainFlow: {
            steps: {}
        }
    };
    
    // Generar pasos para llamar a cada subflujo
    tcodes.forEach((tcode, index) => {
        const stepId = `run${capitalizeFirst(tcode)}`;
        const nextTcode = index < tcodes.length - 1 ? tcodes[index + 1] : null;
        
        const step = {
            action: 'callSubflow',
            subflow: tcode
        };
        
        // Definir el siguiente paso (si no es el último)
        if (nextTcode) {
            step.next = `run${capitalizeFirst(nextTcode)}`;
        } else {
            step.next = 'end';
        }
        
        mainFlow.$mainFlow.steps[stepId] = step;
    });
    
    // Agregar paso final
    mainFlow.$mainFlow.steps.end = {
        action: 'exit'
    };
    
    return mainFlow;
}

/**
 * Capitaliza la primera letra de una cadena
 * @param {string} str - Cadena a capitalizar
 * @returns {string} - Cadena capitalizada
 */
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
    generateMainFlow
}; 