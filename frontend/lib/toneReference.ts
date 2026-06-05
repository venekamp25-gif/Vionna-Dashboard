"use client";

import { useEffect, useState } from "react";
import { StoreKey } from "./store";

/**
 * Per-store "tone reference" examples. The user pastes 1-3 of their own
 * existing product descriptions and Claude uses them as a style anchor on
 * every generation — much more consistent voice than a generic prompt.
 *
 * Stored in localStorage so it persists across sessions; not synced to the
 * backend (single-user dashboard).
 */
const TONE_KEY = "vionna-dashboard:tone-reference-v1";

export interface ToneReferences {
  dk: string[];
  fr: string[];
  fi: string[];
}

const EMPTY: ToneReferences = { dk: [], fr: [], fi: [] };

export function loadToneReferences(): ToneReferences {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(TONE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as ToneReferences;
    return {
      dk: Array.isArray(parsed.dk) ? parsed.dk.filter(Boolean) : [],
      fr: Array.isArray(parsed.fr) ? parsed.fr.filter(Boolean) : [],
      fi: Array.isArray(parsed.fi) ? parsed.fi.filter(Boolean) : [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveToneReferences(refs: ToneReferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TONE_KEY, JSON.stringify(refs));
  } catch {
    // quota exceeded, just skip
  }
}

/**
 * React hook for reading + writing the tone references store.
 * Returns the references plus a setter (writes through to localStorage).
 */
export function useToneReferences() {
  const [refs, setRefs] = useState<ToneReferences>(EMPTY);

  useEffect(() => {
    setRefs(loadToneReferences());
  }, []);

  const update = (next: ToneReferences) => {
    setRefs(next);
    saveToneReferences(next);
  };

  const setForStore = (store: StoreKey, examples: string[]) => {
    update({ ...refs, [store]: examples });
  };

  return { refs, update, setForStore };
}
