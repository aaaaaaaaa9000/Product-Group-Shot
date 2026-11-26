import React, { useState } from 'react';
import { ImageFile } from '../types';
import JSZip from 'jszip';
import { applyBackgroundBlur } from '../services/geminiService';

interface ResultDisplayProps {
  imageFiles: ImageFile[];
  isLoading: boolean;
  expectedCount: number;
  onUpdateGeneratedImage: (index: number, newImage: ImageFile) => void;
}

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);

const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
        <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
    </svg>
);

const LoadingSpinner = () => (
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-fuchsia-500"></div>
);

const ResultDisplay: React.FC<ResultDisplayProps> = ({ imageFiles, isLoading, expectedCount, onUpdateGeneratedImage }) => {
    const [isDownloading, setIsDownloading] = useState<Record<string, boolean>>({});
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [downloadAllResolution, setDownloadAllResolution] = useState<'2k' | '4k'>('2k');

    const [editingBlurIndex, setEditingBlurIndex] = useState<number | null>(null);
    const [blurIntensity, setBlurIntensity] = useState<number>(10);
    const [isApplyingBlur, setIsApplyingBlur] = useState<boolean>(false);
    const [blurError, setBlurError] = useState<string | null>(null);


    const handleDownload = (imageFile: ImageFile, resolution: '2k' | '4k', index: number) => {
        const downloadKey = `${index}-${resolution}`;
        setIsDownloading(prev => ({ ...prev, [downloadKey]: true }));
        
        const img = new Image();
        img.src = `data:${imageFile.mimeType};base64,${imageFile.base64}`;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                setIsDownloading(prev => ({ ...prev, [downloadKey]: false }));
                return;
            };

            const targetWidth = resolution === '4k' ? 4096 : 2048;
            const aspectRatio = img.width / img.height;
            
            canvas.width = targetWidth;
            canvas.height = targetWidth / aspectRatio;

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const link = document.createElement('a');
            link.download = `generated-${resolution}-${Date.now()}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setIsDownloading(prev => ({ ...prev, [downloadKey]: false }));
        }
        img.onerror = () => {
             setIsDownloading(prev => ({ ...prev, [downloadKey]: false }));
        }
    };

    const handleDownloadAll = async () => {
        if (imageFiles.length === 0) return;

        setIsDownloadingAll(true);

        const zip = new JSZip();
        const resolution = downloadAllResolution;

        const imagePromises = imageFiles.map((imageFile, index) => {
            return new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.src = `data:${imageFile.mimeType};base64,${imageFile.base64}`;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        return reject(new Error('Could not get canvas context'));
                    }

                    const targetWidth = resolution === '4k' ? 4096 : 2048;
                    const aspectRatio = img.width / img.height;
                    
                    canvas.width = targetWidth;
                    canvas.height = targetWidth / aspectRatio;

                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            zip.file(`generated-${resolution}-${index + 1}.jpg`, blob);
                            resolve();
                        } else {
                            reject(new Error('Canvas to Blob conversion failed'));
                        }
                    }, 'image/jpeg', 0.95);
                };
                img.onerror = () => {
                    reject(new Error('Image failed to load'));
                };
            });
        });

        try {
            await Promise.all(imagePromises);
            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.download = `product-studio-images-${resolution}.zip`;
            link.href = URL.createObjectURL(content);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (error) {
            console.error("Failed to create zip file", error);
        } finally {
            setIsDownloadingAll(false);
        }
    };

    const handleToggleBlurEditor = (index: number) => {
        if (editingBlurIndex === index) {
            setEditingBlurIndex(null);
            setBlurError(null);
        } else {
            setEditingBlurIndex(index);
            setBlurIntensity(10); // Reset to default
            setBlurError(null);
        }
    };

    const handleApplyBlur = async (index: number) => {
        setIsApplyingBlur(true);
        setBlurError(null);
        const sourceImage = imageFiles[index];

        try {
            const blurredImage = await applyBackgroundBlur(sourceImage, blurIntensity);
            onUpdateGeneratedImage(index, blurredImage);
            setEditingBlurIndex(null); // Close editor on success
        } catch (error) {
            console.error("Failed to apply blur", error);
            setBlurError(error instanceof Error ? error.message : "An unknown error occurred.");
        } finally {
            setIsApplyingBlur(false);
        }
    };

    const renderPlaceholder = () => (
        <div className="sm:col-span-full w-full aspect-[2/1] bg-black/10 rounded-xl flex items-center justify-center">
            <span className="text-gray-500">Your results will appear here</span>
        </div>
    );
    
    return (
        <div className="w-full p-4 glass-card rounded-xl min-h-[200px]">
            {imageFiles.length > 0 && !isLoading && (
                <div className="mb-4 flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-300 whitespace-nowrap">Download All as:</span>
                        <select 
                            value={downloadAllResolution} 
                            onChange={(e) => setDownloadAllResolution(e.target.value as '2k' | '4k')}
                            className="glass-input text-white rounded-md py-1.5 px-3 text-sm transition-all bg-gray-800/50"
                            disabled={isDownloadingAll}
                        >
                            <option value="2k" className="bg-gray-800">2K</option>
                            <option value="4k" className="bg-gray-800">4K</option>
                        </select>
                    </div>
                    <button
                        onClick={handleDownloadAll}
                        disabled={isDownloadingAll}
                        className="w-full sm:w-auto inline-flex items-center justify-center text-sm bg-fuchsia-600/80 hover:bg-fuchsia-600 border border-transparent text-white font-semibold py-2 px-4 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                        {isDownloadingAll ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Zipping...
                            </>
                        ) : (
                           "Download All"
                        )}
                    </button>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
                {isLoading && expectedCount > 0 && Array.from({ length: expectedCount }).map((_, index) => (
                    <div key={`loader-${index}`} className="w-full aspect-square bg-black/10 rounded-xl flex items-center justify-center">
                        <LoadingSpinner />
                    </div>
                ))}

                {!isLoading && imageFiles.length === 0 && renderPlaceholder()}
                
                {!isLoading && imageFiles.map((imageFile, index) => (
                    <div key={`result-${index}`} className="flex flex-col gap-2">
                        <div className="w-full aspect-square bg-black/10 rounded-xl overflow-hidden relative">
                             <img 
                                src={`data:${imageFile.mimeType};base64,${imageFile.base64}`} 
                                alt={`Generated Result ${index + 1}`}
                                className="object-contain w-full h-full"
                            />
                            {isApplyingBlur && editingBlurIndex === index && (
                                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center backdrop-blur-sm z-10 transition-opacity">
                                    <LoadingSpinner />
                                    <p className="text-white mt-2 text-sm">Applying blur...</p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => handleDownload(imageFile, '2k', index)}
                                disabled={isDownloading[`${index}-2k`]}
                                className="flex-1 inline-flex items-center justify-center text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50"
                            >
                                <DownloadIcon />
                                2K
                            </button>
                            <button 
                                onClick={() => handleDownload(imageFile, '4k', index)}
                                disabled={isDownloading[`${index}-4k`]}
                                className="flex-1 inline-flex items-center justify-center text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50"
                            >
                                <DownloadIcon />
                                4K
                            </button>
                        </div>
                         <button 
                            onClick={() => handleToggleBlurEditor(index)}
                            disabled={isApplyingBlur}
                            className="w-full inline-flex items-center justify-center text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50"
                         >
                            <EditIcon />
                            Blur Background
                         </button>
                        {editingBlurIndex === index && (
                             <div className="p-4 bg-black/20 rounded-lg flex flex-col gap-3 transition-all">
                                <label htmlFor={`blur-slider-${index}`} className="text-sm font-medium text-gray-300 flex justify-between">
                                    <span>Blur Intensity</span>
                                    <span className="text-gray-400">{blurIntensity}px</span>
                                </label>
                                <input
                                    id={`blur-slider-${index}`}
                                    type="range"
                                    min="2"
                                    max="50"
                                    step="1"
                                    value={blurIntensity}
                                    onChange={(e) => setBlurIntensity(Number(e.target.value))}
                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg accent-fuchsia-500"
                                />
                                {blurError && <p className="text-red-400 text-xs text-center">{blurError}</p>}
                                <div className="flex gap-2 mt-2">
                                    <button 
                                        onClick={() => setEditingBlurIndex(null)} 
                                        className="flex-1 text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2 px-3 rounded-md transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={() => handleApplyBlur(index)} 
                                        disabled={isApplyingBlur} 
                                        className="flex-1 text-sm bg-fuchsia-600/80 hover:bg-fuchsia-600 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait"
                                    >
                                        Apply
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ResultDisplay;