import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFile, mkdtemp } from 'node:fs/promises';

import { v4 as uuidv4 } from 'uuid';
import type { Page, Locator } from '@playwright/test';

export class MediaUtils {
	page: Page;
	basePath: string;
	DEFAULT_IMAGE_PATH: string;

	constructor( { page } ) {
		this.page = page;
		this.basePath = join( __dirname, '..', 'assets' );

		this.DEFAULT_IMAGE_PATH = join(
			this.basePath,
			'wordpress-logo-512x512.png'
		);
	}

	async upload( inputElement: Locator, fileName?: string ) {
		const tmpDirectory = await mkdtemp(
			join( tmpdir(), 'gutenberg-test-image-' )
		);
		const newFileName = uuidv4();
		const filepath = fileName
			? join( this.basePath, fileName )
			: this.DEFAULT_IMAGE_PATH;
		const tmpFileName = join(
			tmpDirectory,
			`${ newFileName }${ extname( filepath ) }`
		);
		await copyFile( filepath, tmpFileName );

		await inputElement.setInputFiles( tmpFileName );

		return newFileName;
	}

	async getImageBuffer( url: string ) {
		const response = await this.page.request.get( url );
		return response.body();
	}

	/**
	 * Whether an image is an animated GIF.
	 *
	 * Loosely based on https://www.npmjs.com/package/animated-gif-detector (MIT-compatible ISC license)
	 *
	 * See http://www.matthewflickinger.com/lab/whatsinagif/bits_and_bytes.asp for how GIFs are structured.
	 *
	 * @param buffer The GIF ArrayBuffer instance.
	 * @return Whether this is an animated GIF or not.
	 */
	async isAnimatedGif( buffer: ArrayBuffer ) {
		// See http://www.matthewflickinger.com/lab/whatsinagif/bits_and_bytes.asp.
		const BLOCK_TERMINATOR = 0x00;
		const EXTENSION_INTRODUCER = 0x21;
		const GRAPHIC_CONTROL_LABEL = 0xf9;

		const arr = new Uint8Array( buffer );
		let frames = 0;

		// Make sure it's a GIF and skip early if it isn't.
		// 47="G", 49="I", 46="F", 38="8"
		if (
			arr[ 0 ] !== 0x47 ||
			arr[ 1 ] !== 0x49 ||
			arr[ 2 ] !== 0x46 ||
			arr[ 3 ] !== 0x38
		) {
			return false;
		}

		for ( let i = 4; i < arr.length; i++ ) {
			// We reached a new block, increase frame count.
			if (
				arr[ i ] === BLOCK_TERMINATOR &&
				arr[ i + 1 ] === EXTENSION_INTRODUCER &&
				arr[ i + 2 ] === GRAPHIC_CONTROL_LABEL
			) {
				frames++;
			}
		}

		return frames > 1;
	}
}
