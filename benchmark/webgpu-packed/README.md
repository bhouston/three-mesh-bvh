# Packed triangle positions experiment

This experiment branches from the any-hit/robust-slab PR. It includes no distance ordering or deferred-node pruning. Both packed and indexed queries use the same split-axis traversal, construction, ray buffers, output writes and intersection arithmetic.

```js
const data = new BVHComputeData( objects, { packedTriangles: true } );
data.update();
// Existing interfaces: data.fns.raycastFirstHit and data.fns.raycastAnyHit.
```

The option is fixed at construction and defaults to false. Each unique prepared geometry adds three vec4 records (48 bytes) per triangle in BVH triangle order. Shared meshes and instances reuse these records. Original integer indices and attributes remain available for results and interpolation. Ray intersection fetches positions directly; closest-hit only fetches original indices when accepting a hit. Any-hit requires no index fetch. Non-ray shapecast continues using existing attributes.

`update()` and `updateAsync()` rebuild packed data from prepared positions, including skinning and vertex-range handling. After modifying geometry, refit its BVH and call `update()` to synchronize both regular attributes and packed positions. `updateTransforms()` changes matrices/visibility without rebuilding geometry. Replaced packed buffers and final buffers use the existing disposal lifecycle. Packed data appears in `storage.trianglePositions` only when enabled; empty geometry reserves two vec4 records to avoid TSL scalar conversion.

From the repository root:

```sh
npm ci
npm run build-silent
npx vitest run test/WebGPU.packedTriangles.test.js
BVH_GPU_RESULTS=benchmark/webgpu-packed/validation-results.json node benchmark/webgpu-packed/run.js --validate-only
BVH_GPU_RESULTS=benchmark/webgpu-packed/benchmark-results.json node benchmark/webgpu-packed/run.js
```

The runner requires hardware WebGPU and rejects software/fallback adapters. It uses the generators and output kernel from the base PR's `benchmark/webgpu/suite.js`. All 35 scene/ray configurations are tested for closest-hit and any-hit with both representations: 140 GPU validation cases. CPU references check existence/distance for 1,024 rays per case. Across all 16,384 rays per case, packed and indexed outputs must match all eleven written words bit-for-bit: hit/miss, distance, integer object/triangle IDs, barycentrics, side, and normal. Fixtures cover empty/degenerate/coincident geometry, finite endpoints, boundaries, signed zero, near-parallel directions, shared/instanced geometry, negative/nonuniform scales, visibility and instance updates, and geometry refits/repacking.

The performance matrix contains three synthetic scenes, camera and finite shadow rays, closest-hit and any-hit, two representations, and two reverse-order repeats. Each trial runs for at least five seconds: 48 trials, approximately 240 seconds total. One frame dispatches 16,384 rays and writes the same eleven words. Trials run sequentially; each variant warms up with 32 submissions and drains the queue. Timed batches contain 16 frames followed by `queue.onSubmittedWorkDone()`. Counted frames are GPU-completed; no individual-frame timers, display callbacks, or correctness readbacks occur in the timed interval. Chromium launches with vsync and frame limits disabled. Compilation and initial upload are outside throughput timing.

Raw records include every completed frame count, seconds, FPS, Mrays/s, batch size, rays/frame, adapter, OS, browser, source and Three.js versions. Scene records include preparation times, added buffer bytes, transform-update time, BVH refit time, and repacking time. First-dispatch times combine compilation/upload/execution. Preparation timing includes clustered-tree construction and packing but excludes initial geometry/BLAS construction. This is a comparison on one GPU architecture with synthetic compute workloads, not full radiosity rendering. See `REPORT.md` for the results.
