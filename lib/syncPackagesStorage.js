/**
 * Módulo de almacenamiento para Paquetes de Sincronización
 * Gestiona el almacenamiento persistente de paquetes y formularios
 */

const fs = require('fs');
const path = require('path');

// Función para generar IDs únicos
function generateId(prefix = 'id') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}_${timestamp}_${random}`;
}

class SyncPackagesStorage {
    constructor(dataDir = './data') {
        this.dataDir = dataDir;
        this.packagesFile = path.join(dataDir, 'sync-packages.json');
        this.formsDataFile = path.join(dataDir, 'sync-forms-data.json');
        
        // Asegurar que el directorio existe
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Inicializar archivos si no existen
        this.initializeFiles();
    }

    initializeFiles() {
        // Inicializar archivo de paquetes
        if (!fs.existsSync(this.packagesFile)) {
            const defaultPackages = this.createDefaultPackages();
            this.savePackages(defaultPackages);
        }

        // Inicializar archivo de datos de formularios
        if (!fs.existsSync(this.formsDataFile)) {
            this.saveFormsData({});
        }
    }

    createDefaultPackages() {
        const defaultPackageNames = [
            'UPDATE OPEX SUMMARY',
            'UPDATE OPEX DETAILS',
            'UPDATE CAPEX SUMMARY',
            'UPDATE CAPEX DETAILS'
        ];

        return defaultPackageNames.map(name => ({
            id: generateId('pkg'),
            name: name,
            createdDate: new Date().toISOString(),
            updatedDate: new Date().toISOString(),
            createdBy: 'system',
            forms: []
        }));
    }

    loadPackages() {
        try {
            if (!fs.existsSync(this.packagesFile)) {
                return [];
            }
            const data = fs.readFileSync(this.packagesFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error al cargar paquetes:', error);
            return [];
        }
    }

    savePackages(packages) {
        try {
            fs.writeFileSync(this.packagesFile, JSON.stringify(packages, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error('Error al guardar paquetes:', error);
            return false;
        }
    }

    loadFormsData() {
        try {
            if (!fs.existsSync(this.formsDataFile)) {
                return {};
            }
            const data = fs.readFileSync(this.formsDataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error al cargar datos de formularios:', error);
            return {};
        }
    }

    saveFormsData(formsData) {
        try {
            fs.writeFileSync(this.formsDataFile, JSON.stringify(formsData, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error('Error al guardar datos de formularios:', error);
            return false;
        }
    }

    // Métodos para paquetes
    getAllPackages() {
        return this.loadPackages();
    }

    getPackageById(packageId) {
        const packages = this.loadPackages();
        return packages.find(pkg => pkg.id === packageId);
    }

    createPackage(name, createdBy = 'system') {
        const packages = this.loadPackages();
        
        // Validar que no exista un paquete con el mismo nombre
        const existingPackage = packages.find(pkg => pkg.name === name);
        if (existingPackage) {
            throw new Error('Ya existe un paquete con ese nombre');
        }

        const newPackage = {
            id: generateId('pkg'),
            name: name,
            createdDate: new Date().toISOString(),
            updatedDate: new Date().toISOString(),
            createdBy: createdBy,
            forms: []
        };

        packages.push(newPackage);
        this.savePackages(packages);
        return newPackage;
    }

    updatePackage(packageId, updates) {
        const packages = this.loadPackages();
        const packageIndex = packages.findIndex(pkg => pkg.id === packageId);
        
        if (packageIndex === -1) {
            throw new Error('Paquete no encontrado');
        }

        // Validar nombre único si se está actualizando
        if (updates.name && updates.name !== packages[packageIndex].name) {
            const existingPackage = packages.find(pkg => pkg.name === updates.name && pkg.id !== packageId);
            if (existingPackage) {
                throw new Error('Ya existe un paquete con ese nombre');
            }
        }

        packages[packageIndex] = {
            ...packages[packageIndex],
            ...updates,
            updatedDate: new Date().toISOString()
        };

        this.savePackages(packages);
        return packages[packageIndex];
    }

    deletePackage(packageId) {
        const packages = this.loadPackages();
        const packageIndex = packages.findIndex(pkg => pkg.id === packageId);
        
        if (packageIndex === -1) {
            throw new Error('Paquete no encontrado');
        }

        const packageToDelete = packages[packageIndex];
        
        // Eliminar datos de formularios del paquete
        const formsData = this.loadFormsData();
        packageToDelete.forms.forEach(form => {
            delete formsData[form.id];
        });
        this.saveFormsData(formsData);

        // Eliminar el paquete
        packages.splice(packageIndex, 1);
        this.savePackages(packages);
        
        return true;
    }

    // Métodos para formularios
    getFormsByPackageId(packageId) {
        const pkg = this.getPackageById(packageId);
        if (!pkg) {
            throw new Error('Paquete no encontrado');
        }
        return pkg.forms || [];
    }

    getFormById(packageId, formId) {
        const pkg = this.getPackageById(packageId);
        if (!pkg) {
            throw new Error('Paquete no encontrado');
        }
        return pkg.forms.find(form => form.id === formId);
    }

    createForm(packageId, formData) {
        const packages = this.loadPackages();
        const packageIndex = packages.findIndex(pkg => pkg.id === packageId);
        
        if (packageIndex === -1) {
            throw new Error('Paquete no encontrado');
        }

        // Asegurar que Columns y NoSum estén en los parámetros
        const parametersSet = new Set(formData.parameters || []);
        if (!parametersSet.has('Columns')) {
            parametersSet.add('Columns');
        }
        if (!parametersSet.has('NoSum')) {
            parametersSet.add('NoSum');
        }

        const newForm = {
            id: generateId('form'),
            packageId: packageId,
            tcode: formData.tcode,
            customName: formData.customName,
            jsonData: formData.jsonData,
            parameters: Array.from(parametersSet),
            createdDate: new Date().toISOString(),
            updatedDate: new Date().toISOString()
        };

        packages[packageIndex].forms.push(newForm);
        packages[packageIndex].updatedDate = new Date().toISOString();
        this.savePackages(packages);

        return newForm;
    }

    updateForm(packageId, formId, updates) {
        const packages = this.loadPackages();
        const packageIndex = packages.findIndex(pkg => pkg.id === packageId);
        
        if (packageIndex === -1) {
            throw new Error('Paquete no encontrado');
        }

        const formIndex = packages[packageIndex].forms.findIndex(form => form.id === formId);
        if (formIndex === -1) {
            throw new Error('Formulario no encontrado');
        }

        // Si se actualizan los parámetros, asegurar Columns y NoSum
        if (updates.parameters) {
            const parametersSet = new Set(updates.parameters);
            if (!parametersSet.has('Columns')) {
                parametersSet.add('Columns');
            }
            if (!parametersSet.has('NoSum')) {
                parametersSet.add('NoSum');
            }
            updates.parameters = Array.from(parametersSet);
        }

        packages[packageIndex].forms[formIndex] = {
            ...packages[packageIndex].forms[formIndex],
            ...updates,
            updatedDate: new Date().toISOString()
        };
        packages[packageIndex].updatedDate = new Date().toISOString();
        this.savePackages(packages);

        return packages[packageIndex].forms[formIndex];
    }

    deleteForm(packageId, formId) {
        const packages = this.loadPackages();
        const packageIndex = packages.findIndex(pkg => pkg.id === packageId);
        
        if (packageIndex === -1) {
            throw new Error('Paquete no encontrado');
        }

        const formIndex = packages[packageIndex].forms.findIndex(form => form.id === formId);
        if (formIndex === -1) {
            throw new Error('Formulario no encontrado');
        }

        // Eliminar datos del formulario
        const formsData = this.loadFormsData();
        delete formsData[formId];
        this.saveFormsData(formsData);

        // Eliminar el formulario
        packages[packageIndex].forms.splice(formIndex, 1);
        packages[packageIndex].updatedDate = new Date().toISOString();
        this.savePackages(packages);

        return true;
    }

    // Métodos para datos de formularios
    saveFormData(formId, formData) {
        const formsData = this.loadFormsData();
        formsData[formId] = {
            ...formData,
            lastUpdated: new Date().toISOString()
        };
        this.saveFormsData(formsData);
        return formsData[formId];
    }

    getFormData(formId) {
        const formsData = this.loadFormsData();
        return formsData[formId] || null;
    }

    deleteFormData(formId) {
        const formsData = this.loadFormsData();
        delete formsData[formId];
        this.saveFormsData(formsData);
        return true;
    }
}

module.exports = SyncPackagesStorage;

