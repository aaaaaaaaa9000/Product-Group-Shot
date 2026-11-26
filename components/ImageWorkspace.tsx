import React from 'react';
import { ImageFile } from '../types';
import ResultDisplay from './ResultDisplay';

interface ImageWorkspaceProps {
  productImages: ImageFile[];
  onProductImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onProductImageRemove: (index: number) => void;
  generatedImages: ImageFile[];
  onUpdateGeneratedImage: (index: number, newImage: ImageFile) => void;
  isLoading: boolean;
}

const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
);

const RemoveIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);


const ImageWorkspace: React.FC<ImageWorkspaceProps> = ({ productImages, onProductImageUpload, onProductImageRemove, generatedImages, onUpdateGeneratedImage, isLoading }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-gray-300 text-center">1. Upload Product Images</h3>
        <div className="w-full p-4 glass-card rounded-xl min-h-[200px]">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {productImages.map((image, index) => (
                    <div key={index} className="relative group aspect-square">
                        <img 
                            src={`data:${image.mimeType};base64,${image.base64}`} 
                            alt={image.name} 
                            className="w-full h-full object-contain rounded-lg bg-black/20" 
                        />
                        <button 
                            onClick={() => onProductImageRemove(index)} 
                            className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                            aria-label="Remove image"
                        >
                            <RemoveIcon />
                        </button>
                    </div>
                ))}
                 <label htmlFor="product-uploader" className="cursor-pointer group aspect-square">
                    <div className="w-full h-full border-2 border-dashed border-white/10 rounded-lg text-center hover:border-fuchsia-400/80 transition-all duration-300 bg-black/10 flex flex-col justify-center items-center">
                        <UploadIcon />
                        <p className="mt-2 text-xs text-gray-400 group-hover:text-white transition-colors">Add Image(s)</p>
                    </div>
                </label>
                <input id="product-uploader" type="file" multiple className="hidden" accept="image/*" onChange={onProductImageUpload} />
            </div>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-gray-300 text-center">2. Generated Results</h3>
        <ResultDisplay 
            imageFiles={generatedImages}
            isLoading={isLoading}
            expectedCount={productImages.length}
            onUpdateGeneratedImage={onUpdateGeneratedImage}
        />
      </div>
    </div>
  );
};

export default ImageWorkspace;