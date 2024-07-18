import apiFetch from '@wordpress/api-fetch';

import type { CreateSideloadFile, RestAttachment } from './types';
import { flattenFormData } from './flattenFormData';
import { transformAttachment } from './transformAttachment';

/**
 * Uploads a file to the server without creating an attachment.
 *
 * @param file           Media File to Save.
 * @param attachmentId   Parent attachment ID.
 * @param additionalData Additional data to include in the request.
 * @param signal         Abort signal.
 *
 * @return The saved attachment.
 */
export async function sideloadToServer(
	file: File,
	attachmentId: RestAttachment[ 'id' ],
	additionalData: CreateSideloadFile = {},
	signal?: AbortSignal
) {
	// Create upload payload.
	const data = new FormData();
	data.append( 'file', file, file.name || file.type.replace( '/', '.' ) );
	for ( const [ key, value ] of Object.entries( additionalData ) ) {
		flattenFormData(
			data,
			key,
			value as string | Record< string, string > | undefined
		);
	}

	return transformAttachment(
		await apiFetch< RestAttachment >( {
			// This allows the video block to directly get a video's the poster image.
			path: `/wp/v2/media/${ attachmentId }/sideload?_embed=wp:featuredmedia`,
			body: data,
			method: 'POST',
			signal,
		} )
	);
}
