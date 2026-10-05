import { create } from "zustand";

export type WizardStep =
  | "identity"
  | "voice"
  | "personality"
  | "brand"
  | "behavior"
  | "launch";

export const WIZARD_STEPS: WizardStep[] = [
  "identity",
  "voice",
  "personality",
  "brand",
  "behavior",
  "launch",
];

export interface WizardState {
  currentStep: WizardStep;
  identity: {
    name: string;
    handle: string;
    referencePhotoUrl: string;
    archetype: string;
  };
  voice: {
    voiceId: string;
    language: string;
    tone: string;
  };
  personality: {
    warmth: number;
    humor: number;
    authority: number;
    boldness: number;
    niche: string;
  };
  brand: {
    description: string;
    categories: string[];
    bannedCategories: string[];
  };
  behavior: {
    autoAcceptBelow: number;
    autoDeclineCategories: string[];
    operationalPoolPercent: number;
  };
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateIdentity: (data: Partial<WizardState["identity"]>) => void;
  updateVoice: (data: Partial<WizardState["voice"]>) => void;
  updatePersonality: (data: Partial<WizardState["personality"]>) => void;
  updateBrand: (data: Partial<WizardState["brand"]>) => void;
  updateBehavior: (data: Partial<WizardState["behavior"]>) => void;
}

export const useWizardStore = create<WizardState>((set, get) => ({
  currentStep: "identity",
  identity: { name: "", handle: "", referencePhotoUrl: "", archetype: "" },
  voice: { voiceId: "", language: "en", tone: "warm" },
  personality: { warmth: 70, humor: 50, authority: 50, boldness: 50, niche: "lifestyle" },
  brand: { description: "", categories: [], bannedCategories: [] },
  behavior: { autoAcceptBelow: 1000, autoDeclineCategories: [], operationalPoolPercent: 15 },

  goToStep: (step) => set({ currentStep: step }),

  nextStep: () => {
    const idx = WIZARD_STEPS.indexOf(get().currentStep);
    if (idx < WIZARD_STEPS.length - 1) {
      set({ currentStep: WIZARD_STEPS[idx + 1] });
    }
  },

  prevStep: () => {
    const idx = WIZARD_STEPS.indexOf(get().currentStep);
    if (idx > 0) {
      set({ currentStep: WIZARD_STEPS[idx - 1] });
    }
  },

  updateIdentity: (data) =>
    set((s) => ({ identity: { ...s.identity, ...data } })),
  updateVoice: (data) =>
    set((s) => ({ voice: { ...s.voice, ...data } })),
  updatePersonality: (data) =>
    set((s) => ({ personality: { ...s.personality, ...data } })),
  updateBrand: (data) =>
    set((s) => ({ brand: { ...s.brand, ...data } })),
  updateBehavior: (data) =>
    set((s) => ({ behavior: { ...s.behavior, ...data } })),
}));
