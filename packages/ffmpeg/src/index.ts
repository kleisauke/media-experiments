import { v4 as uuidv4 } from 'uuid';
import {
	blobToFile,
	getExtensionFromMimeType,
	getFileBasename,
} from '@mexp/media-utils';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

const VIDEO_CODEC: Record< string, string > = {
	'video/mp4': 'libx264', // H.264
	'video/ogg': 'libtheora',
	'video/webm': 'libvpx-vp9',
};

const AUDIO_CODEC: Record< string, string > = {
	'audio/mp3': 'libmp3lame',
	'audio/ogg': 'libvorbis',
};

const FFMPEG_CONFIG = {
	FPS: [
		// Reduce to 24fps.
		// See https://trac.ffmpeg.org/wiki/ChangingFrameRate
		'-r',
		'24',
	],
	FASTSTART: [
		// move some information to the beginning of your file.
		'-movflags',
		'+faststart',
	],
	COLOR_PROFILE: [
		// Simpler color profile
		'-pix_fmt',
		'yuv420p',
	],
	PRESET: [
		// As the name says...
		'-preset',
		'fast', // 'veryfast' seems to cause crashes.
	],
	SEEK_TO_START: [
		// Desired position.
		// Using as an input option (before -i) saves us some time by seeking to position.
		'-ss',
		'00:00:01.000',
	],
	SINGLE_FRAME: [
		// Stop writing to the stream after 1 frame.
		'-frames:v',
		'1',
	],
};

const ffmpegCoreUrl = FFMPEG_CDN_URL;

const isDevelopment =
	typeof process !== 'undefined' &&
	process.env &&
	process.env.NODE_ENV !== 'production';

function readFile( file: File ): Promise< Uint8Array > {
	const reader = new FileReader();
	return new Promise( ( resolve, reject ) => {
		reader.addEventListener( 'load', () =>
			resolve( new Uint8Array( reader.result as ArrayBuffer ) )
		);
		reader.addEventListener( 'error', ( event ) =>
			event.target?.error?.code
				? reject(
						new Error(
							`Could not read file (Code: ${ event.target.error.code })`
						)
				  )
				: reject( new Error( 'Could not read file' ) )
		);
		reader.readAsArrayBuffer( file );
	} );
}

async function loadFFmpeg( file: File ) {
	const { createFFmpeg } = await import(
		/* webpackChunkName: "chunk-ffmpeg" */
		'@ffmpeg/ffmpeg'
	);

	const ffmpeg = createFFmpeg( {
		corePath: ffmpegCoreUrl,
		log: isDevelopment,
	} );
	await ffmpeg.load();

	ffmpeg.FS( 'writeFile', file.name, await readFile( file ) );

	return ffmpeg;
}

/**
 * Run FFmpeg with a given config.
 *
 * @param file     Input file object.
 * @param config   FFmpeg config arguments.
 * @param mimeType Output mime type.
 * @param fileName Output file name.
 * @return Output file object.
 */
export async function runFFmpegWithConfig(
	file: File,
	config: string[],
	mimeType: string,
	fileName: string
) {
	let ffmpeg: FFmpeg | undefined;

	try {
		ffmpeg = await loadFFmpeg( file );

		const tempFileName = `tmp-${ uuidv4() }-${ fileName }`;

		await ffmpeg.run(
			...config,
			// Output filename. MUST be different from input filename.
			tempFileName
		);

		const data = ffmpeg.FS( 'readFile', tempFileName );

		// Delete file in MEMFS to free memory.
		ffmpeg.FS( 'unlink', tempFileName );

		return blobToFile(
			new Blob( [ data.buffer ], { type: mimeType } ),
			fileName,
			mimeType
		);
	} catch ( err ) {
		// eslint-disable-next-line no-console -- We want to surface this error.
		console.error( err );
		throw err;
	} finally {
		try {
			// Also removes MEMFS to free memory.
			ffmpeg?.exit();
		} catch {
			// Not interested in errors here.
		}
	}
}

/**
 * Get FFmpeg scale argument to keep video within threshold.
 *
 * Adds 1px pad to width/height if they're not divisible by 2, which FFmpeg will complain about.
 *
 * See https://trac.ffmpeg.org/wiki/Scaling
 *
 * @param threshold Big video size threshold
 */
function getScaleArg( threshold: number ) {
	if ( ! threshold ) {
		return [];
	}

	return [
		'-vf',
		`scale='min(${ threshold },iw)':'min(${ threshold },ih)':'force_original_aspect_ratio=decrease',pad='width=ceil(iw/2)*2:height=ceil(ih/2)*2'`,
	];
}

/**
 * Transcode a video using FFmpeg.
 *
 * @param file      Original video file object.
 * @param mimeType  Mime type.
 * @param threshold Big video size threshold.
 * @return Processed video file object.
 */
export async function transcodeVideo(
	file: File,
	mimeType: string,
	threshold: number
) {
	const outputFileName = `${ getFileBasename(
		file.name
	) }.${ getExtensionFromMimeType( mimeType ) }`;
	return runFFmpegWithConfig(
		file,
		[
			// Input filename.
			'-i',
			file.name,
			// Set desired video codec.
			'-codec:v',
			VIDEO_CODEC[ mimeType ] || 'libx264',
			...getScaleArg( threshold ),
			...FFMPEG_CONFIG.FPS,
			...FFMPEG_CONFIG.FASTSTART,
			...FFMPEG_CONFIG.COLOR_PROFILE,
			...FFMPEG_CONFIG.PRESET,
		],
		mimeType,
		outputFileName
	);
}

/**
 * Mutes a video using FFmpeg while retaining the file type.
 *
 * @param file Original video file object.
 * @return Processed video file object.
 */
export async function muteVideo( file: File ) {
	return runFFmpegWithConfig(
		file,
		[
			// Input filename.
			'-i',
			file.name,
			'copy',
			// Ensure there is no audio.
			'-an',
		],
		file.type,
		file.name
	);
}

/**
 * Transcodes an audio file using FFmpeg.
 *
 * @param file     Original audio file object.
 * @param mimeType Desired mime type.
 * @return Processed audio file object.
 */
export async function transcodeAudio( file: File, mimeType: string ) {
	const outputFileName = `${ getFileBasename(
		file.name
	) }.${ getExtensionFromMimeType( mimeType ) }`;
	return runFFmpegWithConfig(
		file,
		[
			// Input filename.
			'-i',
			file.name,
			// Ensure there is no video.
			'-vn',
			// Set desired audio codec.
			'-codec:a',
			AUDIO_CODEC[ mimeType ] || 'libmp3lame',
		],
		mimeType,
		outputFileName
	);
}

/**
 * Extracts a video's first frame using FFmpeg.
 *
 * Note: Exact seeking is not possible in most formats.
 *
 * @todo Remove? Currently unused.
 *
 * @param file      Original video file object.
 * @param threshold Big video size threshold.
 * @return File object for the video frame.
 */
export async function getFirstFrameOfVideo( file: File, threshold: number ) {
	const outputFileName = `${ getFileBasename( file.name ) }-poster.jpeg`;
	return runFFmpegWithConfig(
		file,
		[
			...FFMPEG_CONFIG.SEEK_TO_START,
			// Input filename.
			'-i',
			file.name,
			...FFMPEG_CONFIG.SINGLE_FRAME,
			...getScaleArg( threshold ),
			...FFMPEG_CONFIG.COLOR_PROFILE,
			...FFMPEG_CONFIG.PRESET,
		],
		'image/jpeg',
		outputFileName
	);
}

/**
 * Converts an animated GIF to a video using FFmpeg.
 *
 * @param file      Original GIF file object.
 * @param mimeType  Desired mime type.
 * @param threshold Big video size threshold.
 * @return Converted video file object.
 */
export async function convertGifToVideo(
	file: File,
	mimeType: string,
	threshold: number
) {
	return transcodeVideo( file, mimeType, threshold );
}
