---
name: invalid
description: |
  This is valid
  But the next line:
  allowed-tools: [Unclosed, Bracket
version: 0.1.0
---

# Invalid YAML

Frontmatter opens with `---`, closes with `---`, but the YAML inside has unclosed brackets.

`frontmatter.ts` should throw `YAMLParseError` with line number pointing to the unclosed `[`.
