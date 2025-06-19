/**
 * Módulo Generador de Flujos
 * 
 * Transforma los pasos procesados en flujos estructurados
 * siguiendo el esquema definido en el instructivo.
 */

/**
 * Genera un flujo estructurado a partir de los datos procesados
 * @param {Object} parsedData - Datos procesados por el parser
 * @param {string} tcode - Código de transacción
 * @param {Object} prefixes - Prefijos generados
 * @param {Object} aliases - Alias generados
 * @returns {Object} - Flujo estructurado
 */
function generateFlow(parsedData, tcode, prefixes, aliases) {
    console.log(`  Generando flujo para ${tcode}...`);
    
    const flow = {
        steps: {},
        metadata: {
            tcode: tcode,
            version: "1.0",
            created: new Date().toISOString().split('T')[0],
            controlTypes: Array.from(parsedData.controlTypes || [])
        }
    };
    
    // Generar pasos del flujo
    parsedData.steps.forEach(step => {
        const stepId = step.id;
        
        // Crear el paso en el formato de salida
        flow.steps[stepId] = {
            action: step.action
        };
        
        // Agregar target si existe
        if (step.target) {
            // Usar alias si se encontró uno
            flow.steps[stepId].target = aliases[step.target] || step.target;
        }
        
        // Agregar método y paramKey para callProgram
        if (step.action === 'callProgram') {
            flow.steps[stepId].method = step.method;
            flow.steps[stepId].paramKey = step.paramKey;
        }
        
        // Agregar paramKey para set
        if (step.action === 'set' && step.paramKey) {
            flow.steps[stepId].paramKey = step.paramKey;
        }
        
        // Agregar next si no es el último paso
        if (step.next && step.next !== 'end') {
            flow.steps[stepId].next = step.next;
        }
        
        // Agregar campos adicionales según el tipo de acción
        if (step.action === 'condition') {
            flow.steps[stepId].operator = step.operator || 'exists';
            flow.steps[stepId].true = step.true || 'end';
            flow.steps[stepId].false = step.false || 'end';
        }
        
        if (step.action === 'waitFor' && step.timeout) {
            flow.steps[stepId].timeout = step.timeout;
        }
        
        // Si es un paso de tipo set con un valor predeterminado, agregarlo
        if (step.paramValue !== undefined) {
            flow.steps[stepId].paramValue = step.paramValue;
        }
        
        // Agregar tipo de control si existe
        if (step.controlType) {
            flow.steps[stepId].controlType = step.controlType;
        }
    });
    
    // Arreglar las referencias next
    fixNextReferences(flow.steps, parsedData.steps);
    
    return flow;
}

/**
 * Genera un ID descriptivo para un paso
 * @param {Object} step - Paso procesado
 * @param {string} tcode - Código de transacción
 * @returns {string} - ID descriptivo
 */
function generateStepId(step, tcode) {
    // Si ya tiene un ID, usarlo
    if (step.id) {
        return step.id;
    }
    
    // Generar ID basado en la acción y el target
    if (step.action === 'callProgram' && step.method === 'sapSession.StartTransaction') {
        return 'startTransaction';
    } else if (step.action === 'exit') {
        return 'end';
    }
    
    // Para otros pasos, usar formato descriptivo
    let baseId = '';
    
    switch (step.action) {
        case 'set':
            baseId = `set${step.paramKey || 'Value'}`;
            break;
        case 'click':
            if (step.target && step.target.includes('execBtn')) {
                baseId = 'clickExecute';
            } else if (step.target && step.target.includes('accept')) {
                baseId = 'acceptPopup';
            } else {
                baseId = 'clickButton';
            }
            break;
        case 'waitFor':
            baseId = 'waitFor';
            if (step.target) {
                const targetParts = step.target.split('.');
                if (targetParts.length > 1) {
                    baseId += capitalizeFirst(targetParts[targetParts.length - 1]);
                }
            }
            break;
        case 'condition':
            baseId = 'check';
            if (step.target) {
                const targetParts = step.target.split('.');
                if (targetParts.length > 1) {
                    baseId += capitalizeFirst(targetParts[targetParts.length - 1]);
                }
            }
            break;
        default:
            baseId = step.action || 'step';
    }
    
    return baseId;
}

/**
 * Arregla las referencias next entre los pasos
 * @param {Object} outputSteps - Pasos en formato de salida
 * @param {Array} parsedSteps - Pasos procesados
 */
function fixNextReferences(outputSteps, parsedSteps) {
    // Crear mapeo de IDs originales a IDs descriptivos
    const idMapping = new Map();
    parsedSteps.forEach((step, index) => {
        const originalId = step.id || `step${index}`;
        const descriptiveId = Object.keys(outputSteps).find(
            key => outputSteps[key].action === step.action && 
                   (step.target ? outputSteps[key].target === step.aliasTarget : true)
        );
        
        if (descriptiveId) {
            idMapping.set(originalId, descriptiveId);
        }
    });
    
    // Actualizar referencias next
    Object.keys(outputSteps).forEach(stepId => {
        const step = outputSteps[stepId];
        
        if (step.next && idMapping.has(step.next)) {
            step.next = idMapping.get(step.next);
        }
        
        if (step.true && idMapping.has(step.true)) {
            step.true = idMapping.get(step.true);
        }
        
        if (step.false && idMapping.has(step.false)) {
            step.false = idMapping.get(step.false);
        }
    });
    
    // Asegurar que hay continuidad en las referencias next
    ensureNextContinuity(outputSteps);
}

/**
 * Asegura que hay continuidad en las referencias next
 * @param {Object} steps - Pasos en formato de salida
 */
function ensureNextContinuity(steps) {
    const stepIds = Object.keys(steps);
    
    // Asegurar que cada paso (excepto el último) tiene un next
    stepIds.forEach((stepId, index) => {
        const step = steps[stepId];
        
        // Si es el último paso y no tiene acción exit, agregar referencia a "end"
        if (index === stepIds.length - 1 && step.action !== 'exit' && !step.next) {
            step.next = 'end';
        }
        
        // Si no es el último paso y no tiene next, apuntar al siguiente paso
        if (index < stepIds.length - 1 && !step.next) {
            step.next = stepIds[index + 1];
        }
    });
    
    // Asegurar que existe un paso "end" con acción "exit"
    if (!steps.end) {
        steps.end = { action: 'exit' };
    }
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
    generateFlow
}; 