# A Skill With No Frontmatter

This file has no YAML frontmatter block at the top. It is intentionally malformed.

`frontmatter.ts` should throw `InvalidFrontmatterError` with message: "No YAML frontmatter found in SKILL.md".

`validate.sh` should reject this file with exit code 1.
