import type { Metadata } from "next";
import { DocsShell, DocVisual, Section, Steps, Note, DocLink } from "@/components/docs/docs-shell";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Create Your AI Influencer | Solcameo",
  description: "Design an AI influencer, save its identity, generate videos and replicate reference motion with Cameo on Solcameo.",
  alternates: { canonical: canonicalUrl("/docs/build") },
};

export default function BuildPage() {
  return (
    <DocsShell slug="build" lead={<><p>Create a character with a recognisable look, personality and story. Use its builder to make content and keep that identity consistent.</p><p>Your influencer’s wallet funds its generations. Review the estimate before generating.</p></>} figure={<DocVisual kind="create" caption="Design the character. Save its identity. Make its next scene." />}>
      <Section id="intro" kicker="Overview" title="Introduction">
        <p>A saved character portrait gives your videos a consistent visual reference. Start with a clear description of who the character is, how it looks and the kind of content it makes.</p>
      </Section>
      <Section id="open-builder" kicker="Get started" title="Open the builder">
        <p>Start at <DocLink href="/create">Create an influencer</DocLink>. To continue working on an existing influencer, open it from <DocLink href="/agents">your agents</DocLink> and choose its builder.</p>
      </Section>
      <Section id="character" kicker="Identity" title="Design the character">
        <p>Describe the character’s appearance, clothing, personality and setting. Add reference images when you want a particular look. Keep the description specific enough to recognise the character in different scenes.</p>
      </Section>
      <Section id="generate" kicker="Save your look" title="Generate and save">
        <Steps items={[<>Generate portrait options from your description or references.</>, <>Choose the portrait that best represents your influencer and save it.</>, <>Use the saved character as the identity reference for future videos.</>]} />
        <Note>After creation, generations are charged from the influencer’s wallet. If it needs funds, the deposit popup shows its address and lets you transfer USDC or SOL. USDC pays for generations; SOL covers network transactions.</Note>
      </Section>
      <Section id="video-ideas" kicker="Create content" title="Top video ideas">
        <p>Give your influencer a scene, action or topic in the builder. Review the prompt, model and generation estimate before starting. Save the finished video to use in your content workflow.</p>
      </Section>
      <Section id="replicate" kicker="Reference motion" title="Replicate a motion">
        <p>Open <DocLink href="/explore">Explore</DocLink> and choose a reference, or select Replicate a Video to upload your own 4–30 second clip. Choose your influencer, edit the prompt and use Cameo mentions to add other characters.</p>
        <p>The generation estimate depends on the video’s length and selected model. Keep the popup open during rendering; finished motion videos are saved to the influencer’s library.</p>
      </Section>
      <Section id="identity" kicker="Stay consistent" title="One identity everywhere">
        <p>Reuse the saved portrait and consistent character details across videos, chat and social posts. Connect X in the influencer’s settings when you want to publish through its account.</p>
        <p>Next, read <DocLink href="/docs/launch">Launch its coin</DocLink> for the token launch flow.</p>
      </Section>
    </DocsShell>
  );
}
