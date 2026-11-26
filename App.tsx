import React, { useState, useEffect, useCallback } from 'react';
import { CustomizationOptions, ImageFile } from './types';
import { generateImage, analyzeStyleImage } from './services/geminiService';
import CustomizationPanel from './components/CustomizationPanel';
import ImageWorkspace from './components/ImageWorkspace';
import PromptEditor from './components/PromptEditor';
import { LIGHTING_STYLES, CAMERA_PERSPECTIVES } from './constants';

// Helper function to convert any browser-supported image to a JPEG ImageFile
const convertAndPrepareImage = (file: File): Promise<ImageFile> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event: ProgressEvent<FileReader>) => {
      if (!event.target?.result) {
        return reject(new Error('FileReader did not return a result.'));
      }
      const imageSrc = event.target.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Failed to get canvas context.'));
        }
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Convert to JPEG format, which is widely supported.
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const newFileName = file.name.substring(0, file.name.lastIndexOf('.') || file.name.length) + '.jpeg';

        resolve({
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg',
          name: newFileName,
        });
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
      img.src = imageSrc;
    };

    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
};


function App() {
  const [productImages, setProductImages] = useState<ImageFile[]>([]);
  const [styleImage, setStyleImage] = useState<ImageFile | null>(null);
  const [generatedImages, setGeneratedImages] = useState<ImageFile[]>([]);
  
  const [styleDescription, setStyleDescription] = useState<string | null>(null);
  const [isAnalyzingStyle, setIsAnalyzingStyle] = useState<boolean>(false);

  const [options, setOptions] = useState<CustomizationOptions>({
    lightingStyle: LIGHTING_STYLES[0].value,
    cameraPerspective: CAMERA_PERSPECTIVES[0].value,
  });

  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (styleImage) {
      const getStyleDescription = async () => {
        setIsAnalyzingStyle(true);
        setError(null);
        try {
          const description = await analyzeStyleImage(styleImage);
          setStyleDescription(description);
        } catch (err) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Could not analyze the style image.");
          setStyleDescription(null);
        } finally {
          setIsAnalyzingStyle(false);
        }
      };
      getStyleDescription();
    } else {
      setStyleDescription(null);
    }
  }, [styleImage]);


  useEffect(() => {
    const generateNewPrompt = () => {
      if (productImages.length === 0) {
        setPrompt('');
        return;
      }
      let newPrompt = `Generate a high-resolution, professional product photograph of the subject in the provided image.

Key requirements:
- Lighting: Illuminate the scene with a ${options.lightingStyle} style. The lighting should be flattering and highlight the product's details.
- Camera Perspective: Capture the product from a ${options.cameraPerspective}.
- Background: The background should be clean, non-distracting, and complementary to the product. A subtle, high-end studio setting is preferred.
- Overall Mood: The image should feel premium, clean, and aspirational.`;

      if (styleImage) {
        if (isAnalyzingStyle) {
            newPrompt += `\n\n- Style Reference: Analyzing the provided style reference image...`;
        } else if (styleDescription) {
            newPrompt += `\n\n- Style Reference: Strictly adhere to the aesthetic of the provided style reference image, which has a ${styleDescription}. The goal is to make the product look as if it belongs in the same visual world.`;
        } else {
             newPrompt += `\n\n- Style Reference: Strictly adhere to the aesthetic, color palette, texture, and overall mood of the provided style reference image. The goal is to make the product look as if it belongs in the same visual world as the style reference.`;
        }
      }

      setPrompt(newPrompt);
    };
    generateNewPrompt();
  }, [options, productImages, styleImage, styleDescription, isAnalyzingStyle]);
  
  const handleGenerate = useCallback(async () => {
    if (productImages.length === 0 || !prompt) {
      setError('Please upload at least one product image and ensure the prompt is not empty.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setGeneratedImages([]);

    try {
      const generationPromises = productImages.map(image =>
        generateImage(image, prompt, styleImage)
      );
      const results = await Promise.all(generationPromises);
      setGeneratedImages(results);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred during image generation.');
    } finally {
      setIsLoading(false);
    }
  }, [productImages, prompt, styleImage]);

  const handleProductImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      // FIX: The original `Array.from(files)` was causing a TypeScript error where
      // the `file` argument in `.map()` was being inferred as `unknown`.
      // Using the spread syntax `[...files]` correctly creates an array of `File` objects from the `FileList`.
      const conversionPromises = [...files].map(file => convertAndPrepareImage(file));

      Promise.all(conversionPromises)
        .then(newImages => {
          setProductImages(prev => [...prev, ...newImages]);
        })
        .catch(err => {
          console.error('Image conversion error:', err);
          setError(err instanceof Error ? err.message : 'Failed to process one or more images. Please use standard formats like JPEG, PNG, or WEBP.');
        });
    }
     // Clear the input value to allow re-uploading the same file(s)
    event.target.value = '';
  };

  const handleRemoveProductImage = (indexToRemove: number) => {
    setProductImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };


  const handleSingleFileChange = (setter: React.Dispatch<React.SetStateAction<ImageFile | null>>) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
       convertAndPrepareImage(file)
        .then(imageFile => {
          setter(imageFile);
        })
        .catch(err => {
            console.error('Image conversion error:', err);
            setError(err instanceof Error ? err.message : 'Failed to process image. Please use standard formats like JPEG, PNG, or WEBP.');
            setter(null);
        });
    }
    // Clear the input value to allow re-uploading the same file
    event.target.value = '';
  };

  const handleUpdateGeneratedImage = (indexToUpdate: number, newImage: ImageFile) => {
    setGeneratedImages(prevImages => 
        prevImages.map((image, index) => 
            index === indexToUpdate ? newImage : image
        )
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <header className="w-full max-w-7xl mb-8 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-500 pb-2">
          Manav's Product Studio
        </h1>
        <p className="text-gray-400 mt-2">Transform your product photos with the power of Gemini.</p>
      </header>

      <div className="w-full max-w-7xl mb-8">
          <button 
              onClick={handleGenerate}
              disabled={isLoading || productImages.length === 0 || isAnalyzingStyle}
              className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-600 hover:from-cyan-600 hover:to-fuchsia-700 text-white font-bold py-3 px-4 rounded-lg text-lg transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-2xl hover:shadow-fuchsia-500/20 disabled:shadow-none transform hover:-translate-y-1 disabled:transform-none"
          >
              {isAnalyzingStyle ? 'Analyzing Style...' : isLoading ? 'Generating...' : 'Generate Images'}
          </button>
      </div>
      
      <main className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
            <ImageWorkspace 
                productImages={productImages} 
                onProductImageUpload={handleProductImageUpload}
                onProductImageRemove={handleRemoveProductImage}
                generatedImages={generatedImages}
                onUpdateGeneratedImage={handleUpdateGeneratedImage}
                isLoading={isLoading}
            />
        </div>

        <div className="lg:col-span-1 flex flex-col gap-8">
            <CustomizationPanel 
                options={options}
                setOptions={setOptions}
                styleImage={styleImage}
                onStyleImageUpload={handleSingleFileChange(setStyleImage)}
                isAnalyzingStyle={isAnalyzingStyle}
            />
            <PromptEditor 
                prompt={prompt}
                setPrompt={setPrompt}
            />
            {error && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg" role="alert">{error}</div>}
        </div>
      </main>
    </div>
  );
}

export default App;