# WebGPU ray traversal benchmark

Run from the repository root with a visible hardware GPU session:

```sh
npm ci
npm run build-silent
node benchmark/webgpu/run.js --validate-only
node benchmark/webgpu/run.js
```

The runner uses `git-dedup` to load the two original traversal functions from upstream commit `26fc97c5f007b8bd905ec31df9deac5d9d668782`. That commit must be available locally. Dependencies are the repository's installed Three.js, Vite, and Puppeteer. The output is `results.json` (override with `BVH_GPU_RESULTS`).

The normal run measures camera and long finite shadow rays in three deterministic scenes, once per implementation. Each trial lasts at least five seconds. This is 24 trials, approximately two minutes of timed GPU work. The validation-only run checks five ray distributions in all seven scene configurations. A normal run also validates the four special configurations and all measured workloads. Neither mode changes construction settings between implementations.

## Implementations

- `baseline`: exact upstream split-axis traversal and original slab arithmetic, used for correctness comparison.
- `robust-baseline`: upstream split-axis traversal with the zero-direction slab fix. This is the performance control, so the slab fix is held constant across timed implementations.
- `ordering`: child entry-distance ordering and an f32 distance stack, without deferred-node pruning.
- `pruning`: ordering plus deferred-node pruning, available as `fns.raycastFirstHitDistanceOrdered`. The existing `fns.raycastFirstHit` keeps split-axis ordering.
- `any-hit`: `fns.raycastAnyHit`, terminating the leaf loop and entire traversal at the first blocker. Compare its boolean result with closest-hit-as-occlusion; it has different query semantics.

All timed variants write the same eleven output words per ray, including integer triangle and object IDs for closest-hit queries. Any-hit writes its boolean and zero values to the remaining fields. No correctness readback is included in the timed interval.

## Scenes and correctness

The generators are in `suite.js`. The small scene is a 108-triangle subdivided box. The medium scene has 12 overlapping transformed torus knots and three instances, sharing one 8,192-triangle geometry. The large scene has 100 transformed knots and three instances, sharing one 32,768-triangle geometry (3,375,104 placed triangles). These are synthetic workloads, not asset-based architectural or radiosity scenes. Construction uses SAH with a target leaf size of four; the dedicated edge fixture uses one.

Each workload has 16,384 deterministic normalized rays. Closest-hit and any-hit existence are compared with independent CPU MeshBVH queries for the first 1,024 rays. Closest-hit results are compared over all rays with the robust control. Every returned closest-hit triangle, integer object slot, barycentric coordinate, normal, and side is checked by reconstructing the packed triangle in the object's coordinate system and comparing its world point with the ray. Equal-distance results retain the first encountered triangle; changing order may change the chosen identity on ties.

Special fixtures cover empty geometry, degenerate and coincident triangles, exact positive maximum-distance exclusion, adjacent finite limits, boundary and interior origins, signed zero, axis-parallel and nearly parallel directions, shared geometry, instancing, negative and nonuniform scaling, hidden objects, transform/visibility/instance updates, and geometry refits followed by repacking. A non-ray closest-point query also executes through generic shapecast. Upstream's eight boundary-ray misses in the box fixture are recorded as known baseline discrepancies; candidate variants must pass the CPU checks. GPU validation errors fail the run.

This does not exhaust maximum-depth or adversarial floating-point cases. Alpha/material acceptance, packed triangles, a construction matrix, other GPU architectures, and the full radiosity rendering workload are outside this benchmark.

## Throughput protocol

Chromium launches with `--disable-frame-rate-limit --disable-gpu-vsync`. The explicitly selected adapter supplies the renderer's device, and software/fallback adapters are rejected. No display loop, animation frame, or artificial delay schedules timed work. One frame dispatches the complete fixed 16,384-query compute workload to a storage buffer.

Each variant is compiled and dispatched before measurement. Warmup submits 32 workloads and fences the queue. Timed batches contain 16 complete workloads, followed by `GPUQueue.onSubmittedWorkDone()`. Only GPU-completed batches count. Variants run sequentially, with the queue drained before switching. The fixed batch synchronization overhead is included. No individual frame timing or per-frame fence is used.

Raw records include completed frames, elapsed seconds, rays/frame, FPS, Mrays/s, and batch size. Scene records include packing time and buffer sizes. First-dispatch times include compilation, initial upload, and execution and must not be described as isolated shader compilation times. Geometry construction is outside the packing timer. The report also records the browser, OS, GPU, Three.js version, and source commit.

Set `BVH_GPU_SCENES=medium,large` to limit measured scenes. Live reload and file watching are disabled so repository edits and builds cannot interrupt the run.

Only one GPU architecture was available. The timings describe these exact workloads and output costs; CPU submission overhead can limit throughput on the smallest scene. See `REPORT.md` and the raw JSON for the measured results.
