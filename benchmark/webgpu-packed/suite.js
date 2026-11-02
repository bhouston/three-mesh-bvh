import { WebGPURenderer } from 'three/webgpu';
import { BVHComputeData } from '/src/webgpu/index.js';
import { Matrix4 } from 'three';
import { makeScene, makeRays, cpuHits, makeKernel } from '../webgpu/suite.js';

window.run = async ( benchmark = true ) => {

	const adapter = await navigator.gpu?.requestAdapter();
	if ( ! adapter ) throw new Error( 'Hardware WebGPU required.' );
	const info = adapter.info;
	const adapterInfo = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter };
	if ( adapterInfo.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test( JSON.stringify( adapterInfo ) ) ) throw new Error( 'Software adapters unsupported.' );
	console.log( 'Adapter: ' + JSON.stringify( adapterInfo ) );
	const device = await adapter.requestDevice();
	const renderer = new WebGPURenderer( { device } );
	await renderer.init();
	const queue = device.queue;
	const failures = [];
	device.addEventListener( 'uncapturederror', event => failures.push( { gpuError: event.error.message } ) );
	const validations = [];
	const trials = [];
	const scenes = [];
	for ( const size of [ 'edges', 'empty', 'updated', 'refit', 'small', 'medium', 'large' ] ) {

		const root = makeScene( size === 'updated' || size === 'refit' ? 'medium' : size );
		const data = [ false, true ].map( packedTriangles => {

			const result = new BVHComputeData( root, { packedTriangles } );
			const start = performance.now();
			result.update();
			const preparationMs = performance.now() - start;
			scenes.push( { size, packedTriangles, preparationMs, uniqueTriangles: size === 'empty' ? 0 : result.storage.index.proxyNode.value.array.length / 3, extraBytes: packedTriangles ? result.storage.trianglePositions.proxyNode.value.array.byteLength : 0 } );
			return result;

		} );
		if ( size === 'updated' ) {

			root.children[ 0 ].position.set( 3, 2, - 1 );
			root.children[ 1 ].visible = false;
			root.children[ 3 ].visible = true;
			root.children.at( - 1 ).setMatrixAt( 1, new Matrix4().makeScale( - 2, 0.5, 3 ) );
			root.updateMatrixWorld( true );
			for ( const item of data ) {

				const start = performance.now();
				item.updateTransforms();
				scenes.find( scene => scene.size === size && scene.packedTriangles === item.packedTriangles ).updateTransformsMs = performance.now() - start;

			}

		} else if ( size === 'refit' ) {

			const geometry = root.children[ 0 ].geometry;
			geometry.scale( 1.2, 0.7, 1.4 );
			const start = performance.now();
			geometry.boundsTree.refit();
			const refitMs = performance.now() - start;
			for ( const item of data ) {

				const start = performance.now();
				item.update();
				const scene = scenes.find( scene => scene.size === size && scene.packedTriangles === item.packedTriangles );
				scene.refitMs = refitMs;
				scene.repackMs = performance.now() - start;

			}

		}

		for ( const distribution of [ 'camera', 'diffuse', 'short-shadow', 'long-shadow', 'miss' ] ) {

			const rays = makeRays( distribution, 16384 );
			if ( size === 'edges' ) for ( let i = 0; i < 4; i ++ ) rays.set( [ 0, 0, 4, [ 0, 4, 3.999, 4.001 ][ i ], 0, - 0, - 1, 0 ], i * 8 );
			const reference = cpuHits( root, rays, 1024, data[ 0 ] );
			for ( const query of [ 'robust-baseline', 'any-hit' ] ) {

				const kernels = data.map( item => makeKernel( item, query, rays ) );
				const results = [];
				for ( let variant = 0; variant < 2; variant ++ ) {

					const { kernel, outputAttribute } = kernels[ variant ];
					const start = performance.now();
					await renderer.computeAsync( kernel );
					await queue.onSubmittedWorkDone();
					const firstDispatchMs = performance.now() - start;
					const buffer = await renderer.getArrayBufferAsync( outputAttribute );
					const u32 = new Uint32Array( buffer );
					const f32 = new Float32Array( buffer );
					results.push( { u32, f32 } );
					let cpuMismatches = 0;
					let packingMismatches = 0;
					for ( let i = 0; i < rays.length / 8; i ++ ) {

						const base = i * 16;
						const hit = u32[ base ] !== 0;
						if ( i < reference.length ) {

							const cpu = reference[ i ];
							if ( hit !== Boolean( cpu ) || ( hit && query !== 'any-hit' && ( ! Number.isFinite( f32[ base + 1 ] ) || Math.abs( f32[ base + 1 ] - cpu.distance ) > 2e-4 * Math.max( 1, cpu.distance ) ) ) ) cpuMismatches ++;

						}

						// Packing preserves triangle order and arithmetic. All eleven output words,
						// including integer IDs, barycentrics, normal and side, must match bitwise.
						if ( variant === 1 ) for ( let field = 0; field < 11; field ++ ) {

							if ( u32[ base + field ] !== results[ 0 ].u32[ base + field ] ) packingMismatches ++;

						}

					}

					const validation = { size, distribution, query, packed: Boolean( variant ), rays: rays.length / 8, cpuRays: reference.length, cpuMismatches, packingMismatches, firstDispatchMs };
					validations.push( validation );
					if ( cpuMismatches || packingMismatches ) failures.push( validation );
					console.log( JSON.stringify( validation ) );

				}

				// Two reverse-order repeats across all measured scenes and both query types:
				// 3 scenes * 2 distributions * 2 queries * 2 variants * 2 trials * 5 s = 240 s.
				if ( benchmark && [ 'small', 'medium', 'large' ].includes( size ) && [ 'camera', 'long-shadow' ].includes( distribution ) && failures.length === 0 ) {

					for ( let trial = 0; trial < 2; trial ++ ) for ( const variant of trial % 2 ? [ 1, 0 ] : [ 0, 1 ] ) {

						const { kernel } = kernels[ variant ];
						await queue.onSubmittedWorkDone();
						for ( let i = 0; i < 32; i ++ ) renderer.compute( kernel );
						await queue.onSubmittedWorkDone();
						const start = performance.now();
						let end = start;
						let completedFrames = 0;
						do {

							for ( let i = 0; i < 16; i ++ ) renderer.compute( kernel );
							await queue.onSubmittedWorkDone();
							completedFrames += 16;
							end = performance.now();

						} while ( end - start < 5000 );

						const seconds = ( end - start ) / 1000;
						const record = { size, distribution, query, packed: Boolean( variant ), trial, completedFrames, seconds, batchSize: 16, raysPerFrame: rays.length / 8, fps: completedFrames / seconds, mrays: completedFrames * rays.length / 8 / seconds / 1e6 };
						trials.push( record );
						console.log( JSON.stringify( record ) );

					}

				}

			}

		}

		for ( const item of data ) item.dispose();

	}

	renderer.dispose();
	device.destroy();
	return { adapter: adapterInfo, validations, failures, trials, scenes };

};
