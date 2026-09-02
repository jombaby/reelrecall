import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ReelRecall", short_name: "ReelRecall",
    description: "Save, organize, play, and rediscover the videos worth remembering.",
    start_url: "/", scope: "/", display: "standalone",
    background_color: "#f5f1e6", theme_color: "#173d35", orientation: "portrait-primary",
    categories: ["lifestyle", "food", "entertainment"],
    icons: [
      { src: "/icons/reelrecall.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/reelrecall-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
