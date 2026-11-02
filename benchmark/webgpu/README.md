# WebGPU ray query validation

From the repository root:

```sh
npm ci
npm run build-silent
node benchmark/webgpu/run.js --validate-only
node benchmark/webgpu/run.js
```

The runner requires visible hardware WebGPU and rejects software/fallback adapters. It compares the exact upstream query at `26fc97c5f007b8bd905ec31df9deac5d9d668782`, closest-hit with robust parallel slabs, and dedicated any-hit. Both library queries use split-axis ordering. Distance ordering and packed positions are separate experiments.

Each workload uses 16,384 deterministic rays. CPU MeshBVH queries validate existence/distance for 1,024 rays; GPU comparisons and returned-triangle reconstruction cover all 16,384. Fixtures include empty and degenerate geometry, ties, finite endpoints, boundary/inside origins, signed zero, nearly parallel directions, shared geometry, instancing, negative/nonuniform scales, visibility/transform changes and refits/repacking. A combined shader also tests ray queries and non-ray closest-point traversal together. The original query's eight boundary misses in four box distributions are asserted as known upstream discrepancies.

The normal benchmark measures camera and long finite shadow workloads in a subdivided box, 12 overlapping knots plus three instances, and 100 knots plus three instances. Geometry and ray generators are in `suite.js`; exported helpers also support the separate packing experiment. SAH and target leaf size four are fixed. Any-hit has occlusion semantics; closest-hit finds the nearest triangle.

Every variant compiles and warms up with 32 submissions, then drains the queue. Each trial lasts at least five seconds, counting GPU-completed batches of 16 frames. One frame runs all 16,384 queries and writes the same eleven result words. `queue.onSubmittedWorkDone()` fences each batch; no frame timers, display callbacks, or validation readbacks occur in the timed interval. Vsync and frame-rate limits are disabled. Variants run sequentially. A default run has 12 trials (about one minute of timed work).

Raw JSON includes per-trial completed frames, seconds, FPS, Mrays/s, batch size, ray count, adapter, OS, browser, Three.js/source versions, buffer sizes, packing time and first-dispatch time. First-dispatch time combines upload, shader compilation and execution. Live reload is disabled. Set `BVH_GPU_RESULTS` to the result filename and `BVH_GPU_SCENES=medium,large` to select measured scenes. Maximum-depth/adversarial floating-point coverage, other GPU architectures, and full radiosity rendering are outside these fixtures.
