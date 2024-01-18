import { v4 as uuidv4 } from 'uuid';
import { createWorkerFactory } from '@shopify/web-worker';

import { createBlobURL, isBlobURL, revokeBlobURL } from '@wordpress/blob';
import type { WPDataRegistry } from '@wordpress/data/build-types/registry';
import { store as preferencesStore } from '@wordpress/preferences';

import {
	cloneFile,
	getExtensionFromMimeType,
	getFileBasename,
	getMediaTypeFromMimeType,
	ImageFile,
	renameFile,
} from '@mexp/media-utils';
import { start } from '@mexp/log';

import { UploadError } from '../uploadError';
import {
	canTranscodeFile,
	fetchRemoteFile,
	getFileNameFromUrl,
	getPosterFromVideo,
	isAnimatedGif,
	videoHasAudio,
} from '../utils';
import { sideloadFile, updateMediaItem, uploadToServer } from '../api';
import { PREFERENCES_NAME } from '../constants';
import { isHeifImage, transcodeHeifImage } from './utils/heif';
import {
	vipsCompressImage,
	vipsConvertImageFormat,
	vipsHasTransparency,
	vipsResizeImage,
} from './utils/vips';
import {
	compressImage as canvasCompressImage,
	convertImageFormat as canvasConvertImageFormat,
	resizeImage as canvasResizeImage,
} from './utils/canvas';
import type {
	AddAction,
	AdditionalData,
	AddPosterAction,
	ApproveUploadAction,
	Attachment,
	AudioFormat,
	BatchId,
	CancelAction,
	CreateRestAttachment,
	ImageFormat,
	ImageLibrary,
	ImageSizeCrop,
	MediaSourceTerm,
	OnBatchSuccessHandler,
	OnChangeHandler,
	OnErrorHandler,
	OnSuccessHandler,
	PrepareAction,
	QueueItemId,
	RemoveAction,
	RequestApprovalAction,
	SetImageSizesAction,
	SetMediaSourceTermsAction,
	SideloadFinishAction,
	ThumbnailGeneration,
	TranscodingFinishAction,
	TranscodingPrepareAction,
	TranscodingStartAction,
	UploadStartAction,
	VideoFormat,
} from './types';
import { ItemStatus, TranscodingType, Type } from './types';

const createDominantColorWorker = createWorkerFactory(
	() =>
		import(
			/* webpackChunkName: 'dominant-color' */ './workers/dominantColor'
		)
);
const dominantColorWorker = createDominantColorWorker();

const createBlurhashWorker = createWorkerFactory(
	() => import( /* webpackChunkName: 'blurhash' */ './workers/blurhash' )
);
const blurhashWorker = createBlurhashWorker();

// Safari does not currently support WebP in HTMLCanvasElement.toBlob()
// See https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
const isSafari = Boolean(
	window?.navigator.userAgent &&
		window.navigator.userAgent.includes( 'Safari' ) &&
		! window.navigator.userAgent.includes( 'Chrome' ) &&
		! window.navigator.userAgent.includes( 'Chromium' )
);

type ActionCreators = {
	uploadItem: typeof uploadItem;
	sideloadItem: typeof sideloadItem;
	addItem: typeof addItem;
	addSideloadItem: typeof addSideloadItem;
	removeItem: typeof removeItem;
	muteVideoItem: typeof muteVideoItem;
	muteExistingVideo: typeof muteExistingVideo;
	addSubtitlesForExistingVideo: typeof addSubtitlesForExistingVideo;
	convertHeifItem: typeof convertHeifItem;
	resizeCropItem: typeof resizeCropItem;
	convertGifItem: typeof convertGifItem;
	optimizeExistingItem: typeof optimizeExistingItem;
	optimizeVideoItem: typeof optimizeVideoItem;
	optimizeAudioItem: typeof optimizeAudioItem;
	optimizeImageItem: typeof optimizeImageItem;
	requestApproval: typeof requestApproval;
	rejectApproval: typeof rejectApproval;
	grantApproval: typeof grantApproval;
	prepareForTranscoding: typeof prepareForTranscoding;
	startTranscoding: typeof startTranscoding;
	finishTranscoding: typeof finishTranscoding;
	startUploading: typeof startUploading;
	finishUploading: typeof finishUploading;
	finishSideloading: typeof finishSideloading;
	cancelItem: typeof cancelItem;
	addPoster: typeof addPoster;
	< T = Record< string, unknown > >( args: T ): void;
};

type AllSelectors = typeof import('./selectors');
type CurriedState< F > = F extends ( state: any, ...args: infer P ) => infer R
	? ( ...args: P ) => R
	: F;
type Selectors = {
	[ key in keyof AllSelectors ]: CurriedState< AllSelectors[ key ] >;
};

interface AddItemArgs {
	file: File;
	batchId?: BatchId;
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onError?: OnErrorHandler;
	onBatchSuccess?: OnBatchSuccessHandler;
	additionalData?: AdditionalData;
	sourceUrl?: string;
	sourceAttachmentId?: number;
	mediaSourceTerms?: MediaSourceTerm[];
	blurHash?: string;
	dominantColor?: string;
	isSideload?: boolean;
	resize?: ImageSizeCrop;
}

export function addItem( {
	file,
	batchId,
	onChange,
	onSuccess,
	onBatchSuccess,
	onError,
	additionalData = {},
	sourceUrl,
	sourceAttachmentId,
	mediaSourceTerms = [],
	blurHash,
	dominantColor,
}: AddItemArgs ) {
	return async ( {
		dispatch,
		registry,
	}: {
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const imageSizeThreshold: number = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'bigImageSizeThreshold' );

		const resize = imageSizeThreshold
			? {
					width: imageSizeThreshold,
					height: imageSizeThreshold,
			  }
			: undefined;

		const thumbnailGeneration: ThumbnailGeneration = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'thumbnailGeneration' );

		dispatch< AddAction >( {
			type: Type.Add,
			item: {
				id: uuidv4(),
				batchId,
				status: ItemStatus.Pending,
				sourceFile: cloneFile( file ),
				file,
				attachment: {
					url: createBlobURL( file ),
				},
				additionalData: {
					generate_sub_sizes: 'server' === thumbnailGeneration,
					...additionalData,
				},
				onChange,
				onSuccess,
				onBatchSuccess,
				onError,
				sourceUrl,
				sourceAttachmentId,
				mediaSourceTerms,
				blurHash,
				dominantColor,
				resize,
			},
		} );
	};
}

interface AddItemsArgs {
	files: File[];
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onBatchSuccess?: OnBatchSuccessHandler;
	onError?: OnErrorHandler;
	additionalData?: AdditionalData;
}

export function addItems( {
	files,
	onChange,
	onSuccess,
	onError,
	onBatchSuccess,
	additionalData,
}: AddItemsArgs ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		const batchId = uuidv4();
		for ( const file of files ) {
			void dispatch.addItem( {
				file,
				batchId,
				onChange,
				onSuccess,
				onBatchSuccess,
				onError,
				additionalData,
			} );
		}
	};
}

interface AddItemFromUrlArgs {
	url: string;
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onError?: OnErrorHandler;
	additionalData?: AdditionalData;
}

export function addItemFromUrl( {
	url,
	onChange,
	onSuccess,
	onError,
	additionalData,
}: AddItemFromUrlArgs ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		const file = await fetchRemoteFile( url );

		dispatch.addItem( {
			file,
			onChange,
			onSuccess,
			onError,
			additionalData,
			sourceUrl: url,
			mediaSourceTerms: [ 'media-import' ],
		} );
	};
}

interface AddSideloadItemArgs {
	file: File;
	additionalData?: AdditionalData;
	resize?: ImageSizeCrop;
	transcode?: TranscodingType[];
	batchId?: BatchId;
}

export function addSideloadItem( {
	file,
	additionalData,
	resize,
	transcode,
	batchId,
}: AddSideloadItemArgs ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		dispatch< AddAction >( {
			type: Type.Add,
			item: {
				id: uuidv4(),
				batchId,
				status: ItemStatus.Pending,
				sourceFile: cloneFile( file ),
				file,
				additionalData: {
					generate_sub_sizes: false,
					...additionalData,
				},
				isSideload: true,
				resize,
				transcode,
			},
		} );
	};
}

interface MuteExistingVideoArgs {
	id: number;
	url: string;
	poster?: string;
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onError?: OnErrorHandler;
	additionalData?: AdditionalData;
	blurHash?: string;
	dominantColor?: string;
	generatedPosterId?: number;
}

export function muteExistingVideo( {
	id,
	url,
	poster,
	onChange,
	onSuccess,
	onError,
	additionalData = {},
	blurHash,
	dominantColor,
	generatedPosterId,
}: MuteExistingVideoArgs ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		const fileName = getFileNameFromUrl( url );
		const baseName = getFileBasename( fileName );
		const sourceFile = await fetchRemoteFile( url, fileName );
		const file = new File(
			[ sourceFile ],
			sourceFile.name.replace( baseName, `${ baseName }-muted` ),
			{ type: sourceFile.type }
		);

		// TODO: Somehow add relation between original and muted video in db.

		// TODO: Check canTranscodeFile(file) here to bail early? Or ideally already in the UI.

		// TODO: Copy over the auto-generated poster image.
		// What if the original attachment gets deleted though?
		// Maybe better to generate the poster image anew.

		// TODO: Maybe pass on the original as a "sourceAttachment"

		dispatch< AddAction >( {
			type: Type.Add,
			item: {
				id: uuidv4(),
				status: ItemStatus.Pending,
				sourceFile,
				file,
				attachment: {
					url,
					poster,
				},
				additionalData,
				onChange,
				onSuccess,
				onError,
				sourceUrl: url,
				sourceAttachmentId: id,
				mediaSourceTerms: [],
				blurHash,
				dominantColor,
				transcode: [ TranscodingType.MuteVideo ],
				generatedPosterId,
			},
		} );
	};
}

interface AddSubtitlesForExistingVideoArgs {
	id?: number;
	url: string;
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onError?: OnErrorHandler;
	additionalData: AdditionalData;
}

export function addSubtitlesForExistingVideo( {
	id,
	url,
	onChange,
	onSuccess,
	onError,
	additionalData,
}: AddSubtitlesForExistingVideoArgs ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		const fileName = getFileNameFromUrl( url );
		const sourceFile = await fetchRemoteFile( url, fileName );

		// TODO: Do this *after* adding to the queue so that we can disable the button quickly.
		// Plus, this way we can display proper error notice on failure.
		const { generateSubtitles } = await import(
			/* webpackChunkName: 'subtitles' */ '@mexp/subtitles'
		);
		const vttFile = await generateSubtitles( sourceFile );

		dispatch< AddAction >( {
			type: Type.Add,
			item: {
				id: uuidv4(),
				status: ItemStatus.Pending,
				sourceFile,
				file: vttFile,
				onChange,
				onSuccess,
				onError,
				sourceUrl: url,
				sourceAttachmentId: id,
				mediaSourceTerms: [ 'subtitles-generation' ],
				additionalData,
			},
		} );
	};
}

interface OptimizexistingItemArgs {
	id: number;
	url: string;
	poster?: string;
	batchId?: BatchId;
	onChange?: OnChangeHandler;
	onSuccess?: OnSuccessHandler;
	onBatchSuccess?: OnBatchSuccessHandler;
	onError?: OnErrorHandler;
	additionalData?: AdditionalData;
	blurHash?: string;
	dominantColor?: string;
	generatedPosterId?: number;
}

export function optimizeExistingItem( {
	id,
	url,
	poster,
	batchId,
	onChange,
	onSuccess,
	onBatchSuccess,
	onError,
	additionalData = {},
	blurHash,
	dominantColor,
	generatedPosterId,
}: OptimizexistingItemArgs ) {
	return async ( {
		dispatch,
		registry,
	}: {
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const fileName = getFileNameFromUrl( url );
		const baseName = getFileBasename( fileName );
		const sourceFile = await fetchRemoteFile( url, fileName );
		const file = new File(
			[ sourceFile ],
			sourceFile.name.replace( baseName, `${ baseName }-optimized` ),
			{ type: sourceFile.type }
		);

		const thumbnailGeneration: ThumbnailGeneration = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'thumbnailGeneration' );

		// TODO: Same considerations apply as for muteExistingVideo.

		dispatch< AddAction >( {
			type: Type.Add,
			item: {
				id: uuidv4(),
				batchId,
				status: ItemStatus.Pending,
				sourceFile,
				file,
				attachment: {
					url,
					poster,
				},
				additionalData: {
					generate_sub_sizes: 'server' === thumbnailGeneration,
					...additionalData,
				},
				onChange,
				onSuccess: async ( [ attachment ] ) => {
					onSuccess?.( [ attachment ] );
					// Update the original attachment in the DB to have
					// a reference to the optimized version.
					void updateMediaItem( id, {
						meta: {
							mexp_optimized_id: attachment.id,
						},
					} );
				},
				onBatchSuccess,
				onError,
				sourceUrl: url,
				sourceAttachmentId: id,
				mediaSourceTerms: [ 'media-optimization' ],
				blurHash,
				dominantColor,
				transcode: [ TranscodingType.OptimizeExisting ],
				generatedPosterId,
			},
		} );
	};
}

export function requestApproval(
	id: QueueItemId,
	file: File
): RequestApprovalAction {
	return {
		type: Type.RequestApproval,
		id,
		file,
		url: createBlobURL( file ),
	};
}

export function prepareItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		const { file } = item;

		dispatch< PrepareAction >( {
			type: Type.Prepare,
			id,
		} );

		// TODO: Check canTranscode either here, in muteExistingVideo, or in the UI.

		// Transcoding type has already been set, e.g. via muteExistingVideo() or addSideloadItem().
		// Also allow empty arrays, useful for example when sideloading original image.
		if ( item.transcode !== undefined ) {
			dispatch.prepareForTranscoding( id );
			return;
		}

		// eslint-disable-next-line @wordpress/no-unused-vars-before-return
		const canTranscode = canTranscodeFile( file );

		const mediaType = getMediaTypeFromMimeType( file.type );

		switch ( mediaType ) {
			case 'image':
				const operations: TranscodingType[] = [];

				const fileBuffer = await file.arrayBuffer();

				const isGif = isAnimatedGif( fileBuffer );

				const convertAnimatedGifs: boolean = registry
					.select( preferencesStore )
					.get( PREFERENCES_NAME, 'gif_convert' );

				if ( isGif && canTranscode && convertAnimatedGifs ) {
					dispatch.prepareForTranscoding( id, [
						TranscodingType.Gif,
					] );
					return;
				}

				const isHeif = await isHeifImage( fileBuffer );

				// TODO: Do we need a placeholder for a HEIF image?
				// Maybe a base64 encoded 1x1 gray PNG?
				// Use preloadImage() and getImageDimensions() so see if browser can render it.
				// Image/Video block already have a placeholder state.
				if ( isHeif ) {
					operations.push( TranscodingType.Heif );
				}

				// Always add resize operation to comply with big image size threshold.
				operations.push( TranscodingType.ResizeCrop );

				const optimizeOnUpload: boolean = registry
					.select( preferencesStore )
					.get( PREFERENCES_NAME, 'optimizeOnUpload' );

				if ( optimizeOnUpload ) {
					operations.push( TranscodingType.Image );
				}

				if ( operations.length ) {
					dispatch.prepareForTranscoding( id, operations );
					return;
				}

				break;

			case 'video':
				// Here we are potentially dealing with an unsupported file type (e.g. MOV)
				// that cannot be *played* by the browser, but could still be used for generating a poster.

				try {
					// TODO: is this the right place?
					// Note: Causes another state update.
					const poster = await getPosterFromVideo(
						createBlobURL( file ),
						`${ getFileBasename( item.file.name ) }-poster`
					);
					dispatch.addPoster( id, poster );
				} catch {
					// Do nothing for now.
				}

				// TODO: First check if video already meets criteria, e.g. with mediainfo.js.
				// No need to compress a video that's already quite small.

				if ( canTranscode ) {
					dispatch.prepareForTranscoding( id, [
						TranscodingType.Video,
					] );
					return;
				}

				break;

			case 'audio':
				if ( canTranscode ) {
					dispatch.prepareForTranscoding( id, [
						TranscodingType.Audio,
					] );
					return;
				}

				break;

			case 'pdf':
				const { getImageFromPdf } = await import(
					/* webpackChunkName: 'pdf' */ '@mexp/pdf'
				);

				// TODO: is this the right place?
				// Note: Causes another state update.
				const pdfThumbnail = await getImageFromPdf(
					createBlobURL( file ),
					// Same suffix as WP core uses, see https://github.com/WordPress/wordpress-develop/blob/8a5daa6b446e8c70ba22d64820f6963f18d36e92/src/wp-admin/includes/image.php#L609-L634
					`${ getFileBasename( item.file.name ) }-pdf`
				);
				dispatch.addPoster( id, pdfThumbnail );
		}

		if ( item.isSideload ) {
			dispatch.sideloadItem( id );
		} else {
			dispatch.uploadItem( id );
		}
	};
}

export function addPoster( id: QueueItemId, file: File ): AddPosterAction {
	return {
		type: Type.AddPoster,
		id,
		file,
		url: createBlobURL( file ),
	};
}

export function prepareForTranscoding(
	id: QueueItemId,
	transcode?: TranscodingType[]
): TranscodingPrepareAction {
	return {
		type: Type.TranscodingPrepare,
		id,
		transcode,
	};
}

export function startTranscoding( id: QueueItemId ): TranscodingStartAction {
	return {
		type: Type.TranscodingStart,
		id,
	};
}

export function finishTranscoding(
	id: QueueItemId,
	file: File,
	mediaSourceTerm?: MediaSourceTerm,
	additionalData: Partial< AdditionalData > = {}
): TranscodingFinishAction {
	return {
		type: Type.TranscodingFinish,
		id,
		file,
		url: createBlobURL( file ),
		mediaSourceTerm,
		additionalData,
	};
}

export function startUploading( id: QueueItemId ): UploadStartAction {
	return {
		type: Type.UploadStart,
		id,
	};
}

export function finishUploading( id: QueueItemId, attachment: Attachment ) {
	return {
		type: Type.UploadFinish,
		id,
		attachment,
	};
}

export function finishSideloading( id: QueueItemId ): SideloadFinishAction {
	return {
		type: Type.SideloadFinish,
		id,
	};
}

export function completeItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.removeItem( id );

		const attachment: Attachment = item.attachment as Attachment;

		// Video poster generation.

		const mediaType = getMediaTypeFromMimeType( attachment.mimeType );
		// In the event that the uploaded video already has a poster, do not upload another one.
		// Can happen when using muteExistingVideo() or when a poster is generated server-side.
		// TODO: Make the latter scenario actually work.
		//       Use getEntityRecord to actually get poster URL from posterID returned by uploadToServer()
		if (
			'video' === mediaType &&
			( ! attachment.poster || isBlobURL( attachment.poster ) )
		) {
			try {
				const poster =
					item.poster ||
					( await getPosterFromVideo(
						attachment.url,
						// Derive the basename from the uploaded video's file name
						// if available for more accuracy.
						`${ getFileBasename(
							attachment.fileName ??
								getFileNameFromUrl( attachment.url )
						) }}-poster`
					) );

				if ( poster ) {
					// Adding the poster to the queue on its own allows for it to be optimized, etc.
					dispatch.addItem( {
						file: poster,
						onChange: ( [ posterAttachment ] ) => {
							if (
								! posterAttachment.url ||
								isBlobURL( posterAttachment.url )
							) {
								return;
							}

							// Video block expects such a structure for the poster.
							// https://github.com/WordPress/gutenberg/blob/e0a413d213a2a829ece52c6728515b10b0154d8d/packages/block-library/src/video/edit.js#L154
							const updatedAttachment = {
								...attachment,
								image: {
									src: posterAttachment.url,
								},
							};

							// This might be confusing, but the idea is to update the original
							// video item in the editor with the newly uploaded poster.
							item.onChange?.( [ updatedAttachment ] );
						},
						onSuccess: async ( [ posterAttachment ] ) => {
							// Similarly, update the original video in the DB to have the
							// poster as the featured image.
							// TODO: Do this server-side instead.
							void updateMediaItem( attachment.id, {
								featured_media: posterAttachment.id,
								meta: {
									mexp_generated_poster_id:
										posterAttachment.id,
								},
							} );
						},
						additionalData: {
							// Reminder: Parent post ID might not be set, depending on context,
							// but should be carried over if it does.
							post: item.additionalData.post,
						},
						mediaSourceTerms: [ 'poster-generation' ],
						blurHash: item.blurHash,
						dominantColor: item.dominantColor,
					} );
				}
			} catch ( err ) {
				// TODO: Debug & catch & throw.
			}
		}

		const thumbnailGeneration: ThumbnailGeneration = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'thumbnailGeneration' );

		// Client-side thumbnail generation.
		// Works for images and PDF posters.

		if (
			attachment.missingImageSizes &&
			'server' !== thumbnailGeneration
		) {
			let file = attachment.fileName
				? renameFile( item.file, attachment.fileName )
				: item.file;
			const batchId = uuidv4();

			if ( 'pdf' === mediaType && item.poster ) {
				file = item.poster;

				// Upload the "full" version without a resize param.
				dispatch.addSideloadItem( {
					file: item.poster,
					additionalData: {
						// Sideloading does not use the parent post ID but the
						// attachment ID as the image sizes need to be added to it.
						post: attachment.id,
						image_size: 'full',
					},
					transcode: [ TranscodingType.Image ],
				} );
			}

			for ( const name of attachment.missingImageSizes ) {
				const imageSize = select.getImageSize( name );
				if ( imageSize ) {
					// Force thumbnails to be soft crops, see wp_generate_attachment_metadata().
					if ( 'pdf' === mediaType && 'thumbnail' === name ) {
						imageSize.crop = false;
					}

					dispatch.addSideloadItem( {
						file,
						batchId,
						additionalData: {
							// Sideloading does not use the parent post ID but the
							// attachment ID as the image sizes need to be added to it.
							post: attachment.id,
							// Reference the same upload_request if needed.
							upload_request: item.additionalData.upload_request,
						},
						resize: imageSize,
						transcode: [ TranscodingType.ResizeCrop ],
					} );
				}
			}
		}

		// Upload the original image file if it was resized because of the big image size threshold.

		if ( 'image' === mediaType ) {
			const keepOriginal: boolean = registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'keepOriginal' );

			if (
				! item.isSideload &&
				item.file instanceof ImageFile &&
				item.file.wasResized &&
				keepOriginal
			) {
				const originalName = attachment.fileName || item.file.name;
				const originalBaseName = getFileBasename( originalName );

				// TODO: What if sourceFile is of type HEIC/HEIF?
				// Mime types of item.sourceFile and item.file are different.
				// Right now this triggers another HEIC conversion, which is not ideal.
				dispatch.addSideloadItem( {
					file: renameFile(
						item.sourceFile,
						originalName.replace(
							originalBaseName,
							`${ originalBaseName }-original`
						)
					),
					additionalData: {
						// Sideloading does not use the parent post ID but the
						// attachment ID as the image sizes need to be added to it.
						post: attachment.id,
						// Reference the same upload_request if needed.
						upload_request: item.additionalData.upload_request,
						image_size: 'original',
					},
					// Allows skipping any resizing or optimization of the original image.
					transcode: [],
				} );
			}
		}
	};
}

export function removeItem( id: QueueItemId ): RemoveAction {
	return {
		type: Type.Remove,
		id,
	};
}

export function rejectApproval( id: number ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItemByAttachmentId( id );
		if ( ! item ) {
			return;
		}

		dispatch.cancelItem(
			item.id,
			new UploadError( {
				code: 'UPLOAD_CANCELLED',
				message: 'File upload was cancelled',
				file: item.file,
			} )
		);
	};
}

export function grantApproval( id: number ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItemByAttachmentId( id );
		if ( ! item ) {
			return;
		}

		dispatch< ApproveUploadAction >( {
			type: Type.ApproveUpload,
			id: item.id,
		} );
	};
}

export function cancelItem( id: QueueItemId, error: Error ): CancelAction {
	return {
		type: Type.Cancel,
		id,
		error,
	};
}

export function maybeTranscodeItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		const transcode = item.transcode ? item.transcode[ 0 ] : undefined;

		if ( ! transcode ) {
			dispatch.finishTranscoding( id, item.file );
			return;
		}

		// Prevent simultaneous FFmpeg processes to reduce resource usage.
		const isTranscoding = select.isTranscoding();

		switch ( transcode ) {
			case TranscodingType.ResizeCrop:
				void dispatch.resizeCropItem( item.id );
				break;

			case TranscodingType.Heif:
				void dispatch.convertHeifItem( item.id );
				break;

			case TranscodingType.Gif:
				if ( isTranscoding ) {
					return;
				}

				void dispatch.convertGifItem( item.id );
				break;

			case TranscodingType.Audio:
				if ( isTranscoding ) {
					return;
				}

				void dispatch.optimizeAudioItem( item.id );
				break;

			case TranscodingType.Video:
				if ( isTranscoding ) {
					return;
				}

				void dispatch.optimizeVideoItem( item.id );
				break;

			case TranscodingType.MuteVideo:
				if ( isTranscoding ) {
					return;
				}

				void dispatch.muteVideoItem( item.id );
				break;

			case TranscodingType.Image:
				if ( isTranscoding ) {
					return;
				}

				void dispatch.optimizeImageItem( item.id );
				break;

			// TODO: Right now only handles images.
			case TranscodingType.OptimizeExisting:
				if ( isTranscoding ) {
					return;
				}

				const requireApproval = registry
					.select( preferencesStore )
					.get( PREFERENCES_NAME, 'requireApproval' );

				void dispatch.optimizeImageItem( item.id, requireApproval );
				break;

			default:
			// This shouldn't happen.
			// TODO: Add error handling.
		}
	};
}

export function optimizeImageItem(
	id: QueueItemId,
	requireApproval: boolean = false
) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		const imageLibrary: ImageLibrary =
			registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'imageLibrary' ) || 'vips';

		let stop;

		try {
			let file: File;

			const inputFormat = getExtensionFromMimeType( item.file.type );

			if ( ! inputFormat ) {
				throw new Error( 'Unsupported file type' );
			}

			// TODO: Use default_outputFormat if this is e.g. a PDF thumbnail.
			const outputFormat: ImageFormat =
				registry
					.select( preferencesStore )
					.get( PREFERENCES_NAME, `${ inputFormat }_outputFormat` ) ||
				inputFormat;

			// TODO: Pass quality to all the different encoders.
			const outputQuality: number =
				registry
					.select( preferencesStore )
					.get( PREFERENCES_NAME, `${ inputFormat }_quality` ) || 80;

			stop = start(
				`Optimize Item: ${ item.file.name } | ${ imageLibrary } | ${ inputFormat } | ${ outputFormat } | ${ outputQuality }`
			);

			switch ( outputFormat ) {
				case inputFormat:
				default:
					if ( 'browser' === imageLibrary ) {
						file = await canvasCompressImage(
							item.file,
							outputQuality / 100
						);
					} else {
						file = await vipsCompressImage(
							item.file,
							outputQuality / 100
						);
					}
					break;

				case 'webp':
					if ( 'browser' === imageLibrary && ! isSafari ) {
						file = await canvasConvertImageFormat(
							item.file,
							'image/webp',
							outputQuality / 100
						);
					} else {
						file = await vipsConvertImageFormat(
							item.file,
							'image/webp',
							outputQuality / 100
						);
					}
					break;

				case 'avif':
					// No browsers support AVIF in HTMLCanvasElement.toBlob() yet, so always use vips.
					// See https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
					file = await vipsConvertImageFormat(
						item.file,
						'image/avif',
						outputQuality / 100
					);
					break;

				case 'gif':
					// Browsers don't typically support image/gif in HTMLCanvasElement.toBlob() yet, so always use vips.
					// See https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
					file = await vipsConvertImageFormat(
						item.file,
						'image/avif',
						outputQuality / 100
					);
					break;

				case 'jpeg':
				case 'png':
					if ( 'browser' === imageLibrary ) {
						file = await canvasConvertImageFormat(
							item.file,
							`image/${ outputFormat }`,
							outputQuality / 100
						);
					} else {
						file = await vipsConvertImageFormat(
							item.file,
							`image/${ outputFormat }`,
							outputQuality / 100
						);
					}
			}

			if ( item.file instanceof ImageFile ) {
				file = new ImageFile(
					file,
					item.file.width,
					item.file.height,
					item.file.originalWidth,
					item.file.originalHeight
				);
			}

			if ( requireApproval ) {
				dispatch.requestApproval( id, file );
			} else {
				dispatch.finishTranscoding( id, file, 'media-optimization' );
			}
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'MEDIA_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		} finally {
			stop?.();
		}
	};
}

export function optimizeVideoItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		const outputFormat: VideoFormat =
			registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'video_outputFormat' ) || 'mp4';

		const videoSizeThreshold: number = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'bigVideoSizeThreshold' );

		try {
			let file: File;
			const { transcodeVideo } = await import(
				/* webpackChunkName: 'ffmpeg' */ '@mexp/ffmpeg'
			);

			switch ( outputFormat ) {
				case 'ogg':
					file = await transcodeVideo(
						item.file,
						'video/ogg',
						videoSizeThreshold
					);
					break;

				case 'mp4':
				case 'webm':
				default:
					file = await transcodeVideo(
						item.file,
						`video/${ outputFormat }`,
						videoSizeThreshold
					);
					break;
			}

			dispatch.finishTranscoding( id, file, 'media-optimization' );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'VIDEO_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		}
	};
}

export function muteVideoItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		try {
			const { muteVideo } = await import(
				/* webpackChunkName: 'ffmpeg' */ '@mexp/ffmpeg'
			);
			const file = await muteVideo( item.file );
			dispatch.finishTranscoding( id, file, undefined, {
				mexp_is_muted: true,
			} );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'VIDEO_MUTING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		}
	};
}

export function optimizeAudioItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		const outputFormat: AudioFormat =
			registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'audio_outputFormat' ) || 'mp3';

		try {
			let file: File;
			const { transcodeAudio } = await import(
				/* webpackChunkName: 'ffmpeg' */ '@mexp/ffmpeg'
			);

			switch ( outputFormat ) {
				case 'ogg':
					file = await transcodeAudio( item.file, 'audio/ogg' );
					break;

				case 'mp3':
				default:
					file = await transcodeAudio( item.file, 'audio/mp3' );
					break;
			}

			dispatch.finishTranscoding( id, file, 'media-optimization' );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'AUDIO_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		}
	};
}

export function convertGifItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		const outputFormat: VideoFormat =
			registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'video_outputFormat' ) || 'video/mp4';

		const videoSizeThreshold: number = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'bigVideoSizeThreshold' );

		try {
			let file: File;
			const { convertGifToVideo } = await import(
				/* webpackChunkName: 'ffmpeg' */ '@mexp/ffmpeg'
			);

			switch ( outputFormat ) {
				case 'ogg':
					file = await convertGifToVideo(
						item.file,
						'video/ogg',
						videoSizeThreshold
					);
					break;

				case 'mp4':
				case 'webm':
				default:
					file = await convertGifToVideo(
						item.file,
						`video/${ outputFormat }`,
						videoSizeThreshold
					);
					break;
			}

			dispatch.finishTranscoding( id, file, 'gif-conversion' );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'VIDEO_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		}
	};
}

export function convertHeifItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startTranscoding( id );

		try {
			const file = await transcodeHeifImage( item.file );
			dispatch.finishTranscoding( id, file );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'IMAGE_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		}
	};
}

export function resizeCropItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
		registry,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		if ( ! item.resize ) {
			dispatch.finishTranscoding( id, item.file );
			return;
		}

		dispatch.startTranscoding( id );

		const thumbnailGeneration: ThumbnailGeneration = registry
			.select( preferencesStore )
			.get( PREFERENCES_NAME, 'thumbnailGeneration' );

		const smartCrop = Boolean( thumbnailGeneration === 'smart' );

		const imageLibrary: ImageLibrary =
			registry
				.select( preferencesStore )
				.get( PREFERENCES_NAME, 'imageLibrary' ) || 'vips';

		const addSuffix = Boolean( item.isSideload );

		const stop = start(
			`Resize Item: ${ item.file.name } | ${ imageLibrary } | ${ thumbnailGeneration } | ${ item.resize.width }x${ item.resize.height }`
		);

		try {
			let file: File;

			if ( 'browser' === imageLibrary ) {
				file = await canvasResizeImage(
					item.file,
					item.resize,
					addSuffix
				);
			} else {
				file = await vipsResizeImage(
					item.file,
					item.resize,
					smartCrop,
					addSuffix
				);
			}

			dispatch.finishTranscoding( id, file );
		} catch ( error ) {
			dispatch.cancelItem(
				id,
				error instanceof Error
					? error
					: new UploadError( {
							code: 'IMAGE_TRANSCODING_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } )
			);
		} finally {
			stop?.();
		}
	};
}

export function uploadItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		const { poster } = item;

		dispatch.startUploading( id );

		const additionalData: Partial< CreateRestAttachment > = {
			...item.additionalData,
			mexp_media_source: item.mediaSourceTerms
				?.map( ( slug ) => select.getMediaSourceTermId( slug ) )
				.filter( Boolean ) as number[],
			// generatedPosterId is set when using muteExistingVideo() for example.
			meta: {
				mexp_generated_poster_id: item.generatedPosterId,
				mexp_original_id: item.sourceAttachmentId,
			},
			mexp_blurhash: item.blurHash,
			mexp_dominant_color: item.dominantColor,
			featured_media: item.generatedPosterId,
		};

		const mediaType = getMediaTypeFromMimeType( item.file.type );

		let stillUrl = [ 'video', 'pdf' ].includes( mediaType )
			? item.attachment?.poster
			: item.attachment?.url;

		// Freshly converted GIF.
		if (
			! stillUrl &&
			'video' === mediaType &&
			'image' === getMediaTypeFromMimeType( item.sourceFile.type )
		) {
			stillUrl = createBlobURL( item.sourceFile );
		}

		// TODO: Make this async after upload?
		// Could be made reusable to enable back-filling of existing blocks.
		if (
			typeof additionalData.mexp_is_muted === 'undefined' &&
			'video' === mediaType
		) {
			try {
				const hasAudio =
					item.attachment?.url &&
					( await videoHasAudio( item.attachment.url ) );
				additionalData.mexp_is_muted = ! hasAudio;
			} catch {
				// No big deal if this fails, we can still continue uploading.
			}
		}

		if (
			! additionalData.mexp_dominant_color &&
			stillUrl &&
			[ 'video', 'image', 'pdf' ].includes( mediaType )
		) {
			// TODO: Make this async after upload?
			// Could be made reusable to enable backfilling of existing blocks.
			// TODO: Create a scaled-down version of the image first for performance reasons.
			try {
				additionalData.mexp_dominant_color =
					await dominantColorWorker.getDominantColor( stillUrl );
			} catch ( err ) {
				// No big deal if this fails, we can still continue uploading.
				// TODO: Debug & catch & throw.
			}
		}

		if ( 'image' === mediaType && stillUrl && window.crossOriginIsolated ) {
			// TODO: Make this async after upload?
			// Could be made reusable to enable backfilling of existing blocks.
			// TODO: Create a scaled-down version of the image first for performance reasons.
			try {
				additionalData.mexp_has_transparency =
					await vipsHasTransparency( stillUrl );
			} catch ( err ) {
				// No big deal if this fails, we can still continue uploading.
				// TODO: Debug & catch & throw.
			}
		}

		if (
			! additionalData.mexp_blurhash &&
			stillUrl &&
			[ 'video', 'image', 'pdf' ].includes( mediaType )
		) {
			// TODO: Make this async after upload?
			// Could be made reusable to enable backfilling of existing blocks.
			// TODO: Create a scaled-down version of the image first for performance reasons.
			try {
				additionalData.mexp_blurhash =
					await blurhashWorker.getBlurHash( stillUrl );
			} catch ( err ) {
				// No big deal if this fails, we can still continue uploading.
				// TODO: Debug & catch & throw.
			}
		}

		// Revoke blob URL created above.
		if ( stillUrl && isBlobURL( stillUrl ) ) {
			revokeBlobURL( stillUrl );
		}

		try {
			const attachment = await uploadToServer(
				item.file,
				additionalData
			);

			// TODO: Check if a poster happened to be generated on the server side already (check attachment.posterId !== 0).
			// In that case there is no need for client-side generation.
			// Instead, get the poster URL from the ID. Maybe async within the finishUploading() action?
			if ( 'video' === mediaType ) {
				// The newly uploaded file won't have a poster yet.
				// However, we'll likely still have one on file.
				// Add it back so we're never without one.
				if ( item.attachment?.poster ) {
					attachment.poster = item.attachment.poster;
				} else if ( poster ) {
					attachment.poster = createBlobURL( poster );
				}
			}

			dispatch.finishUploading( id, attachment );
		} catch ( err ) {
			const error =
				err instanceof Error
					? err
					: new UploadError( {
							code: 'UNKNOWN_UPLOAD_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } );

			dispatch.cancelItem( id, error );
		}
	};
}

export function sideloadItem( id: QueueItemId ) {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const item = select.getItem( id );
		if ( ! item ) {
			return;
		}

		dispatch.startUploading( id );

		try {
			// TODO: Do something with result.
			await sideloadFile( item.file, {
				image_size: item.resize?.name,
				...item.additionalData,
			} );

			dispatch.finishSideloading( id );
		} catch ( err ) {
			const error =
				err instanceof Error
					? err
					: new UploadError( {
							code: 'UNKNOWN_UPLOAD_ERROR',
							message: 'File could not be uploaded',
							file: item.file,
					  } );

			dispatch.cancelItem( id, error );
		}
	};
}

export function setMediaSourceTerms(
	terms: Record< string, number >
): SetMediaSourceTermsAction {
	return {
		type: Type.SetMediaSourceTerms,
		terms,
	};
}

export function setImageSizes(
	imageSizes: Record< string, ImageSizeCrop >
): SetImageSizesAction {
	return {
		type: Type.SetImageSizes,
		imageSizes,
	};
}
