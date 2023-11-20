import {
	type UnknownAction,
	type AddAction,
	type AddPosterAction,
	type ApproveUploadAction,
	type CancelAction,
	ItemStatus,
	type PrepareAction,
	type RemoveAction,
	type RequestApprovalAction,
	type SetMediaSourceTermsAction,
	type State,
	type TranscodingFinishAction,
	type TranscodingPrepareAction,
	type TranscodingStartAction,
	Type,
	type UploadFinishAction,
	type SideloadFinishAction,
	type UploadStartAction,
	type SetImageSizesAction,
} from './types';

const DEFAULT_STATE: State = {
	queue: [],
	mediaSourceTerms: {},
	imageSizes: {},
};

type Action =
	| UnknownAction
	| AddAction
	| PrepareAction
	| TranscodingPrepareAction
	| TranscodingStartAction
	| TranscodingFinishAction
	| UploadStartAction
	| UploadFinishAction
	| SideloadFinishAction
	| CancelAction
	| RemoveAction
	| AddPosterAction
	| SetMediaSourceTermsAction
	| SetImageSizesAction
	| RequestApprovalAction
	| ApproveUploadAction;

function reducer( state = DEFAULT_STATE, action: Action ) {
	switch ( action.type ) {
		case Type.Add:
			return {
				...state,
				queue: [ ...state.queue, action.item ],
			};
		case Type.Prepare:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Preparing,
						  }
						: item
				),
			};

		case Type.TranscodingPrepare:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.PendingTranscoding,
								transcode: action.transcode,
						  }
						: item
				),
			};

		case Type.TranscodingStart:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Transcoding,
						  }
						: item
				),
			};

		case Type.TranscodingFinish:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Transcoded,
								file: action.file,
								attachment: {
									...item.attachment,
									url: action.url,
									mimeType: action.file.type,
								},
						  }
						: item
				),
			};

		case Type.Cancel:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Cancelled,
								error: action.error,
						  }
						: item
				),
			};

		case Type.UploadStart:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Uploading,
						  }
						: item
				),
			};

		case Type.UploadFinish:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Uploaded,
								attachment: {
									...item.attachment,
									...action.attachment,
								},
								blurHash: action.attachment.blurHash,
								dominantColor: action.attachment.dominantColor,
						  }
						: item
				),
			};

		case Type.SideloadFinish:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Uploaded,
						  }
						: item
				),
			};

		case Type.AddPoster:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								poster: action.file,
								attachment: {
									...item.attachment,
									poster: action.url,
								},
						  }
						: item
				),
			};

		case Type.Remove:
			return {
				...state,
				queue: state.queue.filter( ( item ) => item.id !== action.id ),
			};

		case Type.RequestApproval:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.PendingApproval,
								file: action.file,
								attachment: {
									...item.attachment,
									url: action.url,
									mimeType: action.file.type,
								},
						  }
						: item
				),
			};

		case Type.ApproveUpload:
			return {
				...state,
				queue: state.queue.map( ( item ) =>
					item.id === action.id
						? {
								...item,
								status: ItemStatus.Approved,
						  }
						: item
				),
			};

		case Type.SetMediaSourceTerms: {
			return {
				...state,
				mediaSourceTerms: action.terms,
			};
		}

		case Type.SetImageSizes: {
			return {
				...state,
				imageSizes: action.imageSizes,
			};
		}
	}

	return state;
}

export default reducer;
