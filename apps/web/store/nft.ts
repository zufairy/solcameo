import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIInfluencer } from "@/lib/types";

interface NftStore {
  mintAddresses: string[];
  influencers: AIInfluencer[];
  addInfluencer: (mintAddress: string, influencer: AIInfluencer) => void;
  setInfluencers: (influencers: AIInfluencer[]) => void;
  reset: () => void;
}

export const useNftStore = create<NftStore>()(
  persist(
    (set) => ({
      mintAddresses: [],
      influencers: [],

      addInfluencer: (mintAddress, influencer) =>
        set((state) => ({
          mintAddresses: state.mintAddresses.includes(mintAddress)
            ? state.mintAddresses
            : [...state.mintAddresses, mintAddress],
          influencers: state.influencers.some((i) => i.id === mintAddress)
            ? state.influencers
            : [...state.influencers, influencer],
        })),

      setInfluencers: (influencers) => set({ influencers }),

      reset: () => set({ mintAddresses: [], influencers: [] }),
    }),
    { name: "vello-nfts" }
  )
);
