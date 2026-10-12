import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';

// Execute the production modules with the installed SDK, without a test framework.
const cache = new Map();
export function loadTypeScript(filename) {
  filename = resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { fileName:filename,compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX,esModuleInterop: true } });
  const module = new Module(filename);
  const require = createRequire(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(dirname(filename));
  module.require = specifier => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(filename), specifier);
      const target = extname(candidate) ? candidate : existsSync(`${candidate}.ts`)?`${candidate}.ts`:`${candidate}.tsx`;
      if (existsSync(target) && /\.tsx?$/.test(target)) return loadTypeScript(target);
    }
    return require(specifier);
  };
  cache.set(filename, module);
  module._compile(outputText, filename);
  return module.exports;
}
