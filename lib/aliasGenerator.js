/**
 * Módulo Generador de Alias
 * 
 * Analiza los controles SAP y genera prefijos y alias descriptivos
 * para su uso en los flujos de automatización.
 */

/**
 * Genera prefijos y alias para los flujos de transacciones
 * @param {Object} parsedFlows - Flujos analizados por el parser
 * @returns {Object} - Prefijos y alias generados
 */
function generateAliases(parsedFlows) {
    console.log('  Analizando controles y generando alias...');
    
    // Resultado a devolver
    const result = {
        prefixes: {},
        aliases: {
            main: {} // Alias globales
        }
    };
    
    // 1. Identificar prefijos comunes en todos los flujos
    identifyCommonPrefixes(parsedFlows, result.prefixes);
    
    // 2. Generar alias para cada flujo
    Object.keys(parsedFlows).forEach(tcode => {
        const flow = parsedFlows[tcode];
        
        // Crear namespace para este tcode si no existe
        if (!result.aliases[tcode]) {
            result.aliases[tcode] = {};
        }
        
        // Generar alias para los controles de este flujo
        generateFlowAliases(flow, result.aliases[tcode], result.prefixes);
    });
    
    // 3. Identificar alias comunes y moverlos a 'main'
    consolidateCommonAliases(result.aliases);
    
    return result;
}

/**
 * Identifica prefijos comunes en todos los flujos
 * @param {Object} parsedFlows - Flujos analizados
 * @param {Object} prefixes - Objeto donde se guardarán los prefijos
 */
function identifyCommonPrefixes(parsedFlows, prefixes) {
    const allPatterns = new Set();
    
    // Recopilar todos los patrones de ruta
    Object.values(parsedFlows).forEach(flow => {
        flow.pathPatterns.forEach(pattern => allPatterns.add(pattern));
    });
    
    // Definir prefijos estándar
    if (allPatterns.size > 0) {
        const usrPattern = Array.from(allPatterns).find(p => p.includes('/usr/'));
        if (usrPattern) {
            prefixes.usr = usrPattern;
        }
        
        const popupPattern = Array.from(allPatterns).find(p => p.includes('/wnd[1]/usr/'));
        if (popupPattern) {
            prefixes.popup = popupPattern;
        }
    }
    
    // Si no se encontraron patrones, usar valores predeterminados
    if (!prefixes.usr) {
        prefixes.usr = '/app/con[0]/ses[0]/wnd[0]/usr/';
    }
    
    if (!prefixes.popup) {
        prefixes.popup = '/app/con[0]/ses[0]/wnd[1]/usr/';
    }
}

/**
 * Genera alias para los controles de un flujo
 * @param {Object} flow - Flujo analizado
 * @param {Object} aliases - Objeto donde se guardarán los alias
 * @param {Object} prefixes - Prefijos identificados
 */
function generateFlowAliases(flow, aliases, prefixes) {
    // Procesar cada control registrado
    flow.controls.forEach((controlInfo, controlId) => {
        // Generar nombre de alias basado en el nombre y tipo del control
        const aliasName = generateAliasName(controlInfo, controlId);
        
        // Aplicar prefijos si es posible
        const processedPath = applyPrefixes(controlId, prefixes);
        
        // Almacenar el alias
        aliases[aliasName] = processedPath;
    });
    
    // Actualizar los pasos con los alias generados
    updateStepsWithAliases(flow, aliases);
}

/**
 * Genera un nombre de alias descriptivo para un control
 * @param {Object} controlInfo - Información del control
 * @param {string} controlId - ID del control
 * @returns {string} - Nombre de alias generado
 */
function generateAliasName(controlInfo, controlId) {
    const name = controlInfo.name || '';
    const type = controlInfo.type || '';
    const idParts = controlId.split('/');
    const lastPart = idParts[idParts.length - 1];
    
    // Determinar el tipo de componente
    if (controlId.includes('btn')) {
        // Si es un botón
        if (lastPart.includes('btn[8]')) {
            return 'variant.execBtn'; // Botón de ejecutar
        } else if (lastPart.includes('btn[0]')) {
            return 'popup.accept'; // Botón de aceptar
        } else {
            return `button.${lastPart.replace(/\W+/g, '')}`;
        }
    } else if (controlId.includes('txt') || controlId.includes('ctxt')) {
        // Si es un campo de texto
        
        // Extraer nombre del campo
        let fieldName = lastPart
            .replace(/^ctxt/i, '')
            .replace(/^txt/i, '')
            .replace(/[\[\]]/g, '');
        
        // Determinar si es campo de filtro
        if (fieldName.includes('-LOW')) {
            return `filter.${fieldName.replace('-LOW', 'Low').toLowerCase()}`;
        } else if (fieldName.includes('-HIGH')) {
            return `filter.${fieldName.replace('-HIGH', 'High').toLowerCase()}`;
        } else {
            return `filter.${fieldName.toLowerCase()}`;
        }
    } else if (type === 'GuiCheckBox' || controlId.includes('chk')) {
        // Si es un checkbox
        let fieldName = lastPart.replace(/^chk/i, '');
        return `filter.${fieldName.toLowerCase()}`;
    } else if (controlId.includes('shell')) {
        // Si es una tabla o grid
        return 'gridResult';
    } else {
        // Para otros tipos de controles
        return `control.${lastPart.replace(/\W+/g, '')}`;
    }
}

/**
 * Aplica prefijos a una ruta de control
 * @param {string} controlPath - Ruta completa del control
 * @param {Object} prefixes - Prefijos disponibles
 * @returns {string} - Ruta con prefijos aplicados
 */
function applyPrefixes(controlPath, prefixes) {
    // Verificar si la ruta coincide con algún prefijo
    for (const [key, prefix] of Object.entries(prefixes)) {
        if (controlPath.startsWith(prefix)) {
            return `{{${key}}}${controlPath.substring(prefix.length)}`;
        }
    }
    
    // Si no coincide con ningún prefijo, devolver la ruta original
    return controlPath;
}

/**
 * Actualiza los pasos del flujo con los alias generados
 * @param {Object} flow - Flujo analizado
 * @param {Object} aliases - Alias generados
 */
function updateStepsWithAliases(flow, aliases) {
    // Crear un mapa inverso de ruta -> alias
    const pathToAlias = new Map();
    Object.entries(aliases).forEach(([alias, path]) => {
        // Resolver la ruta completa si contiene prefijos
        const fullPath = path.replace(/\{\{(\w+)\}\}/g, (match, prefixName) => {
            // Aquí asumiríamos que tenemos acceso a los prefijos, pero por simplicidad no los usamos
            return '';
        });
        
        pathToAlias.set(fullPath, alias);
    });
    
    // Actualizar cada paso del flujo
    flow.steps.forEach(step => {
        if (step.target) {
            // Buscar un alias para la ruta del target
            const foundAlias = Array.from(pathToAlias.entries())
                .find(([path, alias]) => step.target.includes(path));
            
            if (foundAlias) {
                step.aliasTarget = foundAlias[1]; // Guardar el alias encontrado
            }
        }
    });
}

/**
 * Identifica alias comunes y los mueve al namespace 'main'
 * @param {Object} aliases - Todos los alias generados
 */
function consolidateCommonAliases(aliases) {
    const allTcodes = Object.keys(aliases).filter(name => name !== 'main');
    
    // No procesar si hay menos de 2 transacciones
    if (allTcodes.length < 2) return;
    
    // Mapeo de alias a tcodes donde aparecen
    const aliasUsage = new Map();
    
    // Registrar uso de cada alias
    allTcodes.forEach(tcode => {
        Object.entries(aliases[tcode]).forEach(([alias, path]) => {
            if (!aliasUsage.has(alias)) {
                aliasUsage.set(alias, { path, tcodes: new Set() });
            }
            
            aliasUsage.get(alias).tcodes.add(tcode);
        });
    });
    
    // Mover alias comunes a 'main' (los que aparecen en al menos 2 tcodes)
    aliasUsage.forEach((usage, alias) => {
        if (usage.tcodes.size >= 2) {
            // Agregar al namespace principal
            aliases.main[alias] = usage.path;
            
            // Eliminar de los namespaces específicos
            usage.tcodes.forEach(tcode => {
                delete aliases[tcode][alias];
            });
        }
    });
}

module.exports = {
    generateAliases
}; 