import { getFileBasename } from '../index';

describe( 'getFileBasename', () => {
	it.each( [
		[ 'my-video.mp4', 'my-video' ],
		[ 'my.video.mp4', 'my.video' ],
		[ 'my-video', 'my-video' ],
		[ '', '' ],
	] )( 'for file name %s returns basename %s', ( fileName, baseName ) => {
		expect( getFileBasename( fileName ) ).toStrictEqual( baseName );
	} );
} );
