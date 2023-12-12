import { ImageSizeCrop } from '../store/types';

declare global {
	interface Window {
		mediaExperiments: {
			availableImageSizes: Record< string, ImageSizeCrop >;
			bigImageSizeThreshold: number;
			allowedMimeTypes?: Record< string, string > | null;
		};
	}
}

export {};
