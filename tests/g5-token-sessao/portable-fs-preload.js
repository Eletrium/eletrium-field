// Preload para tornar a suite G5 portavel sem reescrever os 29 testes
// historicos. Intercepta somente os dois caminhos absolutos legados que
// apontam para os arquivos reais deste repo; qualquer outro readFileSync
// continua com o comportamento normal do Node.
const fs = require('fs');
const path = require('path');

const originalReadFileSync = fs.readFileSync.bind(fs);
const repoRoot = path.resolve(__dirname, '..', '..');

function normalizar(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
  const n = normalizar(filePath);

  if (n.endsWith('/eletriumerp/pwa/código.js') || n.endsWith('/eletriumerp/pwa/codigo.js')) {
    return originalReadFileSync(path.join(repoRoot, 'Código.js'), ...args);
  }

  if (n.endsWith('/eletriumerp/pwa/api.js')) {
    return originalReadFileSync(path.join(repoRoot, 'API.js'), ...args);
  }

  return originalReadFileSync(filePath, ...args);
};
