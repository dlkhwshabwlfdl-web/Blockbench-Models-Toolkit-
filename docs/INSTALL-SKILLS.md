# Installing the skills on the agent

The toolkit is only half of the workflow. The other half is the **skills**: small packages that
tell an agent when to reach for this toolkit and how to use it. Without them an agent can still use
the library, but it has to rediscover the conventions, the quality rules and the argument shapes
every session.

## TL;DR

```bash
cd "F:\resourcepack\Trex\tools ai model generator"
node scripts/install-skills.mjs
```

That is it for this repository. The skills land in:

```
F:\resourcepack\Trex\.agents\skills\
  minecraft-model-builder\   SKILL.md  reference.md
  minecraft-rig-and-bones\   SKILL.md  reference.md
  minecraft-texture-atlas\   SKILL.md  reference.md
  minecraft-uv-mapping\      SKILL.md  reference.md
  minecraft-animation\       SKILL.md  reference.md
  minecraft-surface-finishing\ SKILL.md reference.md
  minecraft-model-preview\   SKILL.md  reference.md
  minecraft-model-export\    SKILL.md  reference.md
```

Start a **new agent session** in this repository and it picks them up. A session that was already
open before the install may not see them.

## How discovery works

An agent finds skills by scanning for `<directory>/<skill-name>/SKILL.md`, where the file starts
with a YAML frontmatter block:

```markdown
---
name: minecraft-texture-atlas
description: Paint textures for a Minecraft model — build a PNG atlas, define material islands, …
---

# Textures and the atlas
…
```

The frontmatter is machine-read; the body is prose the agent loads only when it decides the skill
applies. That is why **the `description` matters more than anything else in the file**: it is the
only part the agent sees when choosing. Each description here names the concrete triggers
("material islands", "colour scheme", "looks noisy", "walk cycle", "export to Oraxen") rather than
describing the module, so selection works from a user's plain-language request.

`reference.md` sits beside each `SKILL.md`. It is not loaded up front — it is there for the agent to
read on demand when it needs the exact signature of something. This is deliberate: it keeps the
always-loaded part small and the available depth large.

### Where the agent looks

Highest priority first:

| Location | Scope |
|----------|-------|
| `{cwd}/.agents/skills/` | project — **this is where the installer puts them by default** |
| `{cwd}/.claude/skills/` | project, Claude Code compatible |
| `~/.agents/skills/` | global |
| `~/.claude/skills/` | global, Claude Code compatible |

`{cwd}` is the project directory the agent session was opened in — here, `F:\resourcepack\Trex`. So
the install target is `F:\resourcepack\Trex\.agents\skills`, one level above this package.

A project skill overrides a global skill of the same name.

## Installer options

```bash
node scripts/install-skills.mjs                  # project (default) → <repo>/.agents/skills
node scripts/install-skills.mjs --global         # every project      → ~/.agents/skills
node scripts/install-skills.mjs --target DIR     # an explicit directory
node scripts/install-skills.mjs --dry-run        # validate and list, write nothing
node scripts/install-skills.mjs --force          # accepted for scripting symmetry
```

The installer:

1. reads every folder in `skills/`;
2. parses the frontmatter of its `SKILL.md`;
3. **fails loudly** if the frontmatter has no `name`, no `description`, a `description` shorter
   than 40 characters, or a `name` that does not match the folder name — a skill that fails these
   checks is invisible or mis-selected, and a silent failure is much worse than a loud one;
4. copies `SKILL.md` plus any sibling files (`reference.md`) into the target;
5. prints where each skill landed and reminds you how discovery works.

Re-running is safe: it overwrites the skill folders it owns and touches nothing else.

## Choosing project vs global

**Project** (the default here) means:

- the skills travel with this repository — clone it and they are there;
- they only affect agent sessions opened on this repository;
- a different project's session sees nothing, which is usually what you want while the toolkit is
  still evolving alongside this model.

**Global** (`--global`) means any project can build models with this toolkit, at the cost of the
skills pointing at an absolute tool path that only exists on this machine. Use it once the toolkit
has settled and you want it everywhere:

```bash
node scripts/install-skills.mjs --global
```

You can install both. The project copy wins inside this repository.

## Verifying

```bash
# 1. the skills are where the agent looks
ls "F:\resourcepack\Trex\.agents\skills"

# 2. every SKILL.md has valid frontmatter
node scripts/install-skills.mjs --dry-run

# 3. the tool the skills call actually builds
cd "F:\resourcepack\Trex\tools ai model generator" && npm run build

# 4. the toolkit works end to end
node scripts/smoke.mjs
```

Then, in a fresh session, ask for something small and check the skill engages:

> make me a 16×16 wooden crate model with a metal band and a lid that opens

A working setup produces `out/crate/crate.bbmodel`, `crate.png` and `crate_preview.png` without any
back-and-forth about how the toolkit works.

## Troubleshooting

**The agent does not seem to know about the toolkit.**
The session was probably started before the install. Open a new session in the repository. If it
still does not engage, confirm discovery with `node scripts/install-skills.mjs --dry-run`, then
check that `dist/` exists (`npm run build` in the package) — the skills reference
`dist/index.js`, which only exists after a build.

**The skill is found but the agent still improvises.**
Either the request did not match a description, or `dist/` is missing. Ask in the user's own terms
("build a Minecraft model of …"), or name it directly: "use the minecraft-model-builder skill".

**The installer reports a frontmatter error.**
Fix the file in `skills/<name>/SKILL.md`: the frontmatter `name` must equal the folder name, and
the `description` must be a single-line sentence or two naming real triggers. Then re-run.

**A skill must be changed.**
Edit `skills/<name>/SKILL.md` (the source of truth) and re-run the installer. Never edit the copy
under `.agents/skills` directly — it will be overwritten and the change will be lost.

**Uninstall.**
Delete the folders under `.agents/skills`. They are self-contained; nothing else registers them.

## Why the skills are written the way they are

Each `SKILL.md` follows the same shape, because that is what makes an agent reliable:

1. **what the thing is**, in one or two sentences;
2. **the API surface**, as short copy-pasteable snippets rather than prose;
3. **the rules that are easy to get wrong**, stated as rules — pivot placement, parents before
   children, one root bone, first-match-wins UV rules, loops that must close;
4. **a quality bar**, so the agent can tell whether it succeeded: `A` or better from `metrics()`,
   `validate().ok === true`, a contact sheet it has actually looked at;
5. **a worked example** that can be adapted instead of composed from scratch.

The toolkit's own error messages carry half the weight — `Atlas.define` refuses overlaps,
`Model.cube` refuses an unknown bone, `Rig.add` refuses a missing parent, `validate()` reports UV
outside the texture. An agent that writes plausible-but-wrong code gets told exactly what is wrong
rather than producing a file that opens blank in Blockbench.
