"use client";

import { useSyncExternalStore } from "react";
import { api, CatalogJob, CatalogJobType } from "./api";

/**
 * App-wide store for catalogue-maintenance jobs.
 *
 * Lives at module level (not inside the modal) so progress keeps updating even
 * when the maintenance pop-up is closed, and is re-discovered from the backend
 * list endpoint after a full page reload. Both the modal and the header badge
 * subscribe via useCatalogJobs().
 */

let jobs: CatalogJob[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function anyRunning() {
  return jobs.some((j) => j.status === "running");
}

async function fetchOnce() {
  try {
    const r = await api.catalogJobList();
    jobs = r.jobs ?? [];
    emit();
  } catch {
    /* transient — keep the previous snapshot */
  }
}

function loop() {
  void fetchOnce().finally(() => {
    // poll fast while something is running, otherwise go idle (a new start or a
    // fresh subscriber re-kicks it).
    timer = anyRunning() ? setTimeout(loop, 2500) : null;
  });
}

function kick() {
  if (!timer) timer = setTimeout(loop, 0);
}

/** Start a job and refresh the shared snapshot. */
export async function startCatalogJob(store: "dk" | "fr" | "fi", type: CatalogJobType) {
  const r = await api.catalogJobStart(store, type);
  await fetchOnce();
  kick();
  return r;
}

/** Resolve once the given job id is no longer running (done/error/gone). */
export function waitForJob(id: string): Promise<CatalogJob | null> {
  return new Promise((resolve) => {
    const check = async () => {
      let j: CatalogJob | null = jobs.find((x) => x.id === id) ?? null;
      if (!j) {
        try {
          j = await api.catalogJobStatus(id);
        } catch {
          j = null; // 404 (server restarted / unknown) → treat as finished
        }
      }
      if (!j || j.status !== "running") {
        resolve(j);
        return;
      }
      setTimeout(check, 2000);
    };
    void check();
  });
}

/** Subscribe to the live job list (re-renders on every update). */
export function useCatalogJobs(): CatalogJob[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      kick(); // ensure a poll cycle is running while anyone is watching
      return () => listeners.delete(cb);
    },
    () => jobs,
    () => jobs
  );
}
