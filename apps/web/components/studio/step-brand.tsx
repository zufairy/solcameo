"use client";

import { useWizardStore } from "@/store/wizard";
import { Button } from "@/components/ui/button";

const ALLOWED_CATEGORIES = [
  "fashion", "beauty", "food", "travel", "tech", "fitness",
  "finance", "education", "gaming", "home", "automotive", "health",
];

const BANNED_DEFAULTS = [
  { id: "alcohol", label: "Alcohol" },
  { id: "gambling", label: "Gambling" },
  { id: "tobacco", label: "Tobacco" },
  { id: "adult", label: "Adult content" },
];

export function StepBrand() {
  const { brand, updateBrand, nextStep, prevStep } = useWizardStore();

  const toggleCategory = (cat: string) => {
    const has = brand.categories.includes(cat);
    updateBrand({
      categories: has
        ? brand.categories.filter((c) => c !== cat)
        : [...brand.categories, cat],
    });
  };

  const toggleBanned = (cat: string) => {
    const has = brand.bannedCategories.includes(cat);
    updateBrand({
      bannedCategories: has
        ? brand.bannedCategories.filter((c) => c !== cat)
        : [...brand.bannedCategories, cat],
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Brand Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Define what your AI Influencer will and won&apos;t promote.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Categories this AI Influencer will promote</label>
        <div className="grid grid-cols-3 gap-2">
          {ALLOWED_CATEGORIES.map((cat) => (
            <label
              key={cat}
              className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer text-sm capitalize transition-colors ${
                brand.categories.includes(cat)
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <input
                type="checkbox"
                className="size-4 rounded"
                checked={brand.categories.includes(cat)}
                onChange={() => toggleCategory(cat)}
              />
              {cat}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Always decline</label>
        <div className="space-y-2">
          {BANNED_DEFAULTS.map(({ id, label }) => (
            <label
              key={id}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                className="size-4 rounded"
                checked={brand.bannedCategories.includes(id)}
                onChange={() => toggleBanned(id)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>Back</Button>
        <Button onClick={nextStep} disabled={brand.categories.length === 0}>
          Next: Behavior
        </Button>
      </div>
    </div>
  );
}
