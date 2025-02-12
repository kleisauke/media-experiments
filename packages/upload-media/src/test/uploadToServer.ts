import apiFetch from '@wordpress/api-fetch';
import { uploadToServer } from '../api';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn( () =>
		Promise.resolve( {
			id: 900,
			title: {
				raw: 'Photo',
			},
			meta: {},
		} )
	),
} ) );

describe( 'uploadToServer', () => {
	afterEach( () => {
		jest.clearAllMocks();
	} );

	it( 'sends form data', async () => {
		const jpegFile = new File( [], 'example.jpg', {
			lastModified: 1234567891,
			type: 'image/jpeg',
		} );

		await uploadToServer( jpegFile, {
			featured_media: 123,
			mexp_filename: 'example.jpg',
			meta: {
				mexp_is_muted: false,
				mexp_original_id: 9,
			},
		} );

		// TODO: Actually test sent form data is flattened.
		expect( apiFetch ).toHaveBeenCalled();
	} );
} );
