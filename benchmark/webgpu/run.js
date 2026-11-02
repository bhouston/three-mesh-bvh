import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

async function main() {

	const baseline = '26fc97c5f007b8bd905ec31df9deac5d9d668782';
	const server = await createServer( {
		configFile: false,
		root: process.cwd(),
		server: { port: 5187 },
		plugins: [ {
			name: 'upstream-traversal',
			resolveId( id ) {

				if ( id.startsWith( '/baseline/' ) ) return '\0' + id;

			},
			load( id ) {

				if ( ! id.startsWith( '\0/baseline/' ) ) return;
				const file = id.slice( '\0/baseline/'.length );
				return execFileSync( 'git-dedup', [ 'show', `${ baseline }:src/webgpu/shapecastFns/${ file }` ], { encoding: 'utf8' } )
					.replaceAll( "from '../", "from '/src/webgpu/" );

			},
		} ],
	} );
	let browser;
	try {

		await server.listen();
		browser = await puppeteer.launch( {
			headless: false,
			protocolTimeout: 0,
			args: [ '--enable-unsafe-webgpu', '--disable-frame-rate-limit', '--disable-gpu-vsync' ],
		} );
		const page = await browser.newPage();
		page.on( 'console', msg => console.log( msg.text() ) );
		page.on( 'pageerror', error => console.error( error ) );
		await page.goto( 'http://localhost:5187/benchmark/webgpu/' );
		await page.waitForFunction( 'window.run !== undefined' );
		const result = await page.evaluate( async benchmark => window.run( benchmark ), ! process.argv.includes( '--validate-only' ) );
		result.baseline = baseline;
		result.commit = execFileSync( 'git-dedup', [ 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
		result.browser = await browser.version();
		result.threeVersion = JSON.parse( readFileSync( 'node_modules/three/package.json', 'utf8' ) ).version;
		result.hardware = execFileSync( 'system_profiler', [ 'SPDisplaysDataType' ], { encoding: 'utf8' } );
		result.sourceDiff = execFileSync( 'git-dedup', [ 'diff', 'HEAD', '--', 'src/webgpu' ], { encoding: 'utf8' } );
		result.platform = execFileSync( 'sw_vers', [], { encoding: 'utf8' } );
		writeFileSync( process.env.BVH_GPU_RESULTS || 'benchmark/webgpu/results.json', JSON.stringify( result, null, 2 ) + '\n' );
		console.log( JSON.stringify( result, null, 2 ) );
		if ( result.failures.length ) process.exitCode = 1;

	} finally {

		await browser?.close();
		await server.close();

	}

}

main().catch( error => {

	console.error( error );
	process.exitCode = 1;

} );
