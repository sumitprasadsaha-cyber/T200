/**
 * Safely converts a data URL, base64 string, or blob URL into a Blob object.
 * Robust against spaces, newlines, percent-encoding, URL-safe base64, missing padding, and malformed strings.
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (!dataUrl) {
    throw new Error("Data URL is empty.");
  }

  const cleanInput = dataUrl.trim();

  // If already a blob URL, fetch it directly
  if (cleanInput.startsWith("blob:")) {
    const res = await fetch(cleanInput);
    return res.blob();
  }

  // 1. Try browser native fetch first if it's a data: URL
  if (cleanInput.startsWith("data:") && typeof fetch === "function") {
    try {
      const res = await fetch(cleanInput);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          return blob;
        }
      }
    } catch (fetchErr) {
      // Fallback to manual decoding below
    }
  }

  // 2. Manual parsing and sanitization
  let mime = "application/pdf";
  let base64Part = cleanInput;

  if (base64Part.startsWith("data:")) {
    const commaIdx = base64Part.indexOf(",");
    if (commaIdx !== -1) {
      const header = base64Part.substring(0, commaIdx);
      const mimeMatch = header.match(/:(.*?);/);
      if (mimeMatch) mime = mimeMatch[1];
      base64Part = base64Part.substring(commaIdx + 1);
    }
  }

  // Decode URI components if URL-encoded (%20, %0A, %2B, etc.)
  if (base64Part.includes("%")) {
    try {
      base64Part = decodeURIComponent(base64Part);
    } catch (e) {
      // ignore
    }
  }

  // Strip all whitespace, newlines, tabs, carriage returns
  base64Part = base64Part.replace(/[\s\r\n\t]/g, "");

  // Convert URL-safe base64 (- -> +, _ -> /)
  base64Part = base64Part.replace(/-/g, "+").replace(/_/g, "/");

  // Fix padding if needed
  const mod = base64Part.length % 4;
  if (mod > 0) {
    base64Part += "=".repeat(4 - mod);
  }

  // Safe window.atob
  try {
    const bstr = window.atob(base64Part);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  } catch (atobErr: any) {
    // If window.atob fails, try constructing a clean data URL and fetching it
    try {
      const formattedDataUrl = `data:${mime};base64,${base64Part}`;
      const res = await fetch(formattedDataUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) return blob;
      }
    } catch (e) {
      // ignore
    }
    throw new Error(`Failed to decode base64 document: ${atobErr.message || atobErr}`);
  }
}
