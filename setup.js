import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('=== Backend Setup ===\n');

// Prüfe ob node_modules existiert
const nodeModulesPath = path.join(process.cwd(), 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('❌ node_modules fehlt - installiere Dependencies...');
  execSync('npm install', { stdio: 'inherit' });
} else {
  console.log('✅ node_modules existiert');
}

// Prüfe ob form-data installiert ist
const formDataPath = path.join(nodeModulesPath, 'form-data');
if (!fs.existsSync(formDataPath)) {
  console.log('❌ form-data fehlt - installiere form-data...');
  execSync('npm install form-data@4.0.0', { stdio: 'inherit' });
} else {
  console.log('✅ form-data ist installiert');
}

// Teste Import
console.log('\n=== Teste form-data Import ===');
try {
  const formDataModule = await import('form-data');
  const FormData = formDataModule.default || formDataModule.FormData || formDataModule;
  if (FormData) {
    console.log('✅ form-data kann importiert werden');
    const test = new FormData();
    console.log('✅ FormData kann instanziiert werden');
  } else {
    console.log('❌ FormData nicht gefunden in Modul');
  }
} catch (error) {
  console.log('❌ Import fehlgeschlagen:', error.message);
  process.exit(1);
}

console.log('\n✅ Setup erfolgreich! Server kann gestartet werden.');








