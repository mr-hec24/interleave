import type { Metadata } from "next";
import ModelExplorer from "@/components/explore/ModelExplorer";

export const metadata: Metadata = {
  title: "How the scheduler decides — Interleaf",
  description:
    "An interactive explanation of Interleaf's v1 scheduling model: retrievability decay, desirable-difficulty targeting, cognitive fatigue, and the utility comparison behind every switch.",
};

/**
 * Public, and deliberately outside the (app) route group.
 *
 * This is documentation, not product: it reads no user data, writes nothing, and
 * needs no session. Keeping it off the authenticated surface means it can be linked
 * from the landing page and shared with someone reasoning about the algorithm who
 * has no account.
 */
export default function ExplorePage() {
  return <ModelExplorer />;
}
