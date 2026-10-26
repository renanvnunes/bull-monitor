// Gera THIRD_PARTY_NOTICES.md com as licenças de tudo que vai dentro do app:
// pacotes npm de produção do sidecar, crates Rust do casco Tauri e o runtime do Bun.
// Uso (na raiz do projeto): bun scripts/third-party-notices.ts
// Para outra plataforma: TARGET=x86_64-pc-windows-msvc bun scripts/third-party-notices.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SIDECAR = join(ROOT, 'sidecar');

interface Entry {
  name: string;
  version: string;
  license: string;
  url?: string;
  /** Textos de licença encontrados no pacote; vazio quando ele não traz nenhum arquivo. */
  texts: string[];
}

// Os pacotes @bull-board publicados no npm não incluem o arquivo LICENSE; o texto vem do repositório.
const BULL_BOARD_LICENSE = `MIT License

Copyright (c) 2019 Vitor Capretz (capretzvitor@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-_.].*)?$/i;

function licenseTexts(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => readFileSync(join(dir, file), 'utf8').trim())
    .filter(Boolean);
}

// ---------- npm: dependências de produção do sidecar ----------

/** Resolve como o Node: node_modules do próprio pacote e depois os dos diretórios acima. */
function resolvePackage(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; dir.startsWith(SIDECAR); dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === SIDECAR) break;
  }
}

/** Normaliza as formas que o package.json aceita ("dono/repo", git://, git+https://) para um link. */
function repositoryUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  if (url.startsWith('github:')) return `https://github.com/${url.slice('github:'.length)}`;
  return url;
}

function npmEntries(): Entry[] {
  const root = JSON.parse(readFileSync(join(SIDECAR, 'package.json'), 'utf8'));
  const found = new Map<string, Entry>();
  const queue: [string, string][] = Object.keys(root.dependencies ?? {}).map((n) => [n, SIDECAR]);

  while (queue.length > 0) {
    const [name, from] = queue.shift()!;
    const dir = resolvePackage(name, from);
    if (!dir || found.has(dir)) continue;

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const repo = repositoryUrl(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url);
    let texts = licenseTexts(dir);
    if (texts.length === 0 && name.startsWith('@bull-board/')) texts = [BULL_BOARD_LICENSE];

    found.set(dir, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'desconhecida'),
      url: repo,
      texts,
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dep, dir]);
  }
  return [...found.values()];
}

// ---------- Rust: crates do casco Tauri ----------

/** Plataforma do build: as crates mudam entre Linux, Windows e macOS. */
function targetTriple(): string {
  // O Tauri define TAURI_ENV_TARGET_TRIPLE no beforeBuildCommand, inclusive com --target.
  const target = process.env.TARGET || process.env.TAURI_ENV_TARGET_TRIPLE;
  if (target) return target;
  const rustc = Bun.spawnSync(['rustc', '-vV']).stdout.toString();
  const host = rustc.match(/^host: (.+)$/m)?.[1];
  if (!host) throw new Error('Não foi possível descobrir a plataforma; defina TARGET.');
  return host;
}

function rustEntries(): Entry[] {
  const result = Bun.spawnSync([
    'cargo', 'metadata', '--format-version', '1',
    '--filter-platform', targetTriple(),
    '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml'),
  ]);
  if (!result.success) throw new Error(`cargo metadata falhou:\n${result.stderr.toString()}`);
  const meta = JSON.parse(result.stdout.toString());

  const packages = new Map<string, any>(meta.packages.map((p: any) => [p.id, p]));
  const nodes = new Map<string, any>(meta.resolve.nodes.map((n: any) => [n.id, n]));
  const rootId = meta.resolve.root;

  // Só dependências normais (as que entram no binário), sem as de build e de teste.
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k: any) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  seen.delete(rootId);

  return [...seen].map((id) => {
    const p = packages.get(id);
    return {
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? 'ver arquivo' : 'desconhecida'),
      url: p.repository ?? undefined,
      texts: licenseTexts(dirname(p.manifest_path)),
    };
  });
}

// ---------- saída ----------

function section(title: string, intro: string, entries: Entry[]): string {
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const table = entries
    .map((e) => `| ${e.url ? `[${e.name}](${e.url})` : e.name} | ${e.version} | ${e.license} |`)
    .join('\n');

  // Agrupa pacotes que trazem exatamente o mesmo texto, para não repetir centenas de cópias.
  const byText = new Map<string, string[]>();
  const withoutFile: Entry[] = [];
  for (const e of entries) {
    if (e.texts.length === 0) withoutFile.push(e);
    for (const text of e.texts) byText.set(text, [...(byText.get(text) ?? []), `${e.name} ${e.version}`]);
  }

  const texts = [...byText.entries()]
    .map(([text, users]) => `#### ${users.join(', ')}\n\n\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\``)
    .join('\n\n');

  const missing =
    withoutFile.length === 0
      ? ''
      : `\n\nOs pacotes a seguir não incluem arquivo de licença; vale a licença declarada na tabela ` +
        `acima, com o texto padrão publicado em https://spdx.org/licenses/:\n\n` +
        withoutFile.map((e) => `- ${e.name} ${e.version} (${e.license})`).join('\n');

  return `## ${title}\n\n${intro}\n\n| Pacote | Versão | Licença |\n|---|---|---|\n${table}\n\n### Textos das licenças\n\n${texts}${missing}\n`;
}

const output = `# Avisos de terceiros

O Bull Monitor é distribuído sob a licença MIT (veja \`LICENSE\`) e inclui software de terceiros,
listado abaixo com as respectivas licenças.

O Bull Monitor **não é afiliado** ao projeto [bull-board](https://github.com/felixmosh/bull-board)
nem aos seus autores; ele usa as bibliotecas publicadas do bull-board, sob a licença MIT.

Este arquivo é gerado por \`scripts/third-party-notices.ts\`; não edite à mão.

## Runtime do Bun

O sidecar é compilado com \`bun build --compile\`, que embute o runtime do
[Bun](https://github.com/oven-sh/bun) no executável. O Bun é distribuído sob a licença MIT e inclui
componentes com outras licenças, entre eles o JavaScriptCore do WebKit, sob LGPL-2.0. Os detalhes e
o código-fonte desses componentes estão em https://bun.com/docs/project/licensing e
https://github.com/oven-sh/WebKit.

${section(
  'Pacotes npm (sidecar)',
  'Dependências de produção do sidecar, embutidas no executável. Inclui a API e a interface do bull-board.',
  npmEntries()
)}
${section(
  'Crates Rust (casco Tauri)',
  `Dependências compiladas no executável do app, para a plataforma \`${targetTriple()}\`.`,
  rustEntries()
)}`;

writeFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), output);
console.log(`THIRD_PARTY_NOTICES.md gerado (${(output.length / 1024).toFixed(0)} KB)`);
