// ImageCapture polyfill for Safari and Firefox.
// See https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Image_Capture_API
// See https://github.com/GoogleChromeLabs/imagecapture-polyfill
import { ImageCapture } from 'image-capture';

import { store as blockEditorStore } from '@wordpress/block-editor';
import { createBlobURL, revokeBlobURL } from '@wordpress/blob';
import { dateI18n } from '@wordpress/date';
import type { WPDataRegistry } from '@wordpress/data/build-types/registry';

import { getExtensionFromMimeType, blobToFile } from '@mexp/media-utils';

import { getMediaTypeFromBlockName } from '../../utils';
import {
	COUNTDOWN_TIME_IN_SECONDS,
	MAX_RECORDING_DURATION_IN_SECONDS,
} from '../constants';
import { Type, type VideoEffect } from './types';

type AllSelectors = typeof import('./selectors');
type CurriedState< F > = F extends ( state: any, ...args: infer P ) => infer R
	? ( ...args: P ) => R
	: F;
type Selectors = {
	[ key in keyof AllSelectors ]: CurriedState< AllSelectors[ key ] >;
};

type ActionCreators = {
	invalidateResolutionForStoreSelector: ( selector: keyof Selectors ) => void;
	setVideoEffect: typeof setVideoEffect;
	setGifMode: typeof setGifMode;
	setHasAudio: typeof setHasAudio;
	stopRecording: typeof stopRecording;
	countDuration: typeof countDuration;
	( args: Record< string, unknown > ): void;
};

export function setVideoInput( deviceId: string ) {
	return {
		type: Type.ChangeVideoInput,
		deviceId,
	};
}

export function setAudioInput( deviceId: string ) {
	return {
		type: Type.ChangeAudioInput,
		deviceId,
	};
}

export function setVideoEffect( videoEffect: VideoEffect ) {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		dispatch( {
			type: Type.ChangeVideoEffect,
			videoEffect,
		} );

		dispatch.invalidateResolutionForStoreSelector( 'getMediaStream' );
	};
}

export function toggleBlurEffect() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const value = select.getVideoEffect();
		dispatch.setVideoEffect( value === 'none' ? 'blur' : 'none' );
	};
}

export function setGifMode( value: boolean ) {
	return {
		type: Type.SetGifMode,
		value,
	};
}
export function toggleGifMode() {
	return {
		type: Type.ToggleGifMode,
	};
}

export function setHasAudio( value: boolean ) {
	return {
		type: Type.SetHasAudio,
		value,
	};
}

export function toggleHasAudio() {
	return {
		type: Type.ToggleHasAudio,
	};
}

export function resetVideoInput() {
	return {
		type: Type.ResetVideoInput,
	};
}

export function enterRecordingMode( clientId: string ) {
	return async ( {
		registry,
		dispatch,
	}: {
		dispatch: ActionCreators;
		registry: WPDataRegistry;
	} ) => {
		const { getBlockName } = registry.select( blockEditorStore );

		const blockName = getBlockName( clientId );
		const recordingType = getMediaTypeFromBlockName( blockName );

		dispatch( {
			type: Type.EnterRecordingMode,
			clientId,
			recordingType: recordingType || 'video',
		} );

		dispatch.invalidateResolutionForStoreSelector( 'getMediaStream' );
	};
}

export function leaveRecordingMode() {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		dispatch( {
			type: Type.LeaveRecordingMode,
		} );
	};
}

export function updateMediaDevices() {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			dispatch( {
				type: Type.SetMediaDevices,
				devices: devices
					.filter( ( device ) => device.kind !== 'audiooutput' )
					// Label is empty if permissions somehow changed meantime,
					// remove these devices from the list.
					.filter( ( device ) => device.label ),
			} );
		} catch ( err ) {
			// Do nothing for now.
		}
	};
}

export function countDuration() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		dispatch( {
			type: Type.SetDuration,
			value: 0,
		} );

		const timer = setInterval( () => {
			if ( 'recording' !== select.getRecordingStatus() ) {
				clearInterval( timer );
				return;
			}

			dispatch( {
				type: Type.DurationTick,
			} );

			const duration = select.getDuration();
			if ( duration >= MAX_RECORDING_DURATION_IN_SECONDS ) {
				clearInterval( timer );

				dispatch.stopRecording();
			}
		}, 1000 );
	};
}

export function retryRecording() {
	return async ( { dispatch }: { dispatch: ActionCreators } ) => {
		// retry means getting a new stream (if missing)
		// and resetting any state (countdown, duration, files, etc.) if set

		dispatch( {
			type: Type.ResetState,
		} );
		dispatch.invalidateResolutionForStoreSelector( 'getMediaStream' );
	};
}

export function startRecording() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		// TODO: Only do this once there is a stream and we're in "ready" state.
		dispatch( {
			type: Type.SetCountdown,
			value: COUNTDOWN_TIME_IN_SECONDS,
		} );

		const timer = setInterval( () => {
			dispatch( {
				type: Type.CountdownTick,
			} );

			const countdown = select.getCountdown();
			if ( countdown === 0 ) {
				clearInterval( timer );

				dispatch.countDuration();

				const mediaStream = select.getMediaStream();

				// mediaStream can be undefined if resolution hasn't finished yet.
				// TODO: Throw error?
				if ( ! mediaStream ) {
					return;
				}

				const mediaRecorder = new MediaRecorder( mediaStream );

				const track = mediaStream.getVideoTracks()[ 0 ];
				const { width, height } = track.getSettings();

				mediaRecorder.addEventListener( 'dataavailable', ( evt ) => {
					if ( evt.data.size ) {
						dispatch( {
							type: Type.AddMediaChunk,
							chunk: evt.data,
						} );
					}
				} );

				mediaRecorder.addEventListener( 'stop', () => {
					const mediaChunks = select.getMediaChunks();
					const hasVideo = select.hasVideo();
					const previousUrl = select.getUrl();
					const previousUrlOriginalUrl = select.getOriginalUrl();

					if ( mediaChunks.length ) {
						const { type } = mediaChunks[ 0 ];

						const blob = new Blob( mediaChunks, { type } );
						const file = hasVideo
							? blobToFile(
									blob,
									`capture-${ dateI18n(
										'Y-m-d-H-i',
										new Date(),
										undefined
									) }.mp4`,
									'video/mp4'
							  )
							: blobToFile(
									blob,
									`capture-${ dateI18n(
										'Y-m-d-H-i',
										new Date(),
										undefined
									) }.mp3`,
									'audio/mp3'
							  );

						const url = createBlobURL( file );

						dispatch( {
							type: Type.FinishRecording,
							file,
							url,
							width,
							height,
						} );

						if ( previousUrl ) {
							revokeBlobURL( previousUrl );
						}
						if ( previousUrlOriginalUrl ) {
							revokeBlobURL( previousUrlOriginalUrl );
						}
					}
				} );

				mediaRecorder.addEventListener(
					'error',
					// @ts-ignore -- TODO: Fix type declaration.

					( evt: MediaRecorderErrorEvent ) => {
						dispatch( {
							type: Type.SetError,
							error: evt.error,
						} );
					}
				);

				try {
					mediaRecorder.start();
					dispatch( {
						type: Type.StartRecording,
						mediaRecorder,
					} );
				} catch ( error ) {
					dispatch( {
						type: Type.SetError,
						error,
					} );
				}
			}
		}, 1000 );
	};
}

export function stopRecording() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const mediaRecorder = select.getMediaRecorder();

		if ( mediaRecorder ) {
			mediaRecorder.stop();
		}

		dispatch( {
			type: Type.StopRecording,
		} );
	};
}

export function pauseRecording() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const mediaRecorder = select.getMediaRecorder();

		if ( mediaRecorder ) {
			mediaRecorder.pause();
		}

		dispatch( {
			type: Type.PauseRecording,
		} );
	};
}

// TODO: Deduplicate setInterval logic with startRecording.
export function resumeRecording() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		const mediaRecorder = select.getMediaRecorder();

		if ( mediaRecorder ) {
			mediaRecorder.resume();
		}

		dispatch( {
			type: Type.ResumeRecording,
		} );

		const timer = setInterval( () => {
			if ( 'recording' !== select.getRecordingStatus() ) {
				clearInterval( timer );
				return;
			}

			dispatch( {
				type: Type.DurationTick,
			} );

			const duration = select.getDuration();
			if ( duration >= MAX_RECORDING_DURATION_IN_SECONDS ) {
				clearInterval( timer );

				dispatch.stopRecording();
			}
		}, 1000 );
	};
}

// TODO: Deduplicate setInterval logic with startRecording.
export function captureImage() {
	return async ( {
		select,
		dispatch,
	}: {
		select: Selectors;
		dispatch: ActionCreators;
	} ) => {
		// TODO: Only do this once there is a stream and we're in "ready" state.
		dispatch( {
			type: Type.SetCountdown,
			value: COUNTDOWN_TIME_IN_SECONDS,
		} );

		const timer = setInterval( async () => {
			dispatch( {
				type: Type.CountdownTick,
			} );

			const countdown = select.getCountdown();
			if ( countdown === 0 ) {
				clearInterval( timer );

				const mediaStream = select.getMediaStream();

				// mediaStream can be undefined if resolution hasn't finished yet.
				// TODO: Throw error?
				if ( ! mediaStream ) {
					return;
				}

				const track = mediaStream.getVideoTracks()[ 0 ];
				const captureDevice = new ImageCapture( track );

				const { width, height } = track.getSettings();

				dispatch( {
					type: Type.StartCapturing,
				} );

				try {
					const blob = await captureDevice.takePhoto();

					const { type } = blob;
					const ext = getExtensionFromMimeType( type );

					const file = blobToFile(
						blob,
						`capture-${ dateI18n(
							'Y-m-d-H-i',
							new Date(),
							undefined
						) }.${ ext }`,
						type
					);
					const url = createBlobURL( file );

					dispatch( {
						type: Type.FinishRecording,
						file,
						url,
						width,
						height,
					} );
				} catch ( error ) {
					dispatch( {
						type: Type.SetError,
						error,
					} );
				}
			}
		}, 1000 );
	};
}
