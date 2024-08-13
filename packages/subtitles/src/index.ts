/**
 * External dependencies
 */
import { VttComment, VttCue, WebVtt } from '@audapolis/webvtt-writer';
import { createModel } from 'vosk-browser';
import type { ServerMessageResult } from 'vosk-browser/dist/interfaces';

type Result = ServerMessageResult[ 'result' ][ 'result' ][ 0 ];

// TODO: Load them from CDN supporting CORS.
const models: Array< { name: string; url: string } > = [
	{
		name: 'Catalan',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-ca-0.4.tar.gz',
	},
	{
		name: 'Chinese',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-cn-0.3.tar.gz',
	},
	{
		name: 'Deutsch',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-de-0.15.tar.gz',
	},
	{
		name: 'Indian English',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-en-in-0.4.tar.gz',
	},
	{
		name: 'English',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-en-us-0.15.tar.gz',
	},
	{
		name: 'Español',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-es-0.3.tar.gz',
	},
	{
		name: 'Farsi',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-fa-0.4.tar.gz',
	},
	{
		name: 'French',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-fr-pguyot-0.3.tar.gz',
	},
	{
		name: 'Italiano',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-it-0.4.tar.gz',
	},
	{
		name: 'Malayalam',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-malayalam-bigram.tar.gz',
	},
	{
		name: 'Portuguese',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-pt-0.3.tar.gz',
	},
	{
		name: 'Russian',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-ru-0.4.tar.gz',
	},
	{
		name: 'Turkish',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-tr-0.3.tar.gz',
	},
	{
		name: 'Vietnamese',
		url: 'https://raw.githubusercontent.com/swissspidy/media-experiments/main/vosk/models/vosk-model-small-vn-0.3.tar.gz',
	},
];

function createWebVttFromResults( results: Result[] ) {
	const vtt = new WebVtt( 'Auto-generated captions' );
	vtt.add(
		new VttComment(
			'This file has been automatically generated by the Media Experiments project'
		)
	);

	// TODO: Make it nicer with multiple words per line.
	for ( const result of results ) {
		vtt.add(
			new VttCue( {
				startTime: result.start,
				endTime: result.end,
				payload: result.word,
			} )
		);
	}

	return vtt.toString();
}

/**
 * Generates subtitles for a given video file.
 *
 * @param file     Video file.
 * @param basename Video file name without extension.
 * @return VTT file.
 */
export async function generateSubtitles(
	file: File,
	basename: string
): Promise< File > {
	const results: Result[] = [];

	const arrayBuffer = await file.arrayBuffer();
	const audioContext = new AudioContext();
	const audioBuffer = await audioContext.decodeAudioData( arrayBuffer );

	// TODO: Terminate previous model upon changing it.
	// TODO: Make customizable based on language in the video.
	const model = await createModel( models[ 4 ].url );

	const recognizer = new model.KaldiRecognizer( 48000 );
	recognizer.setWords( true );

	return new Promise< File >( ( resolve, reject ) => {
		try {
			recognizer.acceptWaveform( audioBuffer );

			recognizer.on( 'result', ( message: unknown ) => {
				if ( ( message as ServerMessageResult ).result.result ) {
					results.push(
						...( message as ServerMessageResult ).result.result
					);
				}

				// TODO: Reject if `results` is empty.

				const vtt = createWebVttFromResults( results );

				const vttFile = new File(
					[ vtt ],
					`${ basename }-captions.vtt`,
					{
						lastModified: 1234567891,
						type: 'text/vtt',
					}
				);

				resolve( vttFile );
			} );

			// Force recognizer to emit result event.
			// See https://github.com/ccoreilly/vosk-browser/issues/54
			recognizer.on( 'partialresult', () => {
				recognizer.retrieveFinalResult();
			} );
		} catch ( error ) {
			reject( error );
		}
	} );
}
