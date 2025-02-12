import { dispatch } from '@wordpress/data';

import { uploadMedia } from '../uploadMedia';
import { UploadError } from '../uploadError';

const mockAddItems = jest.fn();

jest.mock( '@mexp/jsquash', () => ( {} ) );
jest.mock( '@wordpress/data' );

( dispatch as jest.Mock ).mockImplementation( () => ( {
	addItems: mockAddItems,
} ) );

jest.mock( '@mexp/pdf', () => ( {
	getImageFromPdf: jest.fn(),
} ) );

const xmlFile = new window.File( [ 'fake_file' ], 'test.xml', {
	type: 'text/xml',
} );
const imageFile = new window.File( [ 'fake_file' ], 'test.jpeg', {
	type: 'image/jpeg',
} );

describe( 'uploadMedia', () => {
	afterEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should do nothing on no files', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			filesList: [],
			onError,
			onFileChange,
		} );

		expect( onError ).not.toHaveBeenCalled();
		// expect( mockAddItems ).not.toHaveBeenCalled();
	} );

	it( 'should error if allowedTypes contains a partial mime type and the validation fails', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image' ],
			filesList: [ xmlFile ],
			onError,
			onFileChange,
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'MIME_TYPE_NOT_SUPPORTED',
				message:
					'test.xml: Sorry, you are not allowed to upload this file type.',
				file: xmlFile,
			} )
		);
		expect( mockAddItems ).not.toHaveBeenCalled();
	} );

	it( 'should error if allowedTypes contains a complete mime type and the validation fails', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image/gif' ],
			filesList: [ imageFile ],
			onError,
			onFileChange,
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'MIME_TYPE_NOT_SUPPORTED',
				message:
					'test.jpeg: Sorry, you are not allowed to upload this file type.',
				file: xmlFile,
			} )
		);
		expect( mockAddItems ).not.toHaveBeenCalled();
	} );

	it( 'should work if allowedTypes contains a complete mime type and the validation succeeds', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image/jpeg' ],
			filesList: [ imageFile ],
			onError,
			onFileChange,
			wpAllowedMimeTypes: { jpeg: 'image/jpeg' },
		} );

		expect( onError ).not.toHaveBeenCalled();
		expect( mockAddItems ).toHaveBeenCalled();
	} );

	it( 'should error if allowedTypes contains multiple types and the validation fails', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'video', 'image' ],
			filesList: [ xmlFile ],
			onError,
			onFileChange,
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'MIME_TYPE_NOT_SUPPORTED',
				message:
					'test.xml: Sorry, you are not allowed to upload this file type.',
				file: xmlFile,
			} )
		);
		expect( mockAddItems ).not.toHaveBeenCalled();
	} );

	it( 'should work if allowedTypes contains multiple types and the validation succeeds', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'video', 'image' ],
			filesList: [ imageFile ],
			onError,
			onFileChange,
			wpAllowedMimeTypes: { jpeg: 'image/jpeg', mp4: 'video/mp4' },
		} );

		expect( onError ).not.toHaveBeenCalled();
		expect( mockAddItems ).toHaveBeenCalled();
	} );

	it( 'should only fail the invalid file and still allow others to succeed when uploading multiple files', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image' ],
			filesList: [ imageFile, xmlFile ],
			onError,
			onFileChange,
			wpAllowedMimeTypes: { jpeg: 'image/jpeg' },
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'MIME_TYPE_NOT_SUPPORTED',
				message:
					'test.xml: Sorry, you are not allowed to upload this file type.',
				file: xmlFile,
			} )
		);
		expect( mockAddItems ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should error if the file size is greater than the maximum', async () => {
		const onError = jest.fn();
		const onFileChange = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image' ],
			filesList: [ imageFile ],
			maxUploadFileSize: 1,
			onError,
			onFileChange,
			wpAllowedMimeTypes: { jpeg: 'image/jpeg' },
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'SIZE_ABOVE_LIMIT',
				message:
					'test.jpeg: This file exceeds the maximum upload size for this site.',
				file: imageFile,
			} )
		);
		expect( mockAddItems ).not.toHaveBeenCalled();
	} );

	it( 'should call error handler with the correct error object if file type is not allowed for user', async () => {
		const onError = jest.fn();
		await uploadMedia( {
			allowedTypes: [ 'image' ],
			filesList: [ imageFile ],
			onError,
			wpAllowedMimeTypes: { aac: 'audio/aac' },
		} );

		expect( onError ).toHaveBeenCalledWith(
			new UploadError( {
				code: 'MIME_TYPE_NOT_ALLOWED_FOR_USER',
				message:
					'test.jpeg: Sorry, you are not allowed to upload this file type.',
				file: imageFile,
			} )
		);
		expect( mockAddItems ).not.toHaveBeenCalled();
	} );
} );
