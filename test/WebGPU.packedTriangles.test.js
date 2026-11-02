import { describe, it, expect } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Group, InstancedMesh } from 'three';
import { MeshBVH } from '../src/index.js';
import { BVHComputeData } from '../src/webgpu/BVHComputeData.js';

function expectPackedPositions( data ) {

	const indices = data.storage.index.proxyNode.value.array;
	const attributes = new Float32Array( data.storage.attributes.proxyNode.value.array.buffer );
	const packed = data.storage.trianglePositions.proxyNode.value.array;
	const stride = data.structs.attributes.proxyNode.getLength();
	const positionOffset = data.structs.attributes.proxyNode.membersLayout.findIndex( member => member.name === 'position' ) * 4;
	for ( let i = 0; i < indices.length; i ++ ) {

		const offset = indices[ i ] * stride + positionOffset;
		expect( [ ...packed.slice( i * 4, i * 4 + 4 ) ] ).toEqual( [ ...attributes.slice( offset, offset + 3 ), 1 ] );

	}

}

describe( 'Optional WebGPU packed triangles', () => {

	it( 'allocates no triangle-position buffer by default', () => {

		const data = new BVHComputeData( new BoxGeometry() );
		data.update();
		expect( 'trianglePositions' in data.storage ).toBe( false );
		data.dispose();

	} );

	it( 'packs BVH-ordered positions once for shared meshes and instances', () => {

		const geometry = new BoxGeometry();
		geometry.boundsTree = new MeshBVH( geometry, { indirect: true } );
		const group = new Group();
		group.add( new Mesh( geometry ), new Mesh( geometry ), new InstancedMesh( geometry, new MeshBasicMaterial(), 20 ) );
		group.updateMatrixWorld( true );
		const data = new BVHComputeData( group, { packedTriangles: true, attributes: { normal: 'vec4f', position: 'vec4f' } } );
		data.update();
		expectPackedPositions( data );
		expect( data.storage.trianglePositions.proxyNode.value.array.byteLength ).toBe( geometry.index.count / 3 * 48 );
		data.dispose();

	} );

	it( 'rebuilds and disposes packed data after a geometry refit and update', () => {

		const geometry = new BoxGeometry();
		geometry.boundsTree = new MeshBVH( geometry );
		const data = new BVHComputeData( geometry, { packedTriangles: true } );
		data.update();
		const previous = data.storage.trianglePositions.proxyNode.value;
		let disposed = false;
		previous.addEventListener( 'dispose', () => disposed = true );
		geometry.translate( 3, 4, 5 );
		geometry.boundsTree.refit();
		data.update();
		expect( disposed ).toBe( true );
		expectPackedPositions( data );
		expect( data.storage.trianglePositions.proxyNode.value ).not.toBe( previous );
		const current = data.storage.trianglePositions.proxyNode.value;
		let finalDisposed = false;
		current.addEventListener( 'dispose', () => finalDisposed = true );
		data.dispose();
		expect( finalDisposed ).toBe( true );

	} );

	it( 'supports nonindexed and empty geometry', () => {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ], 3 ) );
		const data = new BVHComputeData( geometry, { packedTriangles: true } );
		data.update();
		expectPackedPositions( data );
		expect( data.storage.trianglePositions.proxyNode.value.array.byteLength ).toBe( 48 );
		data.dispose();
		const empty = new BufferGeometry();
		empty.setAttribute( 'position', new Float32BufferAttribute( [], 3 ) );
		const emptyData = new BVHComputeData( empty, { packedTriangles: true } );
		emptyData.update();
		expect( emptyData.storage.trianglePositions.proxyNode.value.array.byteLength ).toBe( 32 );
		emptyData.dispose();

	} );

} );
