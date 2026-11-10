// Configuração separada para releases assinadas com Developer ID.
const base = require('../package.json').build;
const mac = { ...base.mac, hardenedRuntime: true, notarize: true };
delete mac.identity;

module.exports = { ...base, mac, forceCodeSigning: true };
