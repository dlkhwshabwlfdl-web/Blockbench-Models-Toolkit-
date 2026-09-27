#!/usr/bin/env node
/**
 * Install the toolkit's skills so an agent can discover them.
 *
 * Agents discover skills by scanning for `<dir>/<skill-name>/SKILL.md`, where the file starts
 * with YAML frontmatter carrying `name` and `description`. The agent this repository is used
 * with (Freebuff / Codebuff) scans, in priority order:
 *
 *   {project}/.agents/skills/    (project, highest priority)
 *   {project}/.claude/skills/    (project, Claude Code compatible)
 *   ~/.agents/skills/            (global)
 *   ~/.claude/skills/            (global, Claude Code compatible)
 *
 * By default this installs to the **project** directory (`<repo>/.agents/skills`), which is what
 * this project asked for. Pass `--global` to install to `~/.agents/skills` instead so any
 * project can use the skills.
 *
 *   node scripts/install-skills.mjs                 # → <repo>/.agents/skills
 *   node scripts/install-skills.mjs --global        # → ~/.agents/skills
 *   node scripts/install-skills.mjs --target DIR    # → DIR
 *   node scripts/install-skills.mjs --dry-run
 *   node scripts/install-skills.mjs --force         # overwrite without the diff summary
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(HERE, '..');
const SKILLS_SOURCE = path.join(PACKAGE_ROOT, 'skills');
// The package sits directly inside the repository, so one level up is the project root.
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');

function parseArgs(argv) {
  const options = { dryRun: false, force: false, global: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') options.dryRun = true;
    else if (token === '--force') options.force = true;
    else if (token === '--global') options.global = true;
    else if (token === '--target') options.target = argv[(i += 1)];
  }
  return options;
}

/** Read `name` and `description` out of a SKILL.md frontmatter block. */
function parseFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---')) return { error: 'no YAML frontmatter block' };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { error: 'frontmatter block is not closed' };
  const block = text.slice(3, end);
  const read = (key) => {
    const match = block.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const name = read('name');
  const description = read('description');
  if (!name) return { error: 'frontmatter has no "name"' };
  if (!description) return { error: 'frontmatter has no "description"' };
  if (description.length < 40) return { error: '"description" is too short to select the skill reliably' };
  return { name, description };
}

function copyDirectory(from, to, dryRun) {
  const files = [];
  const walk = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) walk(sourcePath, targetPath);
      else {
        files.push(targetPath);
        if (!dryRun) fs.copyFileSync(sourcePath, targetPath);
      }
    }
  };
  walk(from, to);
  return files;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(SKILLS_SOURCE)) {
    console.error(`no skills directory at ${SKILLS_SOURCE} — run this from the package`);
    process.exitCode = 1;
    return;
  }

  const target = options.target
    ? path.resolve(options.target)
    : options.global
      ? path.join(os.homedir(), '.agents', 'skills')
      : path.join(REPO_ROOT, '.agents', 'skills');

  const skills = fs
    .readdirSync(SKILLS_SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (skills.length === 0) {
    console.error(`no skill folders inside ${SKILLS_SOURCE}`);
    process.exitCode = 1;
    return;
  }

  console.log(`installing ${skills.length} skill(s) → ${target}`);
  if (options.dryRun) console.log('(dry run — nothing will be written)');

  let failures = 0;
  const installed = [];

  for (const name of skills) {
    const source = path.join(SKILLS_SOURCE, name);
    const manifest = path.join(source, 'SKILL.md');
    if (!fs.existsSync(manifest)) {
      console.error(`  ✖ ${name}: no SKILL.md`);
      failures += 1;
      continue;
    }
    const parsed = parseFrontmatter(manifest);
    if (parsed.error) {
      console.error(`  ✖ ${name}: ${parsed.error}`);
      failures += 1;
      continue;
    }
    if (parsed.name !== name) {
      console.error(`  ✖ ${name}: frontmatter name "${parsed.name}" does not match the folder name`);
      failures += 1;
      continue;
    }

    const destination = path.join(target, name);
    const existed = fs.existsSync(destination);
    const files = copyDirectory(source, destination, options.dryRun);
    const extras = files.filter((file) => path.basename(file) !== 'SKILL.md').length;
    installed.push({ name, destination, extras, fileCount: files.length });
    const note = `${existed ? 'updated' : 'created'}${extras ? ` (+${extras} reference file${extras > 1 ? 's' : ''})` : ''}`;
    console.log(`  ✓ ${name} — ${note}`);
  }

  console.log('');
  for (const entry of installed) {
    console.log(`  ${entry.name.padEnd(28)} ${path.relative(process.cwd(), entry.destination) || entry.destination}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} skill(s) failed validation`);
    process.exitCode = 1;
    return;
  }

  console.log(`
Done. Discovery works as follows:
  • project skills   {cwd}/.agents/skills/<name>/SKILL.md   — highest priority
  • global skills    ~/.agents/skills/<name>/SKILL.md
The agent reads the "description" of each SKILL.md to decide when a skill applies, then loads
the body; reference.md files are read on demand.

Verify with:
  node scripts/install-skills.mjs --dry-run
  ls "${target}"
`);
}

main();
