import React, { useState, useRef, useEffect } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2, Move } from "lucide-react";

interface ImageZoomModalProps {
  imageUrl: string | null;
  imageLabel?: string;
  title?: string;
  onClose: () => void;
}

export default function ImageZoomModal({
  imageUrl,
  imageLabel,
  title = "Question Image Diagram",
  onClose,
}: ImageZoomModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!imageUrl) return null;

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 4));
  };

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(prev - 0.5, 1);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scale <= 1 || e.touches.length !== 1) return;
    setIsDragging(true);
    const touch = e.touches[0];
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || scale <= 1 || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-2 sm:p-4 select-none animate-fadeIn">
      {/* Modal Card */}
      <div className="relative w-full max-w-4xl h-[88vh] sm:h-[90vh] bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-4 py-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between text-white shrink-0 z-10">
          <div className="min-w-0 flex-1 pr-2">
            <div className="flex items-center gap-2">
              <Maximize2 className="w-4 h-4 text-blue-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                {imageLabel ? `Diagram: ${imageLabel}` : title}
              </h3>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Click & drag to move when zoomed. Pinch or use controls below.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-all cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Interactive Image Viewport */}
        <div
          ref={containerRef}
          className={`flex-1 relative overflow-hidden flex items-center justify-center p-4 bg-slate-950 ${
            scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <img
            src={imageUrl}
            alt={imageLabel || "Full Question Image"}
            draggable={false}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.15s ease-out",
            }}
            className="max-h-full max-w-full object-contain rounded-lg shadow-xl"
          />
        </div>

        {/* Toolbar & Controls Footer */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3 text-white shrink-0 z-10">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-400">
            {scale > 1 && (
              <span className="flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded text-[11px] text-blue-400">
                <Move className="w-3 h-3" /> Draggable
              </span>
            )}
            <span className="px-2 py-0.5 bg-slate-800 rounded text-[11px]">
              {Math.round(scale * 100)}%
            </span>
          </div>

          {/* Action Control Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={scale <= 1}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 text-slate-200"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
              <span className="hidden sm:inline">Zoom Out</span>
            </button>

            <button
              type="button"
              onClick={handleZoomIn}
              disabled={scale >= 4}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 text-slate-200"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
              <span className="hidden sm:inline">Zoom In</span>
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={scale === 1 && position.x === 0 && position.y === 0}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 text-white shadow-xs"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
