// Runner portavel da suite versionada em tests/g5-token-sessao.
// Cada teste roda em processo isolado com o preload que redireciona os
// paths absolutos Windows legados para o checkout atual do repositorio.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const preload = path.join(dir, 'portable-fs-preload.js');
const self = path.basename(__filename);

const tests = fs.readdirSync(dir)
  .filter(name => /^test-.*\.js$/i.test(name))
  .filter(name => name !== self)
  .sort();

let filesPass = 0;
let filesFail = 0;

for (const name of tests) {
  process.stdout.write(`\n===== ${name} =====\n`);
  const result = spawnSync(process.execPath, ['-r', preload, path.join(dir, name)], {
    cwd: path.resolve(dir, '..', '..'),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status === 0) filesPass++;
  else {
    filesFail++;
    process.stdout.write(`FAIL FILE: ${name} (exit=${result.status})\n`);
  }
}

process.stdout.write(`\n===== G5 PORTABLE SUMMARY =====\n`);
process.stdout.write(`Arquivos PASS: ${filesPass}\nArquivos FAIL: ${filesFail}\nTotal: ${tests.length}\n`);

if (filesFail > 0) process.exitCode = 1;
