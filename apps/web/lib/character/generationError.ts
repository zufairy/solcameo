/** Keep provider failures visible so users can distinguish downtime from bad inputs. */
export function generationError(status: string, error?: string): string {
  if (status === "nsfw") return "Blocked by content moderation";
  if (status === "canceled") return "Generation canceled";
  if (error?.trim()) {
    if (/model.*temporarily unavailable/i.test(error)) {
      return "The image model is temporarily unavailable. Your reference image and traits remain in the builder. Try again in a moment; you were not charged.";
    }
    return error.trim();
  }
  return "Generation failed. Try again or check your Higgsfield account.";
}
