import { create } from 'zustand'

/** Sheets that several screens open: the install help and the command palette. */
export const useUi = create<{
  installOpen: boolean
  paletteOpen: boolean
  set: (patch: Partial<{ installOpen: boolean; paletteOpen: boolean }>) => void
}>((set) => ({
  installOpen: false,
  paletteOpen: false,
  set: (patch) => set(patch),
}))
