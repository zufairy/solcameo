import { ExplorePage } from "@/components/explore/explore-page";
import references from "@/lib/explore/references.json";
import short from "@/lib/explore/short-references.json";
export default function Page() { return <ExplorePage initial={references} short={short} />; }
