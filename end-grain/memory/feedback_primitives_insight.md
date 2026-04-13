---
name: Patterns are compositions of primitives
description: End-grain cutting board patterns are NOT separate things — they are compositions of a small set of atomic operations (flip, shift, insert). The tool should model primitives, not patterns.
type: feedback
---

Patterns are compositions of primitives, not separate code paths.

**Why:** The user identified this as THE key insight for the end-grain tool. Every board follows the same skeleton: strips → glue-up → flatten → crosscut → rotate → transform → glue-up → trim → finish. The only thing that varies is which transform primitives are composed (flip alternate, shift alternate, insert strips) and the crosscut angle. Named patterns (checkerboard, brick, chevron) are just presets — saved compositions.

**How to apply:** The internal state model and rendering pipeline should be operation-based, not pattern-based. Each stage is an operation applied to the workpiece. Adding a "new pattern" means composing existing primitives in a new order, not writing a new renderer. When building features, always ask: "is this a new primitive, or a composition of existing ones?"
