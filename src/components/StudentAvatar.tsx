import React, { useState, useEffect } from "react";
import { Student } from "../types";

export interface StudentAvatarProps {
  student?: Partial<Student> | Record<string, any> | null;
  src?: string;
  name?: string;
  avatarColor?: string;
  className?: string;
  imgClassName?: string;
  initialsClassName?: string;
  alt?: string;
  children?: React.ReactNode;
  id?: string;
}

/**
 * Helper to safely extract valid image URL from student document
 */
export function getStudentImageUrl(
  student?: Record<string, any> | null,
  src?: string
): string | undefined {
  if (src && typeof src === "string" && src.trim()) {
    return src.trim();
  }
  if (!student) return undefined;

  const possibleFields = [
    student.avatarUrl,
    student.photoUrl,
    student.photoURL,
    student.profilePic,
    student.imageUrl,
    student.avatar,
  ];

  for (const field of possibleFields) {
    if (field && typeof field === "string" && field.trim()) {
      return field.trim();
    }
  }

  return undefined;
}

/**
 * Helper to generate uppercase initials from full name
 */
export function getStudentInitials(name?: string): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

export default function StudentAvatar({
  student,
  src,
  name: nameProp,
  avatarColor,
  className = "",
  imgClassName = "",
  initialsClassName = "",
  alt,
  children,
  id,
}: StudentAvatarProps) {
  const imageUrl = getStudentImageUrl(student, src);
  const name = nameProp || student?.name || "Student";
  const initials = getStudentInitials(name);
  const bgColor = avatarColor || student?.avatarColor || "bg-blue-600";

  // Image load state management: 'loading' | 'loaded' | 'error'
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">(
    imageUrl ? "loading" : "error"
  );

  useEffect(() => {
    let isMounted = true;
    if (imageUrl) {
      setImageState("loading");

      const img = new Image();
      img.onload = () => {
        if (isMounted) setImageState("loaded");
      };
      img.onerror = () => {
        if (isMounted) setImageState("error");
      };
      img.src = imageUrl;

      // Handle cached images that are already completely loaded
      if (img.complete && img.naturalWidth > 0) {
        if (isMounted) setImageState("loaded");
      }
    } else {
      setImageState("error");
    }

    return () => {
      isMounted = false;
    };
  }, [imageUrl]);

  const hasImage = Boolean(imageUrl && imageState !== "error");
  const isLoaded = Boolean(imageUrl && imageState === "loaded");
  const isLoading = Boolean(imageUrl && imageState === "loading");

  return (
    <div
      id={id}
      className={`relative overflow-hidden flex items-center justify-center shrink-0 ${
        hasImage ? "bg-slate-100 dark:bg-slate-800" : bgColor
      } ${className}`}
    >
      {/* Loading Skeleton Placeholder */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse flex items-center justify-center z-10">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 opacity-60">
            {initials}
          </span>
        </div>
      )}

      {/* Main Profile Image or Fallback Initials */}
      {hasImage ? (
        <img
          src={imageUrl}
          alt={alt || name}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            isLoaded ? "opacity-100" : "opacity-0"
          } ${imgClassName}`}
          referrerPolicy="no-referrer"
          onLoad={() => setImageState("loaded")}
          onError={() => setImageState("error")}
        />
      ) : (
        <span className={`font-extrabold text-white select-none ${initialsClassName}`}>
          {initials}
        </span>
      )}

      {/* Optional Overlay / Badge slot */}
      {children}
    </div>
  );
}
