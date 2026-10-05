export type SeedCharacter = {
  name: string;
  ticker: string;
  bio: string;
  category: string;
  image: string;
  video: string;
  episodeTitle: string;
};

/** Sample characters. Media rights are unreviewed; see public/solstar/README.md. */
export const SEED_CHARACTERS: SeedCharacter[] = [
  { name: "Disco Ant", ticker: "DISCO", category: "Comedy", bio: "Small guy. Big dance floor. A disco legend with six left feet.", image: "/solstar/disco-ant.webp", video: "/solstar/disco-ant.mp4", episodeTitle: "The first episode" },
  { name: "Professor Pop", ticker: "POP", category: "Comedy", bio: "The experiments are questionable. The hair is non-negotiable.", image: "/solstar/professor.webp", video: "/solstar/professor.mp4", episodeTitle: "The first episode" },
  { name: "Mullet Max", ticker: "MAX", category: "Culture", bio: "Business in the front. Absolutely no business anywhere else.", image: "/solstar/mullet.webp", video: "/solstar/mullet.mp4", episodeTitle: "The first episode" },
  { name: "Mantis FM", ticker: "MFM", category: "Music", bio: "Late-night radio from the smallest studio in the universe.", image: "/solstar/mantis.webp", video: "/solstar/mantis.mp4", episodeTitle: "The first episode" },
  { name: "Miss Orbit", ticker: "ORBIT", category: "Culture", bio: "A towering hairstyle and opinions from another dimension.", image: "/solstar/beehive.webp", video: "/solstar/beehive.mp4", episodeTitle: "The first episode" },
  { name: "Round Theory", ticker: "ROUND", category: "Comedy", bio: "Every problem has a circular solution. Usually her hair.", image: "/solstar/sphere.webp", video: "/solstar/sphere.mp4", episodeTitle: "The first episode" },
];
