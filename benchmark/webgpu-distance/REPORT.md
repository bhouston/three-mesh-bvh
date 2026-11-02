# WebGPU ray traversal results

Measured November 2, 2026 on an Apple M3 (10 GPU cores), Metal 3 WebGPU adapter, macOS 27.0.1 (26A434), Chrome 149.0.7827.22, and Three.js 0.185.0. Software/fallback adapters were rejected. The exact upstream baseline is `26fc97c5f007b8bd905ec31df9deac5d9d668782`.

The benchmark used 33 completed trials totaling 165.125 seconds of timed GPU work, within the requested five-minute budget. Each trial ran sequentially for at least five seconds with 16,384 rays per completed frame and a queue completion fence after every 16 frames. Vsync and frame limits were disabled. All shaders were warmed up and the queue drained before measurement. Timed output writes were retained; validation readbacks were outside the timed intervals.

## Throughput

Mrays/s values below are the median and range of the indicated trial count. A single trial has an identical minimum and maximum. Speedup is the ratio to the matched median of upstream traversal with the same robust slab arithmetic (`robust-baseline`). All timed variants in this report find the closest hit. Any-hit is evaluated in the base PR.

| Scene | Rays | Implementation | Trials | Median Mrays/s | Range Mrays/s | Relative throughput |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| small | camera | robust-baseline | 4 | 174.32 | 160.11–190.86 | 1.000× |
| small | camera | ordering | 4 | 172.74 | 134.33–182.26 | 0.991× |
| small | camera | pruning | 4 | 130.32 | 119.74–133.71 | 0.748× |
| small | long-shadow | robust-baseline | 1 | 99.65 | 99.65–99.65 | 1.000× |
| small | long-shadow | ordering | 1 | 132.26 | 132.26–132.26 | 1.327× |
| small | long-shadow | pruning | 1 | 149.78 | 149.78–149.78 | 1.503× |
| medium | camera | robust-baseline | 2 | 30.23 | 29.98–30.48 | 1.000× |
| medium | camera | ordering | 2 | 29.53 | 29.42–29.64 | 0.977× |
| medium | camera | pruning | 2 | 27.20 | 26.93–27.48 | 0.900× |
| medium | long-shadow | robust-baseline | 2 | 32.61 | 32.60–32.63 | 1.000× |
| medium | long-shadow | ordering | 2 | 32.04 | 31.78–32.30 | 0.982× |
| medium | long-shadow | pruning | 2 | 29.45 | 29.33–29.58 | 0.903× |
| large | camera | robust-baseline | 1 | 19.41 | 19.41–19.41 | 1.000× |
| large | camera | ordering | 1 | 20.15 | 20.15–20.15 | 1.038× |
| large | camera | pruning | 1 | 18.64 | 18.64–18.64 | 0.960× |
| large | long-shadow | robust-baseline | 1 | 21.94 | 21.94–21.94 | 1.000× |
| large | long-shadow | ordering | 1 | 21.14 | 21.14–21.14 | 0.963× |
| large | long-shadow | pruning | 1 | 19.18 | 19.18–19.18 | 0.874× |

Distance ordering plus pruning is workload dependent: it improves the small finite-shadow workload and reduces throughput in the measured medium and large closest-hit workloads. The library therefore retains split-axis ordering for `raycastFirstHit` and exposes the distance-ordered implementation as `raycastFirstHitDistanceOrdered`. Any-hit belongs to the base PR and is not part of this ordering comparison.

The raw [benchmark-results.json](./benchmark-results.json) includes completed frames, seconds, FPS, Mrays/s, batch size, rays/frame, and source commit for every trial. Completed trials from the shortened initial run and a run interrupted by a build-triggered page reload are retained; unfinished trials are excluded. The final run disabled live reload. The tested traversal algorithms were identical across these runs. The range of the small camera measurements also shows run-to-run variation where submission and synchronization overhead are significant.

## Correctness

The final [validation-results.json](./validation-results.json) contains the complete five-distribution correctness matrix. Each candidate has zero CPU hit/distance mismatches, zero differences from the robust GPU control, and zero reconstructed-result field mismatches. The original upstream query records eight misses on axis-parallel box-boundary rays in each of four distributions. The robust slab fix resolves those misses. A combined shader also executes default closest-hit, distance-ordered closest-hit, any-hit, and a non-ray closest-point query together. The distance-ordering PR adds no change to the base any-hit traversal.

CPU checks cover 1,024 rays per workload; GPU comparisons and reconstruction cover all 16,384 rays. See [README.md](./README.md) for the exact fixtures and tie policy. The standard CPU suite passed 30,245 tests with four existing TODOs. Lint and TypeScript checks passed with existing lint warnings.

## Memory and preparation

The extra distance stack is 60 f32 entries: 240 logical bytes per invocation in addition to the existing 240-byte node-index stack. Register allocation, spilling, and occupancy were not profiled. No additional geometry buffers are used; packed triangle positions are deferred to a separate change. Buffers are shared across all variants.

| Scene | Unique triangles | Node bytes | Index bytes | Position bytes | Transform bytes | Packing ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 108 | 4928 | 1296 | 1536 | 864 | 0.20 |
| medium | 8192 | 937280 | 98304 | 68112 | 2160 | 7.30 |
| large | 32768 | 12344192 | 393216 | 270864 | 14832 | 218.40 |

Packing times include BVHComputeData packing and clustered-tree construction, but exclude initial geometry/BLAS construction and GPU upload. Raw first-dispatch times combine compilation, initial upload, and dispatch completion; they are not isolated shader compilation measurements. Refit/update costs were correctness-tested but not separately timed.

These results cover one GPU architecture, synthetic compute workloads, and SAH with target leaf size four. They do not measure a full radiosity application, packed positions, a leaf-size matrix, or maximum-depth/adversarial floating-point coverage. The default closest-hit scheduling policy remains unchanged.
