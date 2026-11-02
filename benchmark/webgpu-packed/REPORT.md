# Packed triangle position benchmark results

Measured November 2, 2026 on Apple M3 (10 GPU cores), hardware Metal 3 WebGPU, macOS 27.0.1, Chrome 149.0.7827.22 and Three.js 0.185.0. Source commit: `cd5382befe40b45858e1d373a7df6dd672ca76cd`.

Packing improved median closest-hit throughput by about 1–3% in the medium and large scenes, and median any-hit throughput by about 1–2%. The small scene ranged from a 2% any-hit regression to an 8% closest-hit gain, with visible trial variation. These results support an optional representation rather than a change to the default. Packing adds 48 bytes per unique triangle and remains shared across instances.

## Sustained completed throughput

The benchmark completed **48 five-second trials**, totaling **240.151 seconds** of timed GPU work, within the five-minute budget. Each trial counts completed batches of 16 frames, each containing 16,384 ray queries and the same eleven output words. Warmup, compilation, upload, and validation readback are outside throughput timing. Vsync and frame limits are disabled. Variants run sequentially, with order reversed on the second repeat and the queue drained before switching. Timings include batch fence overhead.

Both representations use identical split-axis traversal, SAH with target leaf size four, geometry, bounds, deterministic ray buffers and triangle intersection arithmetic. Distance ordering and deferred-node pruning are not included. Ratios below divide matched median packed throughput by indexed throughput. Closest-hit and any-hit are separate query types.

| Scene | Rays | Query | Indexed median Mrays/s | Packed median Mrays/s | Packed / indexed | Indexed range | Packed range |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| small | camera | closest-hit | 203.095 | 207.819 | 1.0233× | 203.049–203.141 | 204.311–211.328 |
| small | camera | any-hit | 203.406 | 199.306 | 0.9798× | 193.513–213.299 | 186.647–211.965 |
| small | long-shadow | closest-hit | 195.892 | 211.708 | 1.0807× | 183.692–208.092 | 209.992–213.425 |
| small | long-shadow | any-hit | 211.533 | 211.702 | 1.0008× | 210.573–212.494 | 210.826–212.578 |
| medium | camera | closest-hit | 30.935 | 31.523 | 1.0190× | 30.822–31.048 | 31.442–31.604 |
| medium | camera | any-hit | 37.335 | 38.200 | 1.0232× | 37.319–37.351 | 38.182–38.217 |
| medium | long-shadow | closest-hit | 33.359 | 34.025 | 1.0200× | 33.327–33.390 | 34.019–34.032 |
| medium | long-shadow | any-hit | 38.970 | 39.499 | 1.0136× | 38.899–39.041 | 39.079–39.920 |
| large | camera | closest-hit | 20.062 | 20.716 | 1.0326× | 20.056–20.067 | 20.572–20.861 |
| large | camera | any-hit | 24.970 | 25.440 | 1.0188× | 24.757–25.182 | 25.158–25.721 |
| large | long-shadow | closest-hit | 22.276 | 22.504 | 1.0102× | 22.189–22.364 | 22.176–22.831 |
| large | long-shadow | any-hit | 27.038 | 27.412 | 1.0138× | 26.862–27.213 | 27.012–27.812 |

There are two trials for every table entry. The raw [benchmark-results.json](./benchmark-results.json) records each trial's completed frames, elapsed seconds, FPS, Mrays/s, batch size and actual ray count. It also records adapter/OS/browser/source metadata. The synthetic scene generators and complete protocol are described in [README.md](./README.md).

## Memory and preparation

| Scene | Unique triangles | Added packed bytes | Indexed preparation ms | Packed preparation ms |
| --- | ---: | ---: | ---: | ---: |
| small | 108 | 5184 | 0.10 | 0.00 |
| medium | 8192 | 393216 | 5.80 | 5.20 |
| large | 32768 | 1572864 | 159.60 | 155.50 |

Preparation timings are single total `BVHComputeData.update()` observations, including clustered-tree construction, index/attribute packing, and optional triangle packing. They exclude initial geometry/BLAS construction and upload. The second representation is prepared after the first, so JIT/cache effects mean these observations do not isolate marginal packing cost. Small values may round to zero. No negative packing cost is inferred from the faster second preparation.

The shared 8,192-triangle refit fixture measured 1.20 ms for BVH refit, followed by 6.10 ms indexed repacking and 5.60 ms packed repacking. Transform-only updates measured 1.60 ms indexed and 1.10 ms packed; they do not rebuild triangle positions. These are single observations, not sustained throughput trials. First-dispatch times are retained per validation case and combine compilation, initial upload and execution; upload and compilation were not measured in isolation.

## Correctness

All **140 GPU validation cases** passed with zero CPU existence/distance discrepancies and zero packed-versus-indexed output-word differences. CPU MeshBVH references cover 1,024 rays per case. Across all 16,384 rays per case, all eleven output words match bit-for-bit, including integer object/triangle IDs, barycentrics, normal and face side. Exact ordering and tie behavior are preserved by packing.

Fixtures cover empty and nonindexed geometry, degenerate/coincident triangles, finite endpoints, box boundaries/inside origins, signed zero and nearly parallel rays, shared geometry and instances, negative/nonuniform scales, visibility and instance updates, and geometry refits/repacking. CPU unit tests verify default allocation behavior, deduplication across shared meshes/instances, custom attribute order and indirect BVHs, buffer replacement/disposal, nonindexed geometry, and empty geometry.

The full CPU suite passes 30,249 tests with four existing TODOs. Lint and TypeScript checks pass with existing warnings. A local merge of the packing and distance-ordering branches applies without conflicts; both 140-case GPU fixtures pass on the combined tree.

This experiment covers one GPU architecture and deterministic synthetic compute scenes. Larger/real assets, different vertex sharing and cache behavior, other GPU architectures, and full radiosity rendering could produce different results. The packed representation remains off by default.
