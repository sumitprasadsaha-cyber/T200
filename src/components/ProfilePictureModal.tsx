import React, { useRef, useState } from "react";
import { Image as ImageIcon, X, Check, Trash2, Move, ZoomIn } from "lucide-react";

interface ProfilePictureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPhoto: (dataUrl: string) => void;
  onRemovePhoto?: () => void;
  existingPhoto?: string | null;
}

export default function ProfilePictureModal({
  isOpen,
  onClose,
  onSelectPhoto,
  onRemovePhoto,
  existingPhoto
}: ProfilePictureModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialDistance, setInitialDistance] = useState<number | null>(null);
  const [initialZoom, setInitialZoom] = useState<number>(1.0);

  if (!isOpen) return null;

  // Handle local file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          setImageSrc(reader.result);
          setZoom(1.0);
          setOffset({ x: 0, y: 0 });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!imageSrc) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !imageSrc) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!imageSrc) return;
    if (e.touches.length === 2) {
      // Pinch to zoom start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      setInitialDistance(dist);
      setInitialZoom(zoom);
      setIsDragging(false);
    } else if (e.touches.length === 1) {
      // Drag start
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
      setInitialDistance(null);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!imageSrc) return;
    if (e.touches.length === 2 && initialDistance !== null) {
      // Pinch to zoom active
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / initialDistance;
      const nextZoom = initialZoom * factor;
      setZoom(Math.min(Math.max(nextZoom, 0.5), 3.5));
    } else if (e.touches.length === 1 && isDragging) {
      // Drag active
      const touch = e.touches[0];
      setOffset({
        x: touch.clientX - dragStart.x,
        y: touch.clientY - dragStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setInitialDistance(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!imageSrc) return;
    e.preventDefault();
    const nextZoom = zoom - e.deltaY * 0.0015;
    setZoom(Math.min(Math.max(nextZoom, 0.5), 3.5));
  };

  const handleSaveCroppedImage = () => {
    if (!imageSrc) return;
    const img = new window.Image();
    img.src = imageSrc;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const size = 300;
      canvas.width = size;
      canvas.height = size;

      ctx.clearRect(0, 0, size, size);
      
      // Center and translate with drag offset mapped to canvas coordinate system
      const scaleFactor = size / 192; // Preview container is w-48 (192px)
      ctx.translate(size / 2 + offset.x * scaleFactor, size / 2 + offset.y * scaleFactor);
      ctx.scale(zoom, zoom);

      const imgWidth = img.width;
      const imgHeight = img.height;
      const minDimension = Math.min(imgWidth, imgHeight);
      
      const sWidth = minDimension;
      const sHeight = minDimension;
      const sx = (imgWidth - sWidth) / 2;
      const sy = (imgHeight - sHeight) / 2;

      ctx.drawImage(
        img,
        sx, sy, sWidth, sHeight,
        -size / 2, -size / 2, size, size
      );

      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      onSelectPhoto(croppedDataUrl);
      setImageSrc(null);
      setZoom(1.0);
      setOffset({ x: 0, y: 0 });
      onClose();
    };
  };

  const handleCancelEdit = () => {
    setImageSrc(null);
    setZoom(1.0);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center p-0 backdrop-blur-xs" id="profile-picture-modal">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl animate-slideUp z-10 flex flex-col gap-4 border border-slate-100 dark:border-slate-800 m-0 sm:m-4">
        <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 rounded-full self-center sm:hidden mb-1" />

        <div className="flex justify-between items-center pb-1 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100">
            {imageSrc ? "Align & Zoom Photo" : "Update Student Photo"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
          id="profile-picture-file-input"
        />

        {!imageSrc ? (
          /* Select Image Step */
          <div className="flex flex-col gap-3 py-2">
            <button
              onClick={triggerFileSelect}
              className="w-full py-8 px-5 border-2 border-dashed border-blue-200 dark:border-blue-900/50 hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 rounded-2xl flex flex-col items-center justify-center gap-3 font-bold text-slate-700 dark:text-slate-300 transition-all duration-200 cursor-pointer group"
            >
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-full group-hover:scale-110 transition-transform">
                <ImageIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex flex-col items-center text-center">
                <span className="text-xs font-black text-slate-800 dark:text-slate-100">Select Image from Device</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Supports PNG, JPG, JPEG</span>
              </div>
            </button>
            {existingPhoto && onRemovePhoto ? (
              <button
                type="button"
                onClick={() => {
                  onRemovePhoto();
                  onClose();
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black uppercase text-rose-600 transition-all cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove current photo
              </button>
            ) : null}
          </div>
        ) : (
          /* Drag to Align, Wheel to Zoom step */
          <div className="flex flex-col gap-4 py-2">
            {/* Live Cropper Viewport */}
            <div 
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUpOrLeave}
              onMouseLeave={handleMouseUpOrLeave}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onWheel={handleWheel}
              className="relative w-48 h-48 mx-auto rounded-[24px] overflow-hidden border-2 border-blue-500/50 shadow-inner bg-slate-50 dark:bg-slate-950 flex items-center justify-center cursor-move group select-none touch-none"
              title="Drag image to align. Scroll to zoom."
            >
              <div 
                className="w-full h-full flex items-center justify-center"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                }}
              >
                <img 
                  src={imageSrc} 
                  alt="Preview" 
                  className="w-full h-full object-cover rounded-[24px] pointer-events-none"
                />
              </div>
              
              {/* Overlay Guidance Indicators */}
              <div className="absolute inset-0 border-4 border-white/60 dark:border-slate-900/60 rounded-[24px] pointer-events-none" />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/60 text-white text-[9px] font-black rounded-full uppercase flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-all pointer-events-none">
                <Move className="w-2.5 h-2.5" />
                <span>Drag to Align</span>
              </div>
            </div>

            {/* In-Image Direct Zoom Control Slider */}
            <div className="flex items-center gap-3 px-1 mt-1 justify-center">
              <ZoomIn className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.02"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1 accent-blue-600 h-1 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
                title="Adjust photo size"
              />
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 w-8 text-right">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            {/* Actions Footer */}
            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 dark:border-slate-800 mt-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3.5 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCroppedImage}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-blue-500/10 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Save</span>
              </button>
            </div>
          </div>
        )}

        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-center leading-relaxed mt-1">
          {imageSrc 
            ? "Drag image directly to center it. Scroll or use the slider to adjust zoom size." 
            : "Upload a photo to center, zoom, and crop it to fit your profile circle."}
        </p>
      </div>
    </div>
  );
}
