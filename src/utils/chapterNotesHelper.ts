import { ChapterNote } from "../types";

export interface ChapterPartNote extends ChapterNote {
  partNumber: number;
  partLabel: string;
  topicNo?: number | string;
  topicName?: string;
  topicLabel?: string;
}

export interface ChapterGroup {
  chapterNo: number;
  chapterName: string; // Clean parent title
  notes: ChapterPartNote[];
}

/**
 * Strips topic/part indicators like "(Topic 1)", "Topic 1", "(Part 1)", "Part 1", "- Topic 1", Pt. 1
 * from chapter titles to get the clean umbrella chapter name.
 */
export function getCleanChapterTitle(title: string): string {
  if (!title) return "";
  let clean = title
    .replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\.?\s*\d*\s*[\)\]\}]?\s*[:–\-]?\s*/gi, "")
    .replace(/[\(\[\{-]?\s*(?:topic|part|pt)\.?\s*\d+\s*[\)\]\}]?\s*[:–\-]?\s*/gi, "")
    .replace(/\s*-\s*$/g, "")
    .replace(/\s*:\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || title;
}

/**
 * Formats a note's topic label cleanly as e.g. "Topic 1 : Topic Name" or "Topic 1".
 * Replaces any legacy "Part X" or "partLabel" references with "Topic X".
 */
export function getFormattedTopicLabel(note: {
  topicNo?: number | string;
  topicName?: string;
  topicLabel?: string;
  partLabel?: string;
  pdfFileName?: string;
  fileName?: string;
  chapterName?: string;
}): string {
  let topicNo: number | string = note.topicNo ?? "";
  let topicName: string = note.topicName || "";

  // Check if topicLabel or partLabel contains info
  const existingLabel = note.topicLabel || note.partLabel || "";
  if (existingLabel) {
    const partMatch = existingLabel.match(/(?:part|topic|pt)\.?\s*(\d+)\s*(?::|–|-)?\s*(.*)/i);
    if (partMatch) {
      if (!topicNo) topicNo = parseInt(partMatch[1], 10);
      if (!topicName && partMatch[2]) {
        const potentialName = partMatch[2].trim();
        if (!/^\d+$/.test(potentialName)) {
          topicName = potentialName;
        }
      }
    } else if (!topicName) {
      const clean = existingLabel.replace(/^(?:part|topic|pt)\.?\s*/i, "").trim();
      if (!/^\d+$/.test(clean)) {
        topicName = clean;
      }
    }
  }

  // If topicName is missing or purely numeric, try extracting from pdfFileName or fileName
  if ((!topicName || /^\d+$/.test(topicName)) && (note.pdfFileName || note.fileName)) {
    const fname = note.pdfFileName || note.fileName || "";
    const cleanFileName = fname.replace(/\.[^/.]+$/, "").trim();
    const isGeneric = /^(?:\d+|part\s*\d+|topic\s*\d+)$/i.test(cleanFileName);
    if (!isGeneric) {
      const stripped = cleanFileName.replace(/^(?:topic|part|pt)\.?\s*\d*\s*[:–\-]?\s*/gi, "").trim();
      if (stripped && !/^(?:part|topic|\d+)\s*\d*$/i.test(stripped)) {
        topicName = stripped;
      }
    }
  }

  // Ensure topicNo defaults if missing
  if (!topicNo) {
    const fileMatch = (note.pdfFileName || note.fileName || existingLabel || "").match(/(\d+)/);
    if (fileMatch) topicNo = fileMatch[1];
  }

  // Clean topicName to avoid redundant "Topic 1 : Topic 1 : Name" or numeric "1"
  if (topicName) {
    topicName = topicName.replace(/^(?:topic|part|pt)\.?\s*\d*\s*[:–\-]?\s*/gi, "").trim();
    if (/^\d+$/.test(topicName) || String(topicName).trim() === String(topicNo).trim()) {
      topicName = "";
    }
  }

  if (topicNo && topicName) {
    return `Topic ${topicNo} : ${topicName}`;
  } else if (topicNo) {
    return `Topic ${topicNo}`;
  } else if (topicName) {
    return topicName.toLowerCase().startsWith("topic ") ? topicName : `Topic : ${topicName}`;
  }

  return "Topic 1";
}

/**
 * Checks if a filename is redundant with topic/part label to avoid repeating the topic title twice.
 */
export function isFileNameRedundant(label?: string, fileName?: string): boolean {
  if (!label || !fileName) return true;
  const cleanLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanFile = fileName.toLowerCase().replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]/g, "");
  if (!cleanLabel || !cleanFile) return true;
  return cleanLabel === cleanFile || cleanLabel.includes(cleanFile) || cleanFile.includes(cleanLabel);
}

/**
 * Parses a note to determine its topic number, topic name, and topic label.
 */
export function parseNotePartInfo(note: ChapterNote, fallbackIndex: number): {
  partNumber: number;
  partLabel: string;
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
} {
  let topicNo: number | string = note.topicNo ?? "";
  let topicName: string = note.topicName || "";

  // If topicNo & topicName are missing, check partLabel
  if (!topicNo && !topicName && note.partLabel) {
    const partMatch = note.partLabel.match(/(?:part|topic|pt)\.?\s*(\d+)\s*(?::|–|-)?\s*(.*)/i);
    if (partMatch) {
      topicNo = parseInt(partMatch[1], 10);
      if (partMatch[2]) topicName = partMatch[2].trim();
    } else {
      const cleanLabel = note.partLabel.replace(/^Part\s*/i, "Topic ");
      if (cleanLabel.toLowerCase().startsWith("topic ")) {
        const subMatch = cleanLabel.match(/^Topic\s*(\d+)\s*(?::|–|-)?\s*(.*)/i);
        if (subMatch) {
          topicNo = parseInt(subMatch[1], 10);
          if (subMatch[2]) topicName = subMatch[2].trim();
        } else {
          topicName = cleanLabel;
        }
      } else {
        topicName = note.partLabel;
      }
    }
  }

  // If still missing topicNo, search in name/filename
  let partNumber = typeof topicNo === "number" ? topicNo : parseInt(String(topicNo), 10);
  if (isNaN(partNumber) || !partNumber) {
    const nameToSearch = `${note.chapterName || ""} ${note.pdfFileName || ""}`;
    const topicMatch = nameToSearch.match(/(?:topic|part|pt)\.?\s*(\d+)/i);
    if (topicMatch && topicMatch[1]) {
      partNumber = parseInt(topicMatch[1], 10);
      topicNo = partNumber;
    } else {
      partNumber = fallbackIndex + 1;
      topicNo = partNumber;
    }
  }

  // Strip leading "Topic X" prefix from topicName to avoid redundant "Topic 1 – Topic 1 – Name"
  if (topicName) {
    topicName = topicName.replace(/^(?:topic|part|pt)\.?\s*\d*\s*[:–\-]?\s*/gi, "").trim();
  }

  const formattedLabel = getFormattedTopicLabel({
    topicNo,
    topicName,
    partLabel: note.partLabel,
    pdfFileName: note.pdfFileName
  });

  return {
    partNumber,
    partLabel: formattedLabel,
    topicNo,
    topicName,
    topicLabel: formattedLabel,
  };
}

/**
 * Groups notes by Chapter Number in ascending order,
 * cleans parent chapter names, and sorts child topics numerically.
 */
export function groupAndSortChapterNotes(notes: ChapterNote[]): ChapterGroup[] {
  const groupsMap = new Map<number, ChapterGroup>();

  for (const note of notes) {
    const chNo = Number(note.chapterNo) || 0;
    const cleanTitle = getCleanChapterTitle(note.chapterName) || `Chapter ${chNo}`;

    if (!groupsMap.has(chNo)) {
      groupsMap.set(chNo, {
        chapterNo: chNo,
        chapterName: cleanTitle,
        notes: [],
      });
    }

    const group = groupsMap.get(chNo)!;
    if (cleanTitle && (!group.chapterName || group.chapterName.startsWith("Chapter"))) {
      group.chapterName = cleanTitle;
    }

    const { partNumber, partLabel, topicNo, topicName, topicLabel } = parseNotePartInfo(note, group.notes.length);
    group.notes.push({
      ...note,
      partNumber,
      partLabel,
      topicNo,
      topicName,
      topicLabel,
    });
  }

  // Sort parent chapters by Chapter Number in ascending order
  const result = Array.from(groupsMap.values()).sort((a, b) => a.chapterNo - b.chapterNo);

  // Within each chapter, sort Topics numerically
  for (const group of result) {
    group.notes.sort((a, b) => a.partNumber - b.partNumber);
  }

  return result;
}
