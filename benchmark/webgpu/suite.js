import { BoxGeometry, TorusKnotGeometry, Mesh, MeshBasicMaterial, Group, InstancedMesh, Matrix4, Vector3, Ray, DoubleSide, Triangle, Matrix3, BufferGeometry, Float32BufferAttribute } from 'three';
import { WebGPURenderer, StorageBufferAttribute } from 'three/webgpu';
import { storage, instanceIndex } from 'three/tsl';
import { BVHComputeData, wgslTagFn, wgslTagCode } from '/src/webgpu/index.js';
import { MeshBVH, SAH } from '/src/index.js';
import { getRaycastFirstHitFn } from '/src/webgpu/shapecastFns/getRaycastFirstHitFn.js';
import { getShapecastFn } from '/src/webgpu/shapecastFns/getShapecastFn.js';
import { getRaycastFirstHitFn as baselineRaycast } from '/baseline/getRaycastFirstHitFn.js';
import { getShapecastFn as baselineShapecast } from '/baseline/getShapecastFn.js';
import { rayStruct, rayIntersectionResultStruct, bvhNodeBoundsStruct, bvhNodeStruct, pointQueryResultStruct } from '/src/webgpu/tsl/structs.js';

function randomGenerator( seed = 12345 ) {

	return () => {

		seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0;
		return seed / 4294967296;

	};

}

function makeScene( size ) {

	if ( size === 'edges' || size === 'empty' ) {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new Float32BufferAttribute( size === 'empty' ? [] : [
			- 1, - 1, 0, 1, - 1, 0, 0, 1, 0,
			- 1, - 1, 0, 1, - 1, 0, 0, 1, 0,
			0, 0, 1, 0, 0, 1, 0, 0, 1,
		], 3 ) );
		geometry.boundsTree = new MeshBVH( geometry, { strategy: SAH, targetLeafSize: 1 } );
		const root = new Group();
		root.add( new Mesh( geometry, new MeshBasicMaterial( { side: DoubleSide } ) ) );
		root.updateMatrixWorld( true );
		return root;

	}

	const root = new Group();
	const geometry = size === 'small' ? new BoxGeometry( 2, 2, 2, 3, 3, 3 ) : new TorusKnotGeometry( 1, 0.35, size === 'medium' ? 128 : 512, 32 );
	geometry.boundsTree = new MeshBVH( geometry, { strategy: SAH, targetLeafSize: 4 } );
	const material = new MeshBasicMaterial( { side: DoubleSide } );
	const count = size === 'small' ? 1 : size === 'medium' ? 12 : 100;
	for ( let i = 0; i < count; i ++ ) {

		const mesh = new Mesh( geometry, material );
		if ( i > 0 ) {

			mesh.position.set( ( i % 5 - 2 ) * 2.5, ( Math.floor( i / 5 ) % 5 - 2 ) * 2.5, - Math.floor( i / 25 ) * 3 );
			mesh.scale.set( i % 2 ? - 0.7 : 1.2, 0.5 + i % 3, 1.3 );
			mesh.rotation.set( i * 0.17, i * 0.31, 0.2 );

		}

		if ( i === 3 ) mesh.visible = false;
		root.add( mesh );

	}

	if ( size !== 'small' ) {

		const instances = new InstancedMesh( geometry, material, 3 );
		for ( let i = 0; i < 3; i ++ ) instances.setMatrixAt( i, new Matrix4().makeTranslation( i * 2 - 2, 3, 2 ) );
		root.add( instances );

	}

	root.updateMatrixWorld( true );
	return root;

}

function makeRays( distribution, count ) {

	const rand = randomGenerator();
	const rays = new Float32Array( count * 8 );
	for ( let i = 0; i < count; i ++ ) {

		const origin = new Vector3();
		const direction = new Vector3();
		if ( distribution === 'camera' ) {

			origin.set( 0, 0, 10 );
			direction.set( ( rand() - 0.5 ) * 1.6, ( rand() - 0.5 ) * 1.6, - 1 );

		} else {

			origin.set( ( rand() - 0.5 ) * 12, ( rand() - 0.5 ) * 12, ( rand() - 0.5 ) * 12 );
			const z = rand();
			const angle = rand() * Math.PI * 2;
			const radius = Math.sqrt( z );
			direction.set( radius * Math.cos( angle ), radius * Math.sin( angle ), Math.sqrt( 1 - z ) );
			if ( distribution === 'miss' ) direction.copy( origin );

		}

		// Axis parallel, negative zero, inside/on-boundary, nearly parallel and finite rays.
		if ( i < 24 ) {

			origin.set( i % 3 - 1, Math.floor( i / 3 ) % 3 - 1, i < 12 ? 4 : 0 );
			direction.set( i % 2 ? - 0 : 1e-12, 0, - 1 );

		}

		direction.normalize();
		rays.set( [ ...origin.toArray(), distribution === 'short-shadow' ? 0.75 : distribution === 'long-shadow' ? 20 : 0, ...direction.toArray(), 0 ], i * 8 );

	}

	return rays;

}

function cpuHits( root, rays, count, data ) {

	const slots = [ ...data._getTransformMap( data.bvh ).values() ];

	const objects = [];
	root.traverse( object => {

		if ( ! object.isMesh ) return;
		for ( let parent = object; parent; parent = parent.parent ) {

			if ( ! parent.visible ) return;

		}

		if ( object.isInstancedMesh ) {

			for ( let i = 0; i < object.count; i ++ ) {

				const matrix = new Matrix4();
				object.getMatrixAt( i, matrix );
				matrix.premultiply( object.matrixWorld );
				objects.push( { geometry: object.geometry, matrix, slots: slots.filter( entry => entry.object === object && entry.instanceId === i ).map( entry => entry.slot ) } );

			}

		} else {

			objects.push( { geometry: object.geometry, matrix: object.matrixWorld, slots: slots.filter( entry => entry.object === object ).map( entry => entry.slot ) } );

		}

	} );
	return Array.from( { length: count }, ( _, i ) => {

		const ray = new Ray( new Vector3().fromArray( rays, i * 8 ), new Vector3().fromArray( rays, i * 8 + 4 ) );
		let closest = null;
		for ( const { geometry, matrix, slots } of objects ) {

			const local = ray.clone().applyMatrix4( matrix.clone().invert() );
			const hit = geometry.boundsTree.raycastFirst( local, DoubleSide );
			if ( ! hit ) continue;
			const distance = hit.point.applyMatrix4( matrix ).distanceTo( ray.origin );
			const limit = rays[ i * 8 + 3 ];
			if ( limit > 0 && distance >= limit ) continue;
			if ( ! closest || distance < closest.distance - 1e-5 ) closest = { distance, slots: [ ...slots ] };
			else if ( Math.abs( distance - closest.distance ) < 1e-5 ) closest.slots.push( ...slots );

		}

		return closest;

	} );

}

function makeKernel( data, variant, rays ) {

	const facade = {
		storage: data.storage,
		getShapecastFn: options => {

			if ( variant === 'baseline' ) return baselineShapecast( data, options );
			if ( variant === 'robust-baseline' ) {

				const distance = options.boundsDistanceFn;
				options.intersectsBoundsFn = wgslTagFn`
					fn robustBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> u32 {
						return u32( ${ distance }( ray, bounds, result ) >= 0.0 );
					}
				`;
				options.boundsOrderFn = wgslTagFn`
					fn order( ray: ${ rayStruct }, axis: u32, node: ${ bvhNodeStruct } ) -> bool {
						return ray.direction[axis] >= 0.0;
					}
				`;
				delete options.boundsDistanceFn;
				delete options.distanceLimitFn;
				return baselineShapecast( data, options );

			}

			if ( variant === 'ordering' ) options.distanceLimitFn = null;
			return getShapecastFn( data, options );

		},
	};
	const query = variant === 'baseline' ? baselineRaycast( facade ) : variant === 'any-hit' ? data.fns.raycastAnyHit : getRaycastFirstHitFn( facade );
	const input = storage( new StorageBufferAttribute( rays, 4 ), 'vec4' ).toReadOnly();
	const outputAttribute = new StorageBufferAttribute( rays.length / 8 * 16, 1 );
	const output = storage( outputAttribute, 'uint' );
	const shader = wgslTagFn`
		fn runRay( id: u32 ) -> void {
			var ray: ${ rayStruct };
			let a = ${ input }[ id * 2u ];
			let b = ${ input }[ id * 2u + 1u ];
			ray.origin = a.xyz;
			ray.direction = b.xyz;
			ray.maxDist = a.w;
			var hit: ${ rayIntersectionResultStruct };
			${ variant === 'any-hit' ? wgslTagCode`hit.didHit = ${ query }( ray );` : wgslTagCode`${ query }( ray, &hit );` }
			let base = id * 16u;
			${ output }[base] = u32(hit.didHit);
			${ output }[base + 1u] = bitcast<u32>(hit.dist);
			${ output }[base + 2u] = hit.indices.w;
			${ output }[base + 3u] = hit.objectIndex;
			${ output }[base + 4u] = bitcast<u32>(hit.barycoord.x);
			${ output }[base + 5u] = bitcast<u32>(hit.barycoord.y);
			${ output }[base + 6u] = bitcast<u32>(hit.barycoord.z);
			${ output }[base + 7u] = bitcast<u32>(hit.side);
			${ output }[base + 8u] = bitcast<u32>(hit.normal.x);
			${ output }[base + 9u] = bitcast<u32>(hit.normal.y);
			${ output }[base + 10u] = bitcast<u32>(hit.normal.z);
		}
	`;
	return { kernel: shader( { id: instanceIndex } ).compute( rays.length / 8, [ 64 ] ), outputAttribute };

}

async function validateNonRay( renderer ) {

	const data = new BVHComputeData( makeScene( 'small' ) );
	data.update();
	const attribute = new StorageBufferAttribute( 4, 1 );
	const output = storage( attribute, 'float' );
	const query = data.fns.closestPointToPoint;
	const shader = wgslTagFn`
		fn testPoint() -> void {

			var result: ${ pointQueryResultStruct };
			${ query }( vec3f( 3.0, 0.0, 0.0 ), &result );
			${ output }[0] = result.distanceSq;
			${ output }[1] = result.closestPoint.x;
			${ output }[2] = result.closestPoint.y;
			${ output }[3] = result.closestPoint.z;

		}
	`;
	await renderer.computeAsync( shader().compute( 1 ) );
	const actual = [ ...new Float32Array( await renderer.getArrayBufferAsync( attribute ) ) ];
	data.dispose();
	if ( actual.some( ( value, i ) => Math.abs( value - [ 4, 1, 0, 0 ][ i ] ) > 1e-5 ) ) throw new Error( 'Non-ray shapecast failed: ' + actual );
	return { closestPointToPoint: actual };

}

window.run = async ( benchmark = true ) => {

	const adapter = await navigator.gpu?.requestAdapter();
	if ( ! adapter ) throw new Error( 'A hardware WebGPU adapter is required.' );
	const info = adapter.info;
	const adapterInfo = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter };
	if ( adapterInfo.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test( JSON.stringify( adapterInfo ) ) ) throw new Error( 'Software adapters are unsupported.' );
	console.log( 'Adapter: ' + JSON.stringify( adapterInfo ) );
	const device = await adapter.requestDevice();
	const renderer = new WebGPURenderer( { device } );
	await renderer.init();
	if ( ! renderer.backend.isWebGPUBackend ) throw new Error( 'WebGPU backend required.' );
	const queue = renderer.backend.device.queue;
	const failures = [];
	device.addEventListener( 'uncapturederror', event => failures.push( { gpuError: event.error.message } ) );
	const nonRay = await validateNonRay( renderer );
	const validations = [];
	const trials = [];
	const scenes = [];
	const firstDispatches = [];
	const variants = [ 'baseline', 'robust-baseline', 'ordering', 'pruning', 'any-hit' ];
	for ( const size of [ 'edges', 'empty', 'updated', 'refit', 'small', 'medium', 'large' ] ) {

		const root = makeScene( size === 'updated' || size === 'refit' ? 'medium' : size );
		const data = new BVHComputeData( root );
		const start = performance.now();
		data.update();
		const preparationMs = performance.now() - start;
		if ( size === 'updated' ) {

			root.children[ 0 ].position.set( 3, 2, - 1 );
			root.children[ 1 ].visible = false;
			root.children[ 3 ].visible = true;
			root.children.at( - 1 ).setMatrixAt( 1, new Matrix4().makeScale( - 2, 0.5, 3 ) );
			root.updateMatrixWorld( true );
			data.updateTransforms();

		} else if ( size === 'refit' ) {

			const geometry = root.children[ 0 ].geometry;
			geometry.scale( 1.2, 0.7, 1.4 );
			geometry.boundsTree.refit();
			data.update();

		}

		scenes.push( { size, preparationMs, uniqueTriangles: size === 'empty' ? 0 : data.storage.index.proxyNode.value.array.length / 3, bytes: Object.fromEntries( [ 'nodes', 'index', 'attributes', 'transforms' ].map( name => [ name, data.storage[ name ].proxyNode.value.array.byteLength ] ) ), strategy: 'SAH', targetLeafSize: size === 'edges' || size === 'empty' ? 1 : 4 } );
		for ( const distribution of [ 'camera', 'diffuse', 'short-shadow', 'long-shadow', 'miss' ] ) {

			const rays = makeRays( distribution, 16384 );
			if ( size === 'edges' ) {

				// Exact exclusive endpoint and both adjacent finite limits.
				for ( let i = 0; i < 4; i ++ ) rays.set( [ 0, 0, 4, [ 0, 4, 3.999, 4.001 ][ i ], 0, - 0, - 1, 0 ], i * 8 );

			}

			const reference = cpuHits( root, rays, 1024, data );
			const kernels = variants.map( variant => makeKernel( data, variant, rays ) );
			const results = [];
			for ( let v = 0; v < variants.length; v ++ ) {

				const { kernel, outputAttribute } = kernels[ v ];
				const compileStart = performance.now();
				await renderer.computeAsync( kernel );
				await queue.onSubmittedWorkDone();
				firstDispatches.push( { size, distribution, variant: variants[ v ], milliseconds: performance.now() - compileStart } );
				const buffer = await renderer.getArrayBufferAsync( outputAttribute );
				const u32 = new Uint32Array( buffer );
				const f32 = new Float32Array( buffer );
				results.push( { u32, f32 } );
				let mismatches = 0;
				for ( let i = 0; i < reference.length; i ++ ) {

					const cpu = reference[ i ];
					const hit = u32[ i * 16 ] !== 0;
					if ( hit !== Boolean( cpu ) || ( hit && variants[ v ] !== 'any-hit' && Math.abs( f32[ i * 16 + 1 ] - cpu.distance ) > 2e-4 * Math.max( 1, cpu.distance ) ) ) {

						if ( mismatches < 10 ) console.log( JSON.stringify( { i, cpu, hit, dist: f32[ i * 16 + 1 ], variant: variants[ v ] } ) );
						mismatches ++;

					}

				}

				// All rays compare against upstream. Exact ties may select a different first hit.
				let differences = 0;
				if ( v > 1 ) for ( let i = 0; i < rays.length / 8; i ++ ) {

					const base = i * 16;
					const previous = results[ 1 ];
					if ( u32[ base ] !== previous.u32[ base ] || ( u32[ base ] && variants[ v ] !== 'any-hit' && Math.abs( f32[ base + 1 ] - previous.f32[ base + 1 ] ) > 2e-4 * Math.max( 1, f32[ base + 1 ] ) ) ) differences ++;

				}

				let fieldMismatches = 0;
				if ( variants[ v ] !== 'any-hit' ) {

					const positions = new Float32Array( data.storage.attributes.proxyNode.value.array.buffer );
					const indices = data.storage.index.proxyNode.value.array;
					const matrices = new Float32Array( data.storage.transforms.proxyNode.value.array.buffer );
					for ( let i = 0; i < rays.length / 8; i ++ ) {

						const base = i * 16;
						if ( ! u32[ base ] ) continue;
						const ti = u32[ base + 2 ];
						const slot = u32[ base + 3 ];
						const toWorld = new Matrix4().fromArray( matrices, slot * 36 );
						const inverse = new Matrix4().fromArray( matrices, slot * 36 + 16 );
						const tri = new Triangle( ...[ 0, 1, 2 ].map( j => new Vector3().fromArray( positions, indices[ ti * 3 + j ] * 4 ) ) );
						const ray = new Ray( new Vector3().fromArray( rays, i * 8 ), new Vector3().fromArray( rays, i * 8 + 4 ) );
						const local = ray.clone().applyMatrix4( inverse );
						const actualBary = new Vector3().fromArray( f32, base + 4 );
						const point = tri.a.clone().multiplyScalar( actualBary.x ).addScaledVector( tri.b, actualBary.y ).addScaledVector( tri.c, actualBary.z );
						const side = Math.sign( - local.direction.dot( new Vector3().crossVectors( tri.b.clone().sub( tri.a ), tri.c.clone().sub( tri.a ) ) ) );
						const normal = tri.getNormal( new Vector3() ).multiplyScalar( side ).applyMatrix3( new Matrix3().setFromMatrix4( inverse ).transpose() ).normalize();
						const actualNormal = new Vector3().fromArray( f32, base + 8 );
						const error = point.applyMatrix4( toWorld ).distanceTo( ray.at( f32[ base + 1 ], new Vector3() ) );
						if ( error > 2e-4 * Math.max( 1, f32[ base + 1 ] ) || Math.abs( actualBary.x + actualBary.y + actualBary.z - 1 ) > 1e-5 || Math.min( actualBary.x, actualBary.y, actualBary.z ) < - 1e-5 || normal.distanceTo( actualNormal ) > 2e-3 || side !== f32[ base + 7 ] || ( i < reference.length && reference[ i ] && ! reference[ i ].slots.includes( slot ) ) ) {

							if ( fieldMismatches < 2 ) console.log( JSON.stringify( { field: i, error, side, actualSide: f32[ base + 7 ], normal: normal.toArray(), actualNormal: actualNormal.toArray(), slot, cpu: reference[ i ], bary: actualBary.toArray(), ti } ) );
							fieldMismatches ++;

						}

					}

				}

				const validation = { size, distribution, variant: variants[ v ], cpuRays: reference.length, gpuRays: rays.length / 8, mismatches, differences, fieldMismatches };
				validations.push( validation );
				if ( ( mismatches && variants[ v ] !== 'baseline' ) || differences || fieldMismatches ) failures.push( validation );
				console.log( JSON.stringify( validation ) );

			}

			if ( benchmark && [ 'small', 'medium', 'large' ].includes( size ) && failures.length === 0 ) {

				for ( let trial = 0; trial < 3; trial ++ ) for ( const v of trial % 2 ? [ 4, 3, 2, 1 ] : [ 1, 2, 3, 4 ] ) {

					const { kernel } = kernels[ v ];
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
					const record = { size, distribution, variant: variants[ v ], trial, completedFrames, seconds, batchSize: 16, raysPerFrame: rays.length / 8, fps: completedFrames / seconds, mrays: completedFrames * rays.length / 8 / seconds / 1e6 };
					trials.push( record );
					console.log( JSON.stringify( record ) );

				}

			}

		}

		data.dispose();

	}

	renderer.dispose();
	device.destroy();
	return { adapter: adapterInfo, validations, failures, trials, scenes, firstDispatches, nonRay };

};
