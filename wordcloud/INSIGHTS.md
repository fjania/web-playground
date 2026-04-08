# Word Cloud — Insights & Feature Ideas

Observations from deeply studying the codebase while planning the interactive essay.

## Insights About the Current Implementation

### The bit-packing is the real hero
The collision detection isn't just "fast" — it's fundamentally a different class of algorithm. Most word cloud libraries (including the popular d3-cloud) use bounding-box collision or hierarchical spatial hashing. Our approach packs actual pixel outlines into 32-bit words and tests with bitwise AND. This means:
- **Pixel-perfect collision** at **1/32 the cost** of pixel-by-pixel testing
- The padding stroke around each word isn't just visual — it *is* the collision margin, baked into the bitmap
- Words can tessellate into each other's negative space (the "g" of one word can nestle into the gap above the "t" of another)

This is worth celebrating in the essay. Most people assume word clouds use bounding boxes.

### The wandering layouts are the most visually distinctive feature
Every word cloud tool has a spiral layout. Very few have the wandering family (line, curl, wisp, feather, ring). The insight that you can distribute *origins* along a curve and then search locally from each origin produces shapes that no spiral-only tool can match. The debug path overlay (Show path checkbox) already visualizes this beautifully — the essay should lean heavily on it.

### The scaling choice matters more than most people realize
With power-law distributed data (which most natural language data is), linear scaling makes the largest word consume 80% of the canvas while everything else is tiny. Sqrt and log scaling exist because of this, but the *choice* between them depends on the dataset's distribution shape. The sparkline in the description bar is actually a decision-support tool — a steep sparkline means you probably want log scaling. This connection isn't obvious to users.

### The tetris animation is a mini game engine
The clock model (gravity metronome + player input between ticks) is literally how game engines work. The animation code is essentially a simplified Tetris game loop without user input — the "player" is an AI that already knows where to put each piece. This is a fun narrative thread for the essay.

---

## Feature Ideas

### High value, moderate effort

**1. Shape masks**
Let users upload or choose a shape (circle, heart, star, state outline, custom SVG) and constrain word placement to that shape. Implementation: render the shape as a bitmap, initialize the board with the shape's *inverse* (mark everything outside the shape as occupied). Words can only be placed inside the shape. The existing collision detection handles this for free — no algorithm changes needed, just board initialization.

**2. Custom text with live preview**
The "Your Text" mode currently requires typing, clicking generate, and waiting. Instead: debounced live processing as the user types. Show the word frequency table updating in real-time beside the textarea, then auto-generate the cloud after a pause.

**3. Export as PNG/SVG**
The canvas already has all the data. `canvas.toBlob()` for PNG is trivial. SVG export would re-render each word as a `<text>` element with the same transforms — more work but produces scalable output. This is the #1 feature users expect from a word cloud tool.

**4. Ghost/shadow placement preview**
Show a faded "ghost" of where each word will land before the reveal animation. This lets users see the final layout instantly while still enjoying the animation. Toggle: "Show final positions" checkbox.

### Medium value, lower effort

**5. Word click → definition/context**
When you click a word in a movie script cloud, show the line from the screenplay where it appears most. For other datasets, link to a definition or Wikipedia. The click handler already exists and emits the word — just need a display panel.

**6. Comparison mode**
Side-by-side clouds of two datasets with the same settings. Useful for comparing e.g. Pulp Fiction vs Princess Bride. Two canvases, synced controls.

**7. Animation speed control**
Global speed slider for all animations (reveal, tetris drop). Currently hardcoded timing constants. Expose as a user control.

**8. Permalink / share state**
Encode current settings (dataset, layout, colors, font, scaling, etc.) as URL query params. `?dataset=big_lebowski&layout=tetris&font=Bangers&colors=neon`. Users can share specific configurations.

### Exploratory / experimental

**9. Physics-based layout**
Instead of deterministic placement, simulate words as rigid bodies with gravity and collision. Words fall and settle naturally. Would require a simple physics engine (verlet integration). Very different from current approach — more like a simulation than an algorithm.

**10. Animated transitions between layouts**
When switching from spiral to rectangular, animate each word from its old position to its new one. Requires keeping both layout results and interpolating. Could look stunning.

**11. 3D word clouds**
Three.js or raw WebGL. Words placed on the surface of a sphere, rotating. The bit-packing collision approach wouldn't work in 3D, so this would need a completely different algorithm (probably spatial hashing).

**12. Musical word clouds**
Each word plays a tone when placed/revealed, with pitch proportional to word frequency and duration proportional to size. Creates a little melody as the cloud builds. Purely decorative but memorable.

**13. Dataset from live sources**
Pull word frequencies from:
- A Wikipedia article URL
- A subreddit's top posts
- An RSS feed
- A Spotify playlist's lyrics
Requires a lightweight proxy/API for CORS, or a paste-from-clipboard workflow.

---

## Essay-Specific Visualizations Worth Building

These are demos that would make the essay special and could also be extracted as standalone tools:

**Bitmap magnifier** — Hover over a word in the cloud and see its bit-packed collision mask at 10x zoom. Each pixel becomes a colored cell. Shows the actual data structure the algorithm operates on.

**Collision replay** — Record every position tested during placement of a single word. Replay as an animation: red dots for collisions, green for success. Shows how the spiral search works in practice, not just theory.

**Board heatmap** — After all words are placed, color-code the board by density. Which areas of the bitmap are packed tightest? Where is there wasted space? Reveals the layout algorithm's biases.

**Operation counter race** — Side-by-side: place the same 50 words with bounding-box collision vs bitmap collision. Show a running counter of operations and a timer. Bitmap finishes in 1/10 the time. Makes the performance difference visceral.
