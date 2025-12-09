/**
 * Módulo de validación y extracción de parámetros de JSON de formularios
 */

class JsonValidator {
    /**
     * Valida la estructura de un JSON de formulario
     * @param {object} jsonData - Datos JSON a validar
     * @returns {object} - Resultado de la validación
     */
    static validateJson(jsonData) {
        try {
            // Validar que existe $meta.tcode
            if (!jsonData.$meta || !jsonData.$meta.tcode) {
                return {
                    isValid: false,
                    message: 'El JSON debe contener $meta.tcode'
                };
            }

            // Validar que existe steps
            if (!jsonData.steps || typeof jsonData.steps !== 'object') {
                return {
                    isValid: false,
                    message: 'El JSON debe contener una propiedad steps válida'
                };
            }

            // Extraer parámetros
            const parameters = this.extractParameters(jsonData);

            if (parameters.length === 0) {
                return {
                    isValid: false,
                    message: 'No se encontraron parámetros con action "set" en los steps'
                };
            }

            return {
                isValid: true,
                message: `JSON válido. Se encontraron ${parameters.length} parámetros.`,
                tcode: jsonData.$meta.tcode,
                description: jsonData.$meta.description || null,
                parameters: parameters
            };
        } catch (error) {
            return {
                isValid: false,
                message: `Error al validar JSON: ${error.message}`
            };
        }
    }

    /**
     * Extrae los parámetros de un JSON de formulario
     * @param {object} data - Datos JSON
     * @returns {string[]} - Array de nombres de parámetros
     */
    static extractParameters(data) {
        const params = new Set();

        if (!data.steps) {
            return [];
        }

        Object.keys(data.steps).forEach(stepKey => {
            const step = data.steps[stepKey];

            if (typeof step === 'object' && step !== null) {
                Object.keys(step).forEach(actionKey => {
                    const action = step[actionKey];
                    if (action && action.action === 'set' && action.target) {
                        params.add(action.target);
                    }
                });
            }
        });

        return Array.from(params);
    }
}

module.exports = JsonValidator;

