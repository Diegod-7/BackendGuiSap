/**
 * Módulo Parser
 * 
 * Analiza los archivos de registro SAP y extrae información estructurada
 * para su posterior transformación en flujos.
 */

// Mapeo de acciones SAP a acciones de flujo
const ACTION_MAPPING = {
    'input': 'set',
    'click': 'click',
    'dblclick': 'click',
    'select': 'set',
    'check': 'set',
    'uncheck': 'set'
};

/**
 * Procesa los datos brutos de un archivo de registro SAP
 * @param {Object} rawData - Datos JSON del archivo de registro
 * @param {string} tcode - Código de transacción (nombre del archivo)
 * @returns {Object} - Datos procesados y estructurados
 */
function parseRawData(rawData, tcode) {
    console.log(`  Analizando registro de ${tcode}...`);
    
    // Extraer información básica
    const transactionData = {
        tcode: tcode,
        steps: [],
        controls: new Map(),
        pathPatterns: new Set(),
        controlTypes: new Set()
    };
    
    // Extraer el Tcode del objeto si está disponible
    if (rawData.Tcode) {
        transactionData.tcode = rawData.Tcode.toLowerCase();
    }
    
    // Procesar cada paso del registro
    const steps = rawData.Steps || [];
    
    // Extraer todos los ControlTypes de los pasos
    steps.forEach(step => {
        if (step.ControlType) {
            transactionData.controlTypes.add(step.ControlType);
        }
    });
    
    // Agrupar pasos por control y acción para facilitar la identificación de flujos
    const groupedSteps = groupStepsByControl(steps);
    
    // Convertir pasos agrupados a pasos de flujo
    transactionData.steps = convertToFlowSteps(groupedSteps, transactionData);
    
    // Analizar patrones de ruta para identificar prefijos comunes
    identifyPathPatterns(transactionData);
    
    return transactionData;
}

/**
 * Agrupa pasos por control para identificar secuencias lógicas
 * @param {Array} steps - Pasos del registro SAP
 * @returns {Array} - Pasos agrupados
 */
function groupStepsByControl(steps) {
    const groupedSteps = [];
    let currentGroup = null;
    
    steps.forEach(step => {
        // Ignorar pasos que no tienen acción o control
        if (!step.Action || !step.ControlId) return;
        
        // Normalizar la acción
        const action = step.Action.toLowerCase();
        
        // Si es un paso de input o set, iniciamos un nuevo grupo
        if (action === 'input' || action === 'set') {
            if (currentGroup && currentGroup.action === 'input' && currentGroup.controlId === step.ControlId) {
                // Actualizar el valor si es el mismo control
                currentGroup.value = step.Value;
            } else {
                // Finalizar grupo anterior si existe
                if (currentGroup) {
                    groupedSteps.push(currentGroup);
                }
                
                // Iniciar nuevo grupo
                currentGroup = {
                    action: action,
                    controlId: step.ControlId,
                    controlName: step.ControlName,
                    controlType: step.ControlType,
                    value: step.Value,
                    originalStep: step
                };
            }
        } 
        // Si es un click y tenemos un grupo de input, lo agregamos como confirmación
        else if (action === 'click' || action === 'dblclick') {
            // Finalizar grupo anterior si existe
            if (currentGroup) {
                groupedSteps.push(currentGroup);
            }
            
            // Crear grupo para el click
            currentGroup = {
                action: action,
                controlId: step.ControlId,
                controlName: step.ControlName,
                controlType: step.ControlType,
                originalStep: step
            };
        }
    });
    
    // Agregar el último grupo si existe
    if (currentGroup) {
        groupedSteps.push(currentGroup);
    }
    
    return groupedSteps;
}

/**
 * Convierte pasos agrupados a pasos de flujo estructurados
 * @param {Array} groupedSteps - Pasos agrupados por control
 * @param {Object} transactionData - Datos de la transacción
 * @returns {Array} - Pasos de flujo estructurados
 */
function convertToFlowSteps(groupedSteps, transactionData) {
    const flowSteps = [];
    let stepIndex = 0;
    
    // Primero, agregamos el paso para iniciar la transacción
    flowSteps.push({
        id: 'startTransaction',
        action: 'callProgram',
        method: 'sapSession.StartTransaction',
        paramKey: 'Tcode',
        next: groupedSteps.length > 0 ? `step${stepIndex + 1}` : 'end'
    });
    
    // Convertir cada paso agrupado
    groupedSteps.forEach((group, index) => {
        stepIndex = index + 1;
        const nextStepId = index < groupedSteps.length - 1 ? `step${stepIndex + 1}` : 'end';
        
        // Mapear la acción SAP a acción de flujo
        let action = ACTION_MAPPING[group.action] || 'click';
        
        // Registrar el control para generar alias posteriormente
        registerControl(transactionData, group.controlId, group.controlName, group.controlType);
        
        // Crear paso de flujo
        const flowStep = {
            id: `step${stepIndex}`,
            action: action,
            target: group.controlId, // Será reemplazado por alias más adelante
            next: nextStepId,
            controlType: group.controlType // Incluir el tipo de control en los datos del paso
        };
        
        // Agregar paramKey para pasos 'set'
        if (action === 'set' && group.value) {
            // Generar un paramKey basado en el nombre del control
            flowStep.paramKey = generateParamKey(group.controlName || extractControlName(group.controlId));
            
            // Si el valor es booleano (checkbox)
            if (group.controlType === 'GuiCheckBox') {
                flowStep.paramValue = group.value === 'true' || group.value === true;
            } else {
                flowStep.paramValue = group.value;
            }
        }
        
        // Agregar campos adicionales según el tipo de control
        if (group.controlType === 'GuiCheckBox' && action === 'set') {
            flowStep.isCheckbox = true;
        }
        
        flowSteps.push(flowStep);
    });
    
    // Agregar paso final
    flowSteps.push({
        id: 'end',
        action: 'exit'
    });
    
    return flowSteps;
}

/**
 * Registra un control en el mapa de controles
 * @param {Object} transactionData - Datos de la transacción
 * @param {string} controlId - ID del control SAP
 * @param {string} controlName - Nombre del control
 * @param {string} controlType - Tipo del control
 */
function registerControl(transactionData, controlId, controlName, controlType) {
    if (!transactionData.controls.has(controlId)) {
        transactionData.controls.set(controlId, {
            name: controlName || extractControlName(controlId),
            type: controlType,
            frequency: 1
        });
    } else {
        // Incrementar frecuencia si ya existe
        const control = transactionData.controls.get(controlId);
        control.frequency += 1;
    }
}

/**
 * Extrae el nombre del control a partir de su ID
 * @param {string} controlId - ID del control SAP
 * @returns {string} - Nombre extraído
 */
function extractControlName(controlId) {
    // Intentar extraer el nombre del control de la ruta
    const parts = controlId.split('/');
    const lastPart = parts[parts.length - 1];
    
    // Extraer el nombre después de "txt" o "ctxt"
    if (lastPart.includes('txt')) {
        return lastPart.split('txt')[1];
    }
    
    return lastPart;
}

/**
 * Genera un nombre de parámetro a partir del nombre del control
 * @param {string} controlName - Nombre del control
 * @returns {string} - Nombre del parámetro
 */
function generateParamKey(controlName) {
    // Limpiar nombre del control
    let paramKey = controlName
        .replace(/^ctxt/i, '')  // Quitar prefijo ctxt
        .replace(/^txt/i, '')   // Quitar prefijo txt
        .replace(/[\[\]]/g, '') // Quitar corchetes
        .replace(/\W+/g, '_');  // Reemplazar no-palabra con guión bajo
    
    // Convertir a PascalCase
    paramKey = paramKey
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
    
    // Manejar casos especiales
    if (paramKey.includes('LOW')) {
        const baseName = paramKey.replace('-LOW', '').replace('LOW', '');
        return `${baseName}Low`;
    } else if (paramKey.includes('HIGH')) {
        const baseName = paramKey.replace('-HIGH', '').replace('HIGH', '');
        return `${baseName}High`;
    }
    
    return paramKey;
}

/**
 * Identifica patrones en las rutas de los controles
 * @param {Object} transactionData - Datos de la transacción
 */
function identifyPathPatterns(transactionData) {
    // Extraer todos los paths de los controles
    const paths = Array.from(transactionData.controls.keys());
    
    // Encontrar prefijos comunes
    paths.forEach(path => {
        // Extraer posibles prefijos (hasta /usr/, /tbar/, etc.)
        const usrMatch = path.match(/^(\/app\/con\[\d+\]\/ses\[\d+\]\/wnd\[\d+\]\/usr\/)/);
        if (usrMatch) {
            transactionData.pathPatterns.add(usrMatch[1]);
        }
        
        const popupMatch = path.match(/^(\/app\/con\[\d+\]\/ses\[\d+\]\/wnd\[1\]\/usr\/)/);
        if (popupMatch) {
            transactionData.pathPatterns.add(popupMatch[1]);
        }
        
        const tbarMatch = path.match(/^(\/app\/con\[\d+\]\/ses\[\d+\]\/wnd\[\d+\]\/tbar\[\d+\]\/)/);
        if (tbarMatch) {
            transactionData.pathPatterns.add(tbarMatch[1]);
        }
    });
}

module.exports = {
    parseRawData
}; 